import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { ASSETS, ChainClient, ChainTransportError, DB, ENV, Env, isKilled, nearTokenAccount, parseChainError, assetIdFromTokenAccount } from '@andum/shared';
import { BRIDGE_NEAR, REDIS } from './infra';
import { publish } from './publisher';
import { CONFIRMATIONS, DepositLog, EVM_SOURCE, EvmChain, EvmSource, assetIdBytes32 } from './evm';

const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_.][a-z0-9]+)*$/;
const TGAS = 10n ** 12n;

/** Mock bridge worker (ANDUM-PLAN 7.8). The relayer is trusted; both destinations have on-chain replay guards (I-8). */
@Injectable()
export class BridgeWorker implements OnModuleDestroy {
  private log = new Logger('bridge');
  private timer?: NodeJS.Timeout;
  private byBytes32 = new Map<string, string>();
  /** blocks scanned per call and how far back to start on first run */
  scanSpan = 1000n; startLookback = 50n;

  constructor(@Inject(DB) private db: Pool, @Inject(BRIDGE_NEAR) private near: ChainClient, @Inject(EVM_SOURCE) private evm: EvmSource, @Inject(ENV) private env: Env, @Inject(REDIS) private redis: Redis) {
    for (const a of ASSETS.filter((x) => x.bridgeable)) this.byBytes32.set(assetIdBytes32(a.id).toLowerCase(), a.id);
  }
  start(intervalMs = 6_000) { this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(String(e))), intervalMs); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (await isKilled(this.db, 'bridge')) return { skipped: true };
    for (const chain of this.evm.chains()) await this.scanEvm(chain).catch((e) => this.log.warn(`scan ${chain}: ${(e as Error).message}`));
    await this.scanNear().catch((e) => this.log.warn(`scanNear: ${(e as Error).message}`));
    await this.advance().catch((e) => this.log.warn(`advance: ${(e as Error).message}`));
    return { skipped: false };
  }

  // ------------------------------------------------------------------ state helpers
  private async getState(key: string) { return (await this.db.query('select value from worker_state where key=$1', [key])).rows[0]?.value as string | undefined; }
  private async setState(key: string, value: string) { await this.db.query('insert into worker_state (key, value) values ($1,$2) on conflict (key) do update set value=excluded.value', [key, value]); }
  private async notify(t: { near_account: string; id: string; status: string }) { await publish(this.redis, { type: 'bridge.updated', accounts: [t.near_account], data: { transfer_id: t.id, status: t.status } }); }

  // ------------------------------------------------------------------ EVM -> NEAR detection
  async scanEvm(chain: EvmChain): Promise<number> {
    const latest = await this.evm.latestBlock(chain);
    const cursorKey = `evm_cursor:${chain}`;
    const saved = await this.getState(cursorKey);
    let from = saved ? BigInt(saved) + 1n : (latest > this.startLookback ? latest - this.startLookback : 0n);
    let found = 0;
    while (from <= latest) {
      const to = from + this.scanSpan - 1n > latest ? latest : from + this.scanSpan - 1n;
      const logs = await this.evm.getDepositLogs(chain, from, to);
      for (const l of logs) found += await this.record(l);
      await this.setState(cursorKey, to.toString());
      from = to + 1n;
    }
    return found;
  }

  private async record(l: DepositLog): Promise<number> {
    const asset = this.byBytes32.get(l.assetId.toLowerCase());
    const bad = !asset ? 'UNKNOWN_ASSET' : !NEAR_ACCOUNT.test(l.nearAccount) ? 'BAD_NEAR_ACCOUNT' : null;
    const r = await this.db.query(
      `insert into bridge_transfers (direction, evm_chain, asset_id, amount, evm_address, near_account, src_nonce, src_tx, fund_package_id, fund_part_id, status, error, block_number)
       values ('EVM_TO_NEAR',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (evm_chain, direction, src_nonce) do nothing returning id, near_account, status`,
      [l.chain, asset ?? 'unknown', l.amount.toString(), l.from.toLowerCase(), l.nearAccount, l.nonce.toString(), l.txHash, l.fund && l.packageId > 0n ? l.packageId.toString() : null,
       l.fund && l.packageId > 0n ? l.partId : null, bad ? 'FAILED' : 'DETECTED', bad, l.blockNumber.toString()]);
    if (r.rowCount) await this.notify(r.rows[0]);
    return r.rowCount ?? 0;
  }

  // ------------------------------------------------------------------ NEAR -> EVM detection
  async scanNear(): Promise<number> {
    const cursorKey = 'near_out_next';
    let next = BigInt((await this.getState(cursorKey)) ?? '1');
    let found = 0;
    for (;;) {
      const rows = await this.near.viewFunction<any[]>(this.env.NEAR_BRIDGE, 'get_outbound_range', { from: next.toString(), limit: 50 });
      if (!rows.length) break;
      for (const o of rows) {
        const nonce = BigInt(o.nonce);
        const asset = assetIdFromTokenAccount(o.token_id, this.env.NEAR_ROOT);
        const r = await this.db.query(
          `insert into bridge_transfers (direction, evm_chain, asset_id, amount, evm_address, near_account, src_nonce, src_tx, status, error)
           values ('NEAR_TO_EVM',$1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (evm_chain, direction, src_nonce) do nothing returning id, near_account, status`,
          [o.dest_chain, asset ?? 'unknown', o.amount, o.dest_address, o.from, nonce.toString(), `near-out-${nonce}`, asset ? 'CONFIRMED' : 'FAILED', asset ? null : 'UNKNOWN_ASSET']);
        if (r.rowCount) { found++; await this.notify(r.rows[0]); }
        if (nonce >= next) next = nonce + 1n;
      }
      await this.setState(cursorKey, next.toString());
      if (rows.length < 50) break;
    }
    return found;
  }

  // ------------------------------------------------------------------ progress
  async advance() {
    await this.advanceDetected();
    await this.submitToNear();
    await this.releaseOnEvm();
  }

  private async setStatus(id: string, status: string, extra: { error?: string | null; dst_tx?: string | null; confirmations?: number } = {}) {
    const r = await this.db.query(
      `update bridge_transfers set status=$2, error=coalesce($3, error), dst_tx=coalesce($4, dst_tx), confirmations=coalesce($5, confirmations), updated_at=now() where id=$1 returning id, near_account, status`,
      [id, status, extra.error ?? null, extra.dst_tx ?? null, extra.confirmations ?? null]);
    if (r.rowCount) await this.notify(r.rows[0]);
  }

  private async advanceDetected() {
    const rows = (await this.db.query(`select * from bridge_transfers where direction='EVM_TO_NEAR' and status='DETECTED' order by created_at limit 100`)).rows;
    for (const t of rows) {
      const chain = t.evm_chain as EvmChain;
      try {
        const latest = await this.evm.latestBlock(chain);
        const conf = Number(latest - BigInt(t.block_number) + 1n);
        const exists = await this.evm.depositStillExists(chain, { txHash: t.src_tx, nonce: BigInt(t.src_nonce), blockNumber: BigInt(t.block_number) });
        if (!exists) { await this.setStatus(t.id, 'FAILED', { error: 'REORGED' }); continue; }
        if (conf >= CONFIRMATIONS[chain]) await this.setStatus(t.id, 'CONFIRMED', { confirmations: conf });
        else if (conf !== t.confirmations) await this.setStatus(t.id, 'DETECTED', { confirmations: conf });
      } catch (e) { this.log.warn(`confirm ${t.id}: ${(e as Error).message}`); }
    }
  }

  private async submitToNear() {
    const rows = (await this.db.query(`select * from bridge_transfers where direction='EVM_TO_NEAR' and status in ('CONFIRMED','SUBMITTED') order by created_at limit 50`)).rows;
    for (const t of rows) {
      await this.setStatus(t.id, 'SUBMITTED');
      try {
        // bridge_in is idempotent on chain per (src_chain, src_nonce), so re-submitting after a crash is safe
        const out = await this.near.callAsRelayer(this.env.NEAR_BRIDGE, 'bridge_in', {
          token_id: nearTokenAccount(t.asset_id, this.env.NEAR_ROOT), near_receiver: t.near_account, amount: String(t.amount), src_chain: t.evm_chain,
          src_nonce: String(t.src_nonce), src_tx_hash: t.src_tx,
          fund: t.fund_package_id != null ? { package_id: String(t.fund_package_id), part_id: t.fund_part_id } : null,
        }, 250n * TGAS, 0n);
        if (out.success) await this.setStatus(t.id, 'DONE', { dst_tx: out.txHash });
        else await this.setStatus(t.id, 'FAILED', { error: parseChainError(out.failure) ?? (out.failure ?? 'bridge_in failed').slice(0, 300) });
      } catch (e) {
        if (!(e instanceof ChainTransportError)) this.log.error(`bridge_in ${t.id}: ${(e as Error).message}`);
        await this.db.query('update bridge_transfers set error=$2 where id=$1', [t.id, (e as Error).message.slice(0, 300)]); // stays SUBMITTED, retried next tick
      }
    }
  }

  private async releaseOnEvm() {
    const rows = (await this.db.query(`select * from bridge_transfers where direction='NEAR_TO_EVM' and status in ('CONFIRMED','SUBMITTED') order by src_nonce limit 50`)).rows;
    for (const t of rows) {
      await this.setStatus(t.id, 'SUBMITTED');
      try {
        const res = await this.evm.release(t.evm_chain as EvmChain, { assetId: assetIdBytes32(t.asset_id), to: t.evm_address, amount: BigInt(t.amount), nonce: BigInt(t.src_nonce), nearTxHash: t.src_tx });
        await this.setStatus(t.id, 'DONE', { dst_tx: res.txHash || null }); // alreadyReleased also means done: the gateway replay guard held
      } catch (e) {
        await this.db.query('update bridge_transfers set error=$2 where id=$1', [t.id, (e as Error).message.slice(0, 300)]);
      }
    }
  }
}
