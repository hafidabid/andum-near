import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req as ReqDec, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  ASSETS, ApiError, CHAIN_CLIENT, ChainClient, DB, ENV, Env, EVENT_CHANNEL, StreamMessage, consume, getAsset, isKilled, nearTokenAccount, outcomeErrorCode, ChainTransportError,
} from '@andum/shared';
import { AuthUser, CurrentUser, Public, Req, clientIp, parse } from './common';
import { REDIS } from './infra';
import { upstream } from './accounts';

const TGAS = 10n ** 12n;
const positiveAmount = z.string().refine((s) => /^\d{1,30}$/.test(s) && BigInt(s) > 0n, 'amount must be a positive integer string');

// ---------------------------------------------------------------------------- faucet
const faucetBody = z.object({ asset_id: z.string().min(1).max(20), amount: positiveAmount.optional() });

@Controller('v1/faucet')
export class FaucetController {
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env) {}

  @Post('near') @HttpCode(200)
  async near(@CurrentUser() u: AuthUser, @ReqDec() req: Req, @Body() body: unknown) {
    const b = parse(faucetBody, body);
    if (await isKilled(this.db, 'faucet')) throw new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'The faucet is paused');
    const asset = getAsset(b.asset_id);
    if (!asset) throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown asset');
    const amount = BigInt(b.amount ?? asset.faucet.perCall);
    if (amount > BigInt(asset.faucet.perCall)) throw new ApiError(429, 'FAUCET_CAP', 'Above the per-call limit', { per_call: asset.faucet.perCall });
    if (!(await consume(this.db, clientIp(req), 'faucet_ip', 3600, this.env.FAUCET_IP_PER_HOUR))) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests from this address');
    const used = (await this.db.query(`select coalesce(sum(amount),0)::text s from faucet_claims where recipient=$1 and asset_id=$2 and chain='near' and created_at > now() - interval '24 hours'`, [u.accountId, asset.id])).rows[0].s;
    if (BigInt(used) + amount > BigInt(asset.faucet.daily)) throw new ApiError(429, 'FAUCET_CAP', 'Daily limit reached', { daily: asset.faucet.daily, used });
    let out;
    try { out = await this.chain.callAsRelayer(nearTokenAccount(asset.id, this.env.NEAR_ROOT), 'ft_mint', { account_id: u.accountId, amount: amount.toString() }, 30n * TGAS, 0n); }
    catch (e) { throw upstream(e); }
    if (!out.success) {
      const code = outcomeErrorCode(out);
      if (code === 'FAUCET_CAP_PER_CALL' || code === 'FAUCET_CAP_DAILY') throw new ApiError(429, 'FAUCET_CAP', 'The token contract refused: limit reached');
      throw new ApiError(502, 'RELAY_CHAIN_FAILURE', 'Mint failed', { code });
    }
    await this.db.query(`insert into faucet_claims (chain, asset_id, recipient, amount, ip, tx_hash) values ('near',$1,$2,$3,$4,$5)`, [asset.id, u.accountId, amount.toString(), clientIp(req), out.txHash]);
    return { tx_hash: out.txHash, minted: amount.toString() };
  }

  @Post('evm') @HttpCode(501)
  evm() { throw new ApiError(501 as any, 'UPSTREAM_UNAVAILABLE', 'The EVM faucet is not enabled yet (P2)'); }
}

// ---------------------------------------------------------------------------- notification prefs
const prefsBody = z.object({ email_enabled: z.boolean(), email: z.string().email().max(254).optional() });

@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(DB) private db: Pool) {}
  @Get('prefs')
  async get(@CurrentUser() u: AuthUser) {
    const r = await this.db.query('select email_enabled, email from notification_prefs where account_id=$1', [u.accountId]);
    return r.rows[0] ?? { email_enabled: true, email: null };
  }
  @Put('prefs')
  async put(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(prefsBody, body);
    const r = await this.db.query(
      `insert into notification_prefs (account_id, email_enabled, email) values ($1,$2,$3)
       on conflict (account_id) do update set email_enabled=excluded.email_enabled, email=coalesce(excluded.email, notification_prefs.email) returning email_enabled, email`,
      [u.accountId, b.email_enabled, b.email ?? null]);
    return r.rows[0];
  }
}

// ---------------------------------------------------------------------------- bridge (read side + quote)
const quoteBody = z.object({
  asset_id: z.string().min(1).max(20), amount: positiveAmount,
  dest_chain: z.enum(['sepolia', 'baseSepolia']), dest_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

@Controller('v1/bridge')
export class BridgeController {
  constructor(@Inject(DB) private db: Pool, @Inject(ENV) private env: Env) {}

  @Public() @Get('assets')
  assets() {
    return ASSETS.filter((a) => a.bridgeable).map((a) => ({ id: a.id, symbol: a.symbol, decimals: a.decimals, near: nearTokenAccount(a.id, this.env.NEAR_ROOT), evm: {} as Record<string, string> }));
  }

  @Post('out/quote') @HttpCode(200)
  async quote(@Body() body: unknown) {
    const b = parse(quoteBody, body);
    const asset = getAsset(b.asset_id);
    if (!asset || !asset.bridgeable) throw new ApiError(400, 'VALIDATION_FAILED', 'This asset cannot be bridged');
    if (/^0x0{40}$/i.test(b.dest_address)) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid destination address');
    return {
      fee: '0', eta_s: 60,
      ft_transfer_call: {
        token: nearTokenAccount(asset.id, this.env.NEAR_ROOT), receiver_id: this.env.NEAR_BRIDGE, amount: b.amount,
        msg: JSON.stringify({ dest_chain: b.dest_chain, dest_address: b.dest_address.toLowerCase() }),
      },
    };
  }

  @Get('transfers')
  async list(@CurrentUser() u: AuthUser) {
    const r = await this.db.query('select * from bridge_transfers where near_account=$1 order by created_at desc limit 50', [u.accountId]);
    return r.rows.map(toTransfer);
  }

  @Get('transfers/:id')
  async one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found');
    const r = await this.db.query('select * from bridge_transfers where id=$1 and near_account=$2', [id, u.accountId]);
    if (!r.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found');
    return toTransfer(r.rows[0]);
  }
}
const toTransfer = (t: any) => ({ id: t.id, direction: t.direction, evm_chain: t.evm_chain, asset_id: t.asset_id, amount: t.amount, evm_address: t.evm_address, near_account: t.near_account, status: t.status, src_tx: t.src_tx, dst_tx: t.dst_tx, error: t.error });

// ---------------------------------------------------------------------------- SSE
@Injectable()
export class StreamHub implements OnModuleDestroy {
  private sub: Redis;
  private listeners = new Set<(m: StreamMessage) => void>();
  constructor(@Inject(ENV) env: Env) {
    this.sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    void this.sub.subscribe(EVENT_CHANNEL);
    this.sub.on('message', (_c, raw) => { try { const m = JSON.parse(raw) as StreamMessage; this.listeners.forEach((l) => l(m)); } catch { /* ignore */ } });
  }
  add(l: (m: StreamMessage) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onModuleDestroy() { this.sub.disconnect(); }
}

@Controller('v1')
export class StreamController {
  constructor(private hub: StreamHub) {}
  @Get('stream')
  stream(@CurrentUser() u: AuthUser, @ReqDec() req: Req, @Res() res: Response) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const off = this.hub.add((m) => {
      if (!m.accounts.includes(u.accountId)) return; // a user only ever sees their own events
      res.write(`event: ${m.type}\ndata: ${JSON.stringify(m.data)}\n\n`);
    });
    const hb = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(hb); off(); });
  }
}

// ---------------------------------------------------------------------------- health
@Controller()
export class HealthController {
  constructor(@Inject(DB) private db: Pool, @Inject(REDIS) private redis: Redis, @Inject(CHAIN_CLIENT) private chain: ChainClient) {}
  @Public() @Get('healthz') healthz() { return { ok: true }; }
  @Public() @Get('readyz')
  async readyz() {
    const check = async (f: () => Promise<unknown>) => { try { await Promise.race([f(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); return true; } catch { return false; } };
    const checks = { db: await check(() => this.db.query('select 1')), redis: await check(() => this.redis.ping()), near: await check(() => this.chain.getBlockHeight()) };
    if (!Object.values(checks).every(Boolean)) throw new ServiceUnavailableException({ ready: false, checks });
    return { ready: true, checks };
  }
}
void ChainTransportError;
