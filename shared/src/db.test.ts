import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, migrate, resetAll, isKilled, setKill, tx } from './db';
import { upsertPackage, storeEvents, PackageView, fetchAndCachePackage } from './packages-repo';
import { FakeChain } from './chain';
import { TEST_DB_URL } from './test-env';

const pool = createPool(TEST_DB_URL, 4);
const view = (id = '1', o: Partial<PackageView> = {}): PackageView => ({
  id, sender: 's.testnet', recipient: null, owner: null, status: 'FUNDED', note: null, theme: 'none', accept_by_ns: '100', created_ns: '1', accepted_ns: null,
  parts: [{ part_id: 0, token: 'usdc.t', amount: '5', funded: '5', unlock_ns: '50', approvers: ['b.testnet'], threshold: 1, approvals: [], approved: false, state: 'LOCKED', status: 'NOT_ACCEPTED', reason: 'PACKAGE_NOT_ACTIVE', taken_ns: null }],
  ...o,
});
beforeAll(async () => { await migrate(pool); });
beforeEach(async () => { await resetAll(pool); });
afterAll(async () => { await pool.end(); });

describe('db', () => {
  it('migrations are idempotent', async () => { expect(await migrate(pool)).toEqual([]); });
  it('kill switches', async () => {
    expect(await isKilled(pool, 'relayer')).toBe(false);
    await setKill(pool, 'relayer', true);
    expect(await isKilled(pool, 'relayer')).toBe(true);
  });
  it('transaction rolls back on error', async () => {
    await expect(tx(pool, async (c) => { await c.query("insert into worker_state values ('k','v')"); throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await pool.query('select * from worker_state')).rowCount).toBe(0);
  });
  it('upsertPackage inserts then updates package and parts', async () => {
    await upsertPackage(pool, view());
    await upsertPackage(pool, view('1', { status: 'ACCEPTED', owner: 'r.testnet' }));
    const p = (await pool.query('select * from packages')).rows;
    expect(p).toHaveLength(1);
    expect(p[0].status).toBe('ACCEPTED');
    expect(p[0].accept_by_ns).toBe('100'); // numeric kept as string
    expect((await pool.query('select * from parts')).rows).toHaveLength(1);
  });
  it('approvers array is queryable', async () => {
    await upsertPackage(pool, view());
    const r = await pool.query("select package_id from parts where approvers @> array['b.testnet']");
    expect(r.rows).toHaveLength(1);
  });
  it('storeEvents is idempotent per (chain, tx, log_index)', async () => {
    const ev = [{ standard: 'andum', event: 'package_created', data: { package_id: '1' }, logIndex: 0 }];
    expect(await storeEvents(pool, 'near', 'TX1', ev)).toBe(1);
    expect(await storeEvents(pool, 'near', 'TX1', ev)).toBe(0);
    expect(await storeEvents(pool, 'near', 'TX2', ev)).toBe(1);
  });
  it('fetchAndCachePackage returns null for unknown packages and does not write', async () => {
    const c = new FakeChain(); c.setView('core', 'get_package', () => null);
    expect(await fetchAndCachePackage(pool, c, 'core', '9')).toBeNull();
    expect((await pool.query('select * from packages')).rowCount).toBe(0);
    c.setView('core', 'get_package', () => view('9'));
    expect((await fetchAndCachePackage(pool, c, 'core', '9'))?.id).toBe('9');
    expect((await pool.query('select * from packages')).rowCount).toBe(1);
  });
  it('slug uniqueness is case-insensitive', async () => {
    const ins = (id: string, slug: string) => pool.query("insert into invites (id, sender_account, recipient_email, secret_hash, secret_enc, slug) values ($1,'s','a@b.c','\\x00','\\x00',$2)", [id, slug]);
    await ins('i1', 'rina');
    await expect(ins('i2', 'RINA')).rejects.toThrow(/duplicate key/);
  });
});
