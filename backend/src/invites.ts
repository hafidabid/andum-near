import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req as ReqDec, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  ApiError, CHAIN_CLIENT, ChainClient, DB, ENV, Env, MAILER, Mailer, PackageView, consume, decrypt, deliverNotification, encrypt, enqueueNotification, fetchAndCachePackage,
  generateOtp, hashOtp, maskEmail, newInviteSecret, randomId, safeEqual, sha256, suggestSlug, validateSlug, emailTemplates,
} from '@andum/shared';
import { AuthUser, CurrentUser, Public, Req, clientIp, parse } from './common';
import { upstream } from './accounts';

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SEC = 60;
const SLUG_REDIRECT_HOURS = 24;

const createBody = z.object({ recipient_email: z.string().email().max(254) });
const attachBody = z.object({ package_id: z.string().regex(/^\d{1,20}$/), tx_hash: z.string().min(1).max(100) });
const linkBody = z.object({ slug: z.string().max(64).optional(), title: z.string().max(200).optional(), show_amount: z.boolean().optional() });
const codeBody = z.object({ code: z.string().regex(/^\d{6}$/) });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cleanTitle = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, '').trim();

@Controller()
export class InvitesController {
  private key: Buffer;
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env, @Inject(MAILER) private mailer: Mailer) {
    this.key = Buffer.from(env.INVITE_ENC_KEY, 'base64');
    if (this.key.length !== 32) throw new Error('INVITE_ENC_KEY must be 32 bytes, base64 encoded');
  }

  // ------------------------------------------------------------------ helpers
  private async getInvite(id: string) {
    const r = await this.db.query('select * from invites where id=$1', [id]);
    if (!r.rowCount) throw new ApiError(404, 'INVITE_NOT_FOUND', 'Invite not found');
    return r.rows[0];
  }
  private async ownInvite(id: string, u: AuthUser) {
    const inv = await this.getInvite(id);
    if (inv.sender_account !== u.accountId) throw new ApiError(403, 'FORBIDDEN', 'Not your invite');
    return inv;
  }
  private linkFor(inv: { id: string; slug: string | null }) {
    return inv.slug ? `${this.env.PUBLIC_WEB_BASE}/p/${inv.slug}` : `${this.env.PUBLIC_WEB_BASE}/i/${inv.id}`;
  }
  private async view(inv: any): Promise<PackageView | null> {
    if (inv.package_id == null) return null;
    try { return await fetchAndCachePackage(this.db, this.chain, this.env.NEAR_CORE, String(inv.package_id)); } catch (e) { throw upstream(e); }
  }
  private preview(inv: any, v: PackageView | null) {
    const title = inv.link_title ? cleanTitle(inv.link_title) : 'You have a package waiting';
    let description = `${inv.sender_account} sent you a package on Andum`;
    if (inv.show_amount && v) {
      const totals = this.totals(v);
      description = `${inv.sender_account} sent you ${Object.entries(totals).map(([t, a]) => `${a} ${t.split('.')[0]}`).join(', ')}`;
    }
    return { title, description, image_url: `${this.env.PUBLIC_API_BASE}/p/${inv.slug ?? inv.id}/og.png` };
  }
  private totals(v: PackageView) {
    const t: Record<string, string> = {};
    for (const p of v.parts) t[p.token] = (BigInt(t[p.token] ?? '0') + BigInt(p.amount)).toString();
    return t;
  }

  // ------------------------------------------------------------------ create / attach
  @Post('v1/invites') @HttpCode(201)
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(createBody, body);
    if (!(await consume(this.db, u.accountId, 'invite_create', 3600, 60))) throw new ApiError(429, 'RATE_LIMITED', 'Too many invites');
    const secret = newInviteSecret();
    const id = randomId(22);
    await this.db.query(`insert into invites (id, sender_account, recipient_email, secret_hash, secret_enc) values ($1,$2,$3,$4,$5)`,
      [id, u.accountId, b.recipient_email, sha256(secret), encrypt(this.key, secret)]);
    return { invite_id: id, invite_hash_b64: sha256(secret).toString('base64') };
  }

  @Post('v1/invites/:id/attach') @HttpCode(200)
  async attach(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(attachBody, body);
    const inv = await this.ownInvite(id, u);
    if (inv.status === 'ACCEPTED') throw new ApiError(409, 'LINK_LOCKED', 'Already accepted');
    const taken = await this.db.query('select id from invites where package_id=$1 and id<>$2', [b.package_id, id]);
    if (taken.rowCount) throw new ApiError(409, 'VALIDATION_FAILED', 'This package is attached to another invite');
    let v: PackageView & { invite_hash?: string | null } | null;
    try { v = (await this.chain.viewFunction<any>(this.env.NEAR_CORE, 'get_package', { package_id: b.package_id })); } catch (e) { throw upstream(e); }
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'Package not found on chain');
    if (v.sender !== u.accountId) throw new ApiError(403, 'FORBIDDEN', 'You are not the sender of this package');
    if (!v.invite_hash || !safeEqual(Buffer.from(v.invite_hash, 'base64'), inv.secret_hash)) throw new ApiError(403, 'FORBIDDEN', 'Package does not carry this invite');
    await fetchAndCachePackage(this.db, this.chain, this.env.NEAR_CORE, b.package_id);
    await this.db.query(`update invites set package_id=$2, accept_by=to_timestamp($3::numeric/1000000000), attach_tx=$4, status = case when status='DRAFT' then 'ATTACHED' else status end where id=$1`,
      [id, b.package_id, v.accept_by_ns, b.tx_hash]);
    const nid = await enqueueNotification(this.db, { kind: 'invite', dedupeKey: `invite:${id}`, to: inv.recipient_email, payload: { sender: u.accountId, link: this.linkFor(inv) } });
    if (nid) await deliverNotification(this.db, this.mailer, nid).catch(() => undefined); // best effort now, the worker retries
    return { status: 'ATTACHED' };
  }

  // ------------------------------------------------------------------ links
  @Get('v1/links/check')
  async check(@CurrentUser() u: AuthUser, @Query('slug') slug?: string) {
    if (!(await consume(this.db, u.accountId, 'link_check', 60, 30))) throw new ApiError(429, 'RATE_LIMITED', 'Slow down');
    const v = validateSlug(String(slug ?? ''));
    if (!v.ok) return { available: false, reason: v.reason };
    if (await this.slugTaken(String(slug), null)) return { available: false, reason: 'SLUG_TAKEN', suggestion: await this.freeSuggestion(String(slug)) };
    return { available: true };
  }
  private async slugTaken(slug: string, exceptInvite: string | null) {
    const a = await this.db.query('select id from invites where slug=$1 and ($2::text is null or id<>$2)', [slug, exceptInvite]);
    if (a.rowCount) return true;
    const r = await this.db.query('select invite_id from link_redirects where old_slug=$1 and expires_at > now() and ($2::text is null or invite_id<>$2)', [slug, exceptInvite]);
    return !!r.rowCount;
  }
  private async freeSuggestion(slug: string) {
    for (let n = 2; n < 50; n++) { const s = suggestSlug(slug, n); if (validateSlug(s).ok && !(await this.slugTaken(s, null))) return s; }
    return undefined;
  }

  @Patch('v1/invites/:id/link')
  async patchLink(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(linkBody, body);
    const inv = await this.ownInvite(id, u);
    if (inv.status === 'ACCEPTED') throw new ApiError(409, 'LINK_LOCKED', 'The link can no longer be changed');
    if (b.title !== undefined && cleanTitle(b.title).length > 60) throw new ApiError(400, 'VALIDATION_FAILED', 'Title is limited to 60 characters');
    const slugChanging = b.slug !== undefined && b.slug !== inv.slug;
    if (slugChanging) {
      if (!(await consume(this.db, id, 'link_change', 3600, 10))) throw new ApiError(429, 'RATE_LIMITED', 'Too many link changes');
      const v = validateSlug(b.slug!);
      if (!v.ok) throw new ApiError(400, v.reason, v.reason === 'SLUG_RESERVED' ? 'This link name is reserved' : 'Invalid link name');
      if (await this.slugTaken(b.slug!, id)) throw new ApiError(409, 'SLUG_TAKEN', 'This link name is taken', { suggestion: await this.freeSuggestion(b.slug!) });
    }
    try {
      await this.db.query('begin');
      if (slugChanging) {
        if (inv.slug) await this.db.query(`insert into link_redirects (old_slug, invite_id, expires_at) values ($1,$2, now() + ($3 || ' hours')::interval)
          on conflict (old_slug) do update set invite_id=excluded.invite_id, expires_at=excluded.expires_at`, [inv.slug, id, String(SLUG_REDIRECT_HOURS)]);
        await this.db.query(`update invites set slug=$2, slug_changed_at=now() where id=$1`, [id, b.slug]);
      }
      if (b.title !== undefined) await this.db.query('update invites set link_title=$2 where id=$1', [id, cleanTitle(b.title) || null]);
      if (b.show_amount !== undefined) await this.db.query('update invites set show_amount=$2 where id=$1', [id, b.show_amount]);
      await this.db.query('commit');
    } catch (e: any) {
      await this.db.query('rollback').catch(() => undefined);
      if (e?.code === '23505') throw new ApiError(409, 'SLUG_TAKEN', 'This link name is taken');
      throw e;
    }
    const fresh = await this.getInvite(id);
    return { slug: fresh.slug, url: this.linkFor(fresh), title: fresh.link_title, show_amount: fresh.show_amount, preview: this.preview(fresh, await this.view(fresh).catch(() => null)) };
  }

  @Public() @Get('v1/links/:slug')
  async resolve(@ReqDec() req: Req, @Param('slug') slug: string) {
    if (!(await consume(this.db, clientIp(req), 'link_lookup', 60, 60))) throw new ApiError(429, 'RATE_LIMITED', 'Too many lookups');
    const a = await this.db.query('select id from invites where slug=$1', [slug]);
    if (a.rowCount) return { invite_id: a.rows[0].id };
    const r = await this.db.query(`select r.invite_id, i.slug from link_redirects r join invites i on i.id=r.invite_id where r.old_slug=$1 and r.expires_at > now()`, [slug]);
    if (r.rowCount) return { invite_id: r.rows[0].invite_id, redirect_to: r.rows[0].slug };
    throw new ApiError(404, 'NOT_FOUND', 'Link not found');
  }

  @Public() @Get('p/:slug')
  async page(@ReqDec() req: Req, @Param('slug') slug: string, @Res() res: Response) {
    if (!(await consume(this.db, clientIp(req), 'link_lookup', 60, 60))) throw new ApiError(429, 'RATE_LIMITED', 'Too many lookups');
    const r = await this.db.query(`select i.* from invites i where i.slug=$1 union select i.* from invites i join link_redirects l on l.invite_id=i.id where l.old_slug=$1 and l.expires_at > now()`, [slug]);
    if (!r.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Link not found');
    const inv = r.rows[0];
    const v = inv.show_amount ? await this.view(inv).catch(() => null) : null;
    const p = this.preview(inv, v);
    const url = this.linkFor(inv);
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}">
<meta property="og:image" content="${esc(p.image_url)}"><meta property="og:url" content="${esc(url)}"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(url)}"></head><body><a href="${esc(url)}">${esc(p.title)}</a></body></html>`);
  }

  // ------------------------------------------------------------------ public view
  @Public() @Get('v1/invites/:id/public')
  async publicView(@Param('id') id: string) {
    const inv = await this.getInvite(id);
    const v = await this.view(inv);
    return {
      sender_display: inv.sender_account,
      package: v && {
        id: v.id, status: v.status, theme: v.theme, has_note: !!v.note, // the note stays hidden until the receiver accepts
        parts: v.parts.map((p) => ({ token: p.token, amount: p.amount, unlock_ns: p.unlock_ns, approver_count: p.approvers.length, threshold: p.threshold })),
        total_by_token: this.totals(v),
      },
      accept_by_ms: inv.accept_by ? new Date(inv.accept_by).getTime() : null,
      email_hint: maskEmail(inv.recipient_email),
      title: inv.link_title,
    };
  }

  // ------------------------------------------------------------------ OTP
  @Public() @Post('v1/invites/:id/verify/start') @HttpCode(200)
  async verifyStart(@ReqDec() req: Req, @Param('id') id: string) {
    const inv = await this.getInvite(id);
    if (!(await consume(this.db, clientIp(req), 'otp_start_ip', 3600, 30))) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    if (inv.status === 'DRAFT' || inv.package_id == null) throw new ApiError(409, 'INVITE_NOT_ATTACHED', 'This invite is not ready yet');
    if (inv.status === 'ACCEPTED') throw new ApiError(409, 'LINK_LOCKED', 'This package was already accepted');
    if (inv.accept_by && new Date(inv.accept_by).getTime() < Date.now()) throw new ApiError(410, 'INVITE_EXPIRED', 'This invite has expired');
    const last = await this.db.query(`select extract(epoch from (now() - created_at))::float8 as age from otp_codes where invite_id=$1 order by created_at desc limit 1`, [id]);
    if (last.rowCount && last.rows[0].age < OTP_RESEND_SEC) {
      throw new ApiError(429, 'RATE_LIMITED', 'Please wait before requesting another code', { resend_after_s: Math.ceil(OTP_RESEND_SEC - last.rows[0].age) });
    }
    const code = generateOtp();
    const row = await this.db.query(`insert into otp_codes (invite_id, code_hash, expires_at) values ($1,$2, now() + ($3 || ' minutes')::interval) returning id`, [id, hashOtp(id, code), String(OTP_TTL_MIN)]);
    try { await this.mailer.send({ to: inv.recipient_email, ...emailTemplates.otp(code) }); }
    catch { await this.db.query('delete from otp_codes where id=$1', [row.rows[0].id]); throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'Could not send the email'); }
    return { sent: true, resend_after_s: OTP_RESEND_SEC };
  }

  @Public() @Post('v1/invites/:id/verify/confirm') @HttpCode(200)
  async verifyConfirm(@Param('id') id: string, @Body() body: unknown) {
    const { code } = parse(codeBody, body);
    const inv = await this.getInvite(id);
    if (inv.status === 'DRAFT' || inv.package_id == null) throw new ApiError(409, 'INVITE_NOT_ATTACHED', 'This invite is not ready yet');
    const o = (await this.db.query(`select * from otp_codes where invite_id=$1 and used_at is null order by created_at desc limit 1`, [id])).rows[0];
    if (!o) throw new ApiError(400, 'OTP_INVALID', 'Request a new code');
    if (o.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new code.');
    if (new Date(o.expires_at).getTime() < Date.now()) throw new ApiError(400, 'OTP_EXPIRED', 'This code has expired');
    if (!safeEqual(o.code_hash, hashOtp(id, code))) {
      const a = await this.db.query('update otp_codes set attempts = attempts + 1 where id=$1 returning attempts', [o.id]);
      if (a.rows[0].attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new code.');
      throw new ApiError(400, 'OTP_INVALID', 'That code is not right', { attempts_left: OTP_MAX_ATTEMPTS - a.rows[0].attempts });
    }
    const used = await this.db.query('update otp_codes set used_at = now() where id=$1 and used_at is null returning 1', [o.id]);
    if (!used.rowCount) throw new ApiError(400, 'OTP_INVALID', 'Code already used');
    if (inv.status === 'ACCEPTED') throw new ApiError(409, 'LINK_LOCKED', 'This package was already accepted');
    await this.db.query(`update invites set status='VERIFIED' where id=$1 and status='ATTACHED'`, [id]);
    const secret = decrypt(this.key, inv.secret_enc);
    return { package_id: String(inv.package_id), invite_secret: secret.toString('base64') };
  }
}
