import { Controller, Get, Header, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { ApiError, CHAIN_CLIENT, ChainClient, DB, ENV, Env, PackageView, fetchAndCachePackage } from '@andum/shared';
import { AuthUser, CurrentUser, Public, parse } from './common';
import { upstream } from './accounts';

const listQuery = z.object({ role: z.enum(['sender', 'owner', 'approver']).default('sender'), cursor: z.string().regex(/^\d{1,20}$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const ID = /^\d{1,20}$/;
const STALE_MS = 10_000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const THEME_COLORS: Record<string, [string, string]> = {
  none: ['#1f2937', '#4b5563'], confetti: ['#7c3aed', '#ec4899'], gift: ['#dc2626', '#f59e0b'], balloons: ['#0ea5e9', '#22c55e'], hearts: ['#e11d48', '#fb7185'], gold: ['#b45309', '#fbbf24'],
};

export function nftSvg(v: PackageView): string {
  const [c1, c2] = THEME_COLORS[v.theme] ?? THEME_COLORS.none;
  const taken = v.parts.filter((p) => p.state === 'TAKEN').length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="Andum package #${esc(v.id)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="400" height="400" rx="28" fill="url(#g)"/>
<text x="32" y="64" font-family="sans-serif" font-size="22" fill="#fff" opacity=".8">ANDUM</text>
<text x="32" y="200" font-family="sans-serif" font-size="56" font-weight="700" fill="#fff">#${esc(v.id)}</text>
<text x="32" y="250" font-family="sans-serif" font-size="22" fill="#fff">${taken} of ${v.parts.length} parts taken</text>
${v.note ? `<text x="32" y="340" font-family="sans-serif" font-size="16" fill="#fff" opacity=".9">${esc(v.note.slice(0, 40))}</text>` : ''}
</svg>`;
}

@Controller('v1/packages')
export class PackagesController {
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query() query: unknown) {
    const q = parse(listQuery, query);
    const params: unknown[] = [u.accountId, q.limit + 1];
    let where = q.role === 'sender' ? 'p.sender=$1' : q.role === 'owner' ? 'p.owner=$1' : `exists (select 1 from parts x where x.package_id=p.id and x.approvers @> array[$1]::text[])`;
    if (q.cursor) { params.push(q.cursor); where += ` and p.id < $${params.length}`; }
    const rows = (await this.db.query(`select p.id, p.view from packages p where ${where} order by p.id desc limit $2`, params)).rows;
    const page = rows.slice(0, q.limit);
    return { items: page.map((r) => r.view), next: rows.length > q.limit ? String(page[page.length - 1].id) : null };
  }

  private async load(id: string, fresh = true): Promise<PackageView> {
    if (!ID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Package not found');
    const row = (await this.db.query('select view, extract(epoch from (now() - updated_at))*1000 as age_ms from packages where id=$1', [id])).rows[0];
    if (row && (!fresh || row.age_ms < STALE_MS)) return row.view;
    try {
      const v = await fetchAndCachePackage(this.db, this.chain, this.env.NEAR_CORE, id);
      if (v) return v;
    } catch (e) { if (row) return row.view; throw upstream(e); } // serve the cache if the chain is briefly unreachable
    throw new ApiError(404, 'NOT_FOUND', 'Package not found');
  }

  private assertParty(v: PackageView, u: AuthUser) {
    const party = v.sender === u.accountId || v.owner === u.accountId || v.recipient === u.accountId || v.parts.some((p) => p.approvers.includes(u.accountId));
    if (!party) throw new ApiError(403, 'FORBIDDEN', 'You are not part of this package');
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.load(id);
    this.assertParty(v, u);
    return v;
  }

  @Get(':id/events')
  async events(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.load(id, false);
    this.assertParty(v, u);
    const r = await this.db.query(`select event, data, tx_hash, extract(epoch from created_at)*1000 as ts from chain_events where data->>'package_id' = $1 order by id asc`, [id]);
    return r.rows.map((x) => ({ event: x.event, data: x.data, tx_hash: x.tx_hash, ts: Math.round(Number(x.ts)) }));
  }

  @Public() @Get(':id/nft.svg') @Header('Content-Type', 'image/svg+xml') @Header('Cache-Control', 'public, max-age=60')
  async nft(@Param('id') id: string, @Res() res: Response) {
    const v = await this.load(id, false);
    res.type('image/svg+xml').send(nftSvg(v));
  }
}
