import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import {
  CHAIN_CLIENT, ChainClient, DB, ENV, Env, PackageView, TxOutcome, applyEventSideEffects, fetchAndCachePackage, packageIdsFromEvents, parseEventLogs, storeEvents,
} from '@andum/shared';
import { REDIS } from './infra';
import { publish } from './publisher';

const SWEEP_BATCH = 20;

@Injectable()
export class Reconciler implements OnModuleDestroy {
  private log = new Logger('reconciler');
  private timer?: NodeJS.Timeout;
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env, @Inject(REDIS) private redis: Redis) {}

  start(intervalMs = 15_000) { this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(String(e))), intervalMs); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Store events from an outcome, apply side effects, refresh mentioned packages, push live updates. */
  async ingestOutcome(out: Pick<TxOutcome, 'txHash' | 'logs'>): Promise<{ events: number; packages: string[] }> {
    const events = parseEventLogs(out.logs);
    const inserted = await storeEvents(this.db, 'near', out.txHash, events);
    await applyEventSideEffects(this.db, events);
    const ids = packageIdsFromEvents(events);
    const views = await this.refresh(ids);
    for (const v of views) await publish(this.redis, { type: 'package.updated', accounts: parties(v), data: { package_id: v.id, status: v.status } });
    return { events: inserted, packages: ids };
  }

  /** Fetch current chain state for the ids. A chain failure leaves the cache unchanged (next tick retries). */
  async refresh(ids: string[]): Promise<PackageView[]> {
    const out: PackageView[] = [];
    for (const id of ids) {
      try { const v = await fetchAndCachePackage(this.db, this.chain, this.env.NEAR_CORE, id); if (v) out.push(v); }
      catch (e) { this.log.warn(`refresh ${id} failed: ${(e as Error).message}`); }
    }
    return out;
  }

  /** Periodic: refresh non-final packages touched in the last 7 days, oldest cache first, in batches. */
  async sweep(): Promise<number> {
    const r = await this.db.query(
      `select p.id from packages p
       where p.status <> 'RECLAIMED' and p.updated_at > now() - interval '7 days'
         and exists (select 1 from parts x where x.package_id = p.id and x.state <> 'TAKEN')
       order by p.updated_at asc limit $1`, [SWEEP_BATCH]);
    const before = new Map<string, string>();
    for (const row of r.rows) before.set(String(row.id), stable((await this.db.query('select view from packages where id=$1', [row.id])).rows[0]?.view));
    const views = await this.refresh(r.rows.map((x) => String(x.id)));
    for (const v of views) {
      if (before.get(v.id) !== stable(v)) await publish(this.redis, { type: 'package.updated', accounts: parties(v), data: { package_id: v.id, status: v.status } });
    }
    return views.length;
  }
}

export function parties(v: PackageView): string[] {
  return [...new Set([v.sender, v.owner, v.recipient, ...v.parts.flatMap((p) => p.approvers)].filter((x): x is string => !!x))];
}

/** canonical JSON (sorted keys): jsonb does not preserve key order, so plain stringify would report false changes */
function stable(x: unknown): string {
  return JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}
