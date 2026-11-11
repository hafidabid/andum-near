import { Body, Controller, Get, HttpCode, Inject, Put, Post, Req as ReqDec, Res } from '@nestjs/common';
import { Pool } from 'pg';
import type { Response } from 'express';
import { ed25519 } from '@noble/curves/ed25519';
import { importSPKI, jwtVerify } from 'jose';
import { z } from 'zod';
import {
  ApiError, DB, ENV, Env, MAILER, Mailer, consume, emailTemplates, generateOtp, hashOtp, implicitAccountId, parsePublicKey, randomId, safeEqual,
} from '@andum/shared';
import { AllowNoKey, AuthUser, CurrentUser, Public, Req, SESSION_COOKIE, clientIp, parse, readCookie } from './common';

const SESSION_DAYS = 7;
const NONCE_TTL_MIN = 10;
const LOGIN_OTP_TTL_MIN = 10;
const LOGIN_OTP_MAX_ATTEMPTS = 5;
const LOGIN_OTP_RESEND_SEC = 60;
const FRESH_EMAIL_SEC = 600; // key replacement needs an email proof this recent

const keyProof = {
  account_id: z.string().min(1).max(64).optional(),
  public_key: z.string().min(10).max(100).optional(),
  signature: z.string().min(10).max(200).optional(),
  nonce: z.string().min(8).max(64).optional(),
};
const sessionBody = z.object({ provider: z.enum(['local', 'privy', 'web3auth']), token: z.string().max(8000).optional(), ...keyProof });
const emailStart = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const emailVerify = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().regex(/^\d{6}$/) });
const bindBody = z.object({ public_key: z.string().min(10).max(100), signature: z.string().min(10).max(200), nonce: z.string().min(8).max(64), replace: z.boolean().optional() });
const backupBody = z.object({
  v: z.literal(1), kdf: z.literal('pbkdf2-sha256'), iter: z.number().int().min(100_000).max(5_000_000),
  salt: z.string().min(8).max(64), iv: z.string().min(8).max(32), ct: z.string().min(40).max(256),
});

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(DB) private db: Pool, @Inject(ENV) private env: Env, @Inject(MAILER) private mailer: Mailer) {}

  // ------------------------------------------------------------------ helpers
  /** The caller proves they hold the ed25519 key by signing `<prefix>:<nonce>:<account>`. The nonce is ours, fresh and single use. */
  private async proveKey(prefix: string, b: { account_id?: string; public_key?: string; signature?: string; nonce?: string }): Promise<{ publicKey: string; accountId: string }> {
    if (!b.public_key || !b.signature || !b.nonce) throw new ApiError(400, 'VALIDATION_FAILED', 'public_key, signature and nonce are required');
    let pk: Buffer;
    try { pk = parsePublicKey(b.public_key); } catch { throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid public key'); }
    const accountId = implicitAccountId(b.public_key);
    if (b.account_id !== undefined && b.account_id !== accountId) throw new ApiError(401, 'UNAUTHENTICATED', 'Account does not belong to this key');
    let ok = false;
    try { ok = ed25519.verify(Buffer.from(b.signature, 'base64'), Buffer.from(`${prefix}:${b.nonce}:${accountId}`), pk); } catch { ok = false; }
    if (!ok) throw new ApiError(401, 'UNAUTHENTICATED', 'Signature does not verify');
    const used = await this.db.query(
      `update login_nonces set used_at = now() where nonce=$1 and used_at is null and created_at > now() - ($2 || ' minutes')::interval returning 1`, [b.nonce, String(NONCE_TTL_MIN)]);
    if (!used.rowCount) throw new ApiError(401, 'UNAUTHENTICATED', 'Nonce is unknown, used or expired');
    return { publicKey: b.public_key, accountId };
  }

  private async startSession(res: Response, userId: string, method: 'key' | 'email' | 'privy') {
    const s = await this.db.query(`insert into sessions (user_id, expires_at, auth_method) values ($1, now() + ($2 || ' days')::interval, $3) returning id`, [userId, String(SESSION_DAYS), method]);
    res.cookie(SESSION_COOKIE, s.rows[0].id, { httpOnly: true, sameSite: 'lax', secure: this.env.NODE_ENV === 'production', maxAge: SESSION_DAYS * 86400_000, path: '/' });
  }

  private async userView(userId: string) {
    const u = (await this.db.query(`select u.id, u.email, u.near_account_id, u.public_key, exists(select 1 from key_backups k where k.user_id=u.id) as has_backup from users u where u.id=$1`, [userId])).rows[0];
    return { user_id: u.id, email: u.email, near_account_id: u.near_account_id, public_key: u.public_key, key_required: !u.near_account_id, has_backup: u.has_backup };
  }

  // ------------------------------------------------------------------ nonce
  @Public() @Get('nonce')
  async nonce() {
    const nonce = randomId(24);
    await this.db.query('insert into login_nonces (nonce) values ($1)', [nonce]);
    return { nonce, message_template: '<andum-login|andum-bind>:<nonce>:<account_id>' };
  }

  // ------------------------------------------------------------------ email (passwordless, SMTP)
  @Public() @Post('email/start') @HttpCode(200)
  async emailStartCode(@ReqDec() req: Req, @Body() body: unknown) {
    if (!this.env.AUTH_EMAIL_ENABLED) throw new ApiError(403, 'FORBIDDEN', 'Email sign-in is disabled');
    const { email } = parse(emailStart, body);
    if (!(await consume(this.db, clientIp(req), 'login_otp_ip', 3600, 30))) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    if (!(await consume(this.db, email, 'login_otp_email', 3600, 10))) throw new ApiError(429, 'RATE_LIMITED', 'Too many codes requested for this address');
    const last = await this.db.query(`select extract(epoch from (now() - created_at))::float8 as age from login_otps where email=$1 order by created_at desc limit 1`, [email]);
    if (last.rowCount && last.rows[0].age < LOGIN_OTP_RESEND_SEC) {
      throw new ApiError(429, 'RATE_LIMITED', 'Please wait before requesting another code', { resend_after_s: Math.ceil(LOGIN_OTP_RESEND_SEC - last.rows[0].age) });
    }
    const code = generateOtp();
    const row = await this.db.query(`insert into login_otps (email, code_hash, expires_at, ip) values ($1,$2, now() + ($3 || ' minutes')::interval, $4) returning id`, [email, hashOtp(`login:${email}`, code), String(LOGIN_OTP_TTL_MIN), clientIp(req)]);
    try { await this.mailer.send({ to: email, ...emailTemplates.loginCode(code) }); }
    catch { await this.db.query('delete from login_otps where id=$1', [row.rows[0].id]); throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'Could not send the email'); }
    // same answer whether or not the address already has an account: no account enumeration
    return { sent: true, resend_after_s: LOGIN_OTP_RESEND_SEC };
  }

  @Public() @Post('email/verify') @HttpCode(200)
  async emailVerifyCode(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    if (!this.env.AUTH_EMAIL_ENABLED) throw new ApiError(403, 'FORBIDDEN', 'Email sign-in is disabled');
    const { email, code } = parse(emailVerify, body);
    const o = (await this.db.query(`select * from login_otps where email=$1 and used_at is null order by created_at desc limit 1`, [email])).rows[0];
    if (!o) throw new ApiError(400, 'OTP_INVALID', 'Request a new code');
    if (o.attempts >= LOGIN_OTP_MAX_ATTEMPTS) throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new code.');
    if (new Date(o.expires_at).getTime() < Date.now()) throw new ApiError(400, 'OTP_EXPIRED', 'This code has expired');
    if (!safeEqual(o.code_hash, hashOtp(`login:${email}`, code))) {
      const a = await this.db.query('update login_otps set attempts = attempts + 1 where id=$1 returning attempts', [o.id]);
      if (a.rows[0].attempts >= LOGIN_OTP_MAX_ATTEMPTS) throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new code.');
      throw new ApiError(400, 'OTP_INVALID', 'That code is not right', { attempts_left: LOGIN_OTP_MAX_ATTEMPTS - a.rows[0].attempts });
    }
    const used = await this.db.query('update login_otps set used_at = now() where id=$1 and used_at is null returning 1', [o.id]);
    if (!used.rowCount) throw new ApiError(400, 'OTP_INVALID', 'Code already used');
    const u = await this.db.query(
      `insert into users (auth_provider, auth_subject, email, email_verified_at) values ('email', $1::text, $1::text::citext, now())
       on conflict (auth_provider, auth_subject) do update set email_verified_at = now() returning id`, [email]);
    await this.startSession(res, u.rows[0].id, 'email');
    return this.userView(u.rows[0].id);
  }

  // ------------------------------------------------------------------ bind the NEAR key to an email user (non-custodial)
  @AllowNoKey() @Post('key') @HttpCode(200)
  async bindKey(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(bindBody, body);
    const { publicKey, accountId } = await this.proveKey('andum-bind', b);
    if (u.accountId === accountId) return this.userView(u.id); // idempotent
    if (u.accountId) {
      // replacing an existing key abandons the old NEAR account: demand an explicit flag and a fresh email proof
      if (!b.replace) throw new ApiError(409, 'FORBIDDEN', 'This user already has a key. Pass replace=true to abandon it.');
      if (u.authMethod !== 'email' || u.sessionAgeSec > FRESH_EMAIL_SEC) throw new ApiError(403, 'FORBIDDEN', 'Verify your email again before replacing the key');
    }
    try {
      await this.db.query('update users set public_key=$2, near_account_id=$3 where id=$1', [u.id, publicKey, accountId]);
    } catch (e: any) {
      if (e?.code === '23505') throw new ApiError(409, 'FORBIDDEN', 'This key already belongs to another user');
      throw e;
    }
    const email = (await this.db.query('select email from users where id=$1', [u.id])).rows[0]?.email;
    if (email) await this.db.query(`insert into notification_prefs (account_id, email_enabled, email) values ($1, true, $2) on conflict (account_id) do update set email = excluded.email`, [accountId, email]);
    if (u.accountId) await this.db.query('delete from key_backups where user_id=$1', [u.id]); // a backup of the abandoned key is useless
    return this.userView(u.id);
  }

  @AllowNoKey() @Put('key-backup') @HttpCode(200)
  async putBackup(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(backupBody, body);
    await this.db.query(`insert into key_backups (user_id, blob) values ($1,$2) on conflict (user_id) do update set blob=excluded.blob, updated_at=now()`, [u.id, JSON.stringify(b)]);
    return { stored: true };
  }

  @AllowNoKey() @Get('key-backup')
  async getBackup(@CurrentUser() u: AuthUser) {
    const r = await this.db.query('select blob from key_backups where user_id=$1', [u.id]);
    if (!r.rowCount) throw new ApiError(404, 'NOT_FOUND', 'No key backup stored');
    return r.rows[0].blob;
  }

  // ------------------------------------------------------------------ key based sessions: local (dev) and Privy (optional)
  @Public() @Post('session') @HttpCode(200)
  async session(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(sessionBody, body);
    if (b.provider === 'web3auth') throw new ApiError(401, 'UNAUTHENTICATED', 'Provider web3auth is not configured');
    if (b.provider === 'local') {
      if (!this.env.AUTH_LOCAL_ENABLED) throw new ApiError(403, 'FORBIDDEN', 'Key-only sign-in is disabled');
      if (!b.account_id) throw new ApiError(400, 'VALIDATION_FAILED', 'account_id is required');
      const { publicKey, accountId } = await this.proveKey('andum-login', b);
      const u = await this.db.query(
        `insert into users (auth_provider, auth_subject, near_account_id, public_key) values ('local', $1, $1, $2)
         on conflict (auth_provider, auth_subject) do update set public_key = excluded.public_key returning id`, [accountId, publicKey]);
      await this.startSession(res, u.rows[0].id, 'key');
      return this.userView(u.rows[0].id);
    }
    // Privy: the access token proves who they are; the key proof shows they control the NEAR key their wallet exposes.
    // [VERIFY] Privy raw ed25519 signing for NEAR (spike S-02). Token checks follow Privy's documented claims.
    if (!this.env.PRIVY_APP_ID || !this.env.PRIVY_VERIFICATION_KEY) throw new ApiError(401, 'UNAUTHENTICATED', 'Provider privy is not configured');
    if (!b.token) throw new ApiError(400, 'VALIDATION_FAILED', 'token is required');
    let sub: string;
    try {
      const key = await importSPKI(this.env.PRIVY_VERIFICATION_KEY.replace(/\\n/g, '\n'), 'ES256');
      const { payload } = await jwtVerify(b.token, key, { issuer: 'privy.io', audience: this.env.PRIVY_APP_ID });
      if (!payload.sub) throw new Error('no sub');
      sub = payload.sub;
    } catch { throw new ApiError(401, 'UNAUTHENTICATED', 'Privy token is not valid'); }
    const { publicKey, accountId } = await this.proveKey('andum-login', b);
    const existing = (await this.db.query(`select id, near_account_id from users where auth_provider='privy' and auth_subject=$1`, [sub])).rows[0];
    if (existing && existing.near_account_id && existing.near_account_id !== accountId) throw new ApiError(401, 'UNAUTHENTICATED', 'This Privy user is bound to a different key');
    let id: string;
    try {
      id = (await this.db.query(
        `insert into users (auth_provider, auth_subject, near_account_id, public_key) values ('privy', $1, $2, $3)
         on conflict (auth_provider, auth_subject) do update set public_key = excluded.public_key, near_account_id = excluded.near_account_id returning id`, [sub, accountId, publicKey])).rows[0].id;
    } catch (e: any) { if (e?.code === '23505') throw new ApiError(409, 'FORBIDDEN', 'This key already belongs to another user'); throw e; }
    await this.startSession(res, id, 'privy');
    return this.userView(id);
  }

  @AllowNoKey() @Get('me')
  async me(@CurrentUser() u: AuthUser) { return this.userView(u.id); }

  @AllowNoKey() @Post('logout') @HttpCode(200)
  async logout(@ReqDec() req: Req, @Res({ passthrough: true }) res: Response) {
    const sid = readCookie(req, SESSION_COOKIE);
    if (sid) await this.db.query('delete from sessions where id=$1', [sid]).catch(() => undefined);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}
