import { Pool, PoolClient } from 'pg';
import { ParsedEvent } from './events';
import { ChainClient } from './chain';

/** Contract view shape (ANDUM-PLAN 3.3). */
export interface PartView {
  part_id: number; token: string; amount: string; funded: string; unlock_ns: string | null; approvers: string[]; threshold: number;
  approvals: string[]; approved: boolean; state: 'LOCKED' | 'PENDING' | 'TAKEN'; status: string; reason: string | null; taken_ns: string | null;
}
export interface PackageView {
  id: string; sender: string; recipient: string | null; owner: string | null; status: string; note: string | null; theme: string;
  accept_by_ns: string; created_ns: string; accepted_ns: string | null; parts: PartView[];
}

export async function upsertPackage(db: Pool | PoolClient, v: PackageView, block?: bigint) {
  await db.query(
    `insert into packages (id, sender, owner, status, accept_by_ns, view, chain_block, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (id) do update set sender=excluded.sender, owner=excluded.owner, status=excluded.status,
       accept_by_ns=excluded.accept_by_ns, view=excluded.view, chain_block=excluded.chain_block, updated_at=now()`,
    [v.id, v.sender, v.owner, v.status, v.accept_by_ns, JSON.stringify(v), block?.toString() ?? null],
  );
  for (const p of v.parts) {
    await db.query(
      `insert into parts (package_id, part_id, token, amount, unlock_ns, approvers, threshold, approvals, approved, state, status, taken_ns)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (package_id, part_id) do update set token=excluded.token, amount=excluded.amount, unlock_ns=excluded.unlock_ns,
         approvers=excluded.approvers, threshold=excluded.threshold, approvals=excluded.approvals, approved=excluded.approved,
         state=excluded.state, status=excluded.status, taken_ns=excluded.taken_ns`,
      [v.id, p.part_id, p.token, p.amount, p.unlock_ns, p.approvers, p.threshold, p.approvals, p.approved, p.state, p.status, p.taken_ns],
    );
  }
}

export async function fetchAndCachePackage(db: Pool, chain: ChainClient, core: string, id: string): Promise<PackageView | null> {
  const v = await chain.viewFunction<PackageView | null>(core, 'get_package', { package_id: id });
  if (!v) return null;
  await upsertPackage(db, v);
  return v;
}

export async function storeEvents(db: Pool | PoolClient, chain: string, txHash: string, events: ParsedEvent[], block?: bigint): Promise<number> {
  let n = 0;
  for (const e of events) {
    const r = await db.query(
      `insert into chain_events (chain, tx_hash, log_index, event, data, block_height) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [chain, txHash, e.logIndex, e.event, JSON.stringify({ standard: e.standard, ...e.data }), block?.toString() ?? null],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}
