import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { MIGRATIONS } from './migrations';

export type Db = Pool;
export const DB = 'DB';

export function createPool(url: string, max = 10): Pool {
  const p = new Pool({ connectionString: url, max });
  // numeric/bigint columns are returned as strings by default; keep that: amounts are decimal strings everywhere
  return p;
}

export async function migrate(pool: Pool): Promise<string[]> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
    for (const m of MIGRATIONS) {
      const r = await c.query('select 1 from schema_migrations where id=$1', [m.id]);
      if (r.rowCount) continue;
      await c.query('begin');
      try {
        await c.query(m.sql);
        await c.query('insert into schema_migrations (id) values ($1)', [m.id]);
        await c.query('commit');
        applied.push(m.id);
      } catch (e) { await c.query('rollback'); throw e; }
    }
  } finally {
    await c.query('select pg_advisory_unlock(727001)').catch(() => undefined);
    c.release();
  }
  return applied;
}

export async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => undefined); throw e; }
  finally { c.release(); }
}

export async function q<R extends QueryResultRow = any>(pool: Pool | PoolClient, text: string, params: unknown[] = []): Promise<QueryResult<R>> {
  return pool.query<R>(text, params as any[]);
}

export async function isKilled(pool: Pool, key: 'relayer' | 'faucet' | 'bridge'): Promise<boolean> {
  const r = await pool.query('select enabled from kill_switches where key=$1', [key]);
  return r.rows[0]?.enabled === true;
}
export async function setKill(pool: Pool, key: string, enabled: boolean) {
  await pool.query('insert into kill_switches (key, enabled) values ($1,$2) on conflict (key) do update set enabled=excluded.enabled', [key, enabled]);
}

/** Truncate everything except migration bookkeeping (tests). */
export async function resetAll(pool: Pool) {
  await pool.query(`truncate users, sessions, login_nonces, invites, link_redirects, otp_codes, packages, parts, chain_events, relay_jobs,
    notifications, notification_prefs, faucet_claims, bridge_transfers, quota_usage, idempotency_keys, topups, worker_state, login_otps, key_backups cascade`);
  await pool.query('update kill_switches set enabled=false');
}
export * from './migrations';
