import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { resetAll, upsertPackage } from '@andum/shared';
import { WKit, TEST_REDIS, ev, part, pkgView, startWorkerKit } from './testkit';

let kit: WKit;
beforeAll(async () => { kit = await startWorkerKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.chain.transportFailures = 0; kit.packages.clear(); });

describe('reconciler (A-05)', () => {
  it('parses events, stores them once, and refreshes each mentioned package', async () => {
    kit.packages.set('1', pkgView('1')); kit.packages.set('2', pkgView('2'));
    const out = { txHash: 'T1', logs: [ev('package_created', { package_id: '1' }), ev('part_funded', { package_id: '1', part_id: 0 }), ev('package_created', { package_id: '2' })] };
    expect(await kit.reconciler.ingestOutcome(out)).toEqual({ events: 3, packages: ['1', '2'] });
    expect((await kit.pool.query('select count(*)::int n from packages')).rows[0].n).toBe(2);
    expect(await kit.reconciler.ingestOutcome(out)).toMatchObject({ events: 0 }); // idempotent
    expect((await kit.pool.query('select count(*)::int n from chain_events')).rows[0].n).toBe(3);
  });
  it('ignores malformed logs and foreign standards', async () => {
    const out = { txHash: 'T2', logs: ['plain log', 'EVENT_JSON:{bad', ev('x', { package_id: '5' }, 'evil'), 'EVENT_JSON:' + JSON.stringify({ standard: 'andum', event: 'e', data: 'nope' })] };
    expect(await kit.reconciler.ingestOutcome(out)).toEqual({ events: 0, packages: [] });
  });
  it('package_accepted marks the invite ACCEPTED (locks the link)', async () => {
    await kit.pool.query(`insert into invites (id, sender_account, recipient_email, secret_hash, secret_enc, package_id, status) values ('i1','s','a@b.co','\\x00','\\x00',1,'VERIFIED')`);
    kit.packages.set('1', pkgView('1', { status: 'ACCEPTED', owner: 'rina.testnet' }));
    await kit.reconciler.ingestOutcome({ txHash: 'T3', logs: [ev('package_accepted', { package_id: '1', owner: 'rina.testnet' })] });
    expect((await kit.pool.query('select status from invites')).rows[0].status).toBe('ACCEPTED');
  });
  it('nft_mint events (standard nep171) point at the package too', async () => {
    kit.packages.set('3', pkgView('3'));
    const log = 'EVENT_JSON:' + JSON.stringify({ standard: 'nep171', version: '1.2.0', event: 'nft_mint', data: [{ owner_id: 'r', token_ids: ['3'] }] });
    expect((await kit.reconciler.ingestOutcome({ txHash: 'T4', logs: [log] })).packages).toEqual(['3']);
  });
  it('a chain failure leaves the cache unchanged and does not throw', async () => {
    await upsertPackage(kit.pool, pkgView('1', { status: 'FUNDED' }));
    kit.chain.transportFailures = 1;
    expect(await kit.reconciler.refresh(['1'])).toEqual([]);
    expect((await kit.pool.query('select status from packages')).rows[0].status).toBe('FUNDED');
    kit.packages.set('1', pkgView('1', { status: 'ACCEPTED' }));
    expect(await kit.reconciler.refresh(['1'])).toHaveLength(1); // the next tick recovers
    expect((await kit.pool.query('select status from packages')).rows[0].status).toBe('ACCEPTED');
  });
  it('a package that does not exist on chain is skipped, not cached', async () => {
    expect(await kit.reconciler.refresh(['404'])).toEqual([]);
    expect((await kit.pool.query('select count(*)::int n from packages')).rows[0].n).toBe(0);
  });
  it('sweep refreshes only active, recent packages (not reclaimed, not fully taken, not stale for 7 days)', async () => {
    await upsertPackage(kit.pool, pkgView('1', { status: 'ACCEPTED' }));
    await upsertPackage(kit.pool, pkgView('2', { status: 'RECLAIMED' }));
    await upsertPackage(kit.pool, pkgView('3', { status: 'ACCEPTED', parts: [part({ state: 'TAKEN', taken_ns: '5' })] }));
    await upsertPackage(kit.pool, pkgView('4', { status: 'ACCEPTED' }));
    await kit.pool.query(`update packages set updated_at = now() - interval '8 days' where id=4`);
    for (const id of ['1', '2', '3', '4']) kit.packages.set(id, pkgView(id, { status: 'ACCEPTED', note: 'fresh' }));
    expect(await kit.reconciler.sweep()).toBe(1);
    const notes = (await kit.pool.query(`select id, view->>'note' as note from packages order by id`)).rows;
    expect(notes.map((r) => r.note)).toEqual(['fresh', null, null, null]);
  });
  it('sweep works in batches of 20, oldest first', async () => {
    for (let i = 1; i <= 25; i++) { await upsertPackage(kit.pool, pkgView(String(i), { status: 'ACCEPTED' })); kit.packages.set(String(i), pkgView(String(i), { status: 'ACCEPTED' })); }
    expect(await kit.reconciler.sweep()).toBe(20);
  });
  it('sweep publishes package.updated only when something changed', async () => {
    const sub = new Redis(TEST_REDIS); const got: any[] = [];
    await sub.subscribe('andum:events'); sub.on('message', (_c, m) => got.push(JSON.parse(m)));
    const same = pkgView('1', { status: 'FUNDED', sender: 's.testnet' }); // one object: pkgView embeds a clock-derived deadline
    await upsertPackage(kit.pool, same);
    kit.packages.set('1', same);
    await kit.reconciler.sweep();
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toHaveLength(0);
    kit.packages.set('1', { ...same, status: 'ACCEPTED', owner: 'r.testnet' });
    await kit.reconciler.sweep();
    await new Promise((r) => setTimeout(r, 200)); sub.disconnect();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: 'package.updated', data: { package_id: '1', status: 'ACCEPTED' } });
    expect(got[0].accounts.sort()).toEqual(['r.testnet', 's.testnet']);
  });
  it('sweep with an empty database is a no-op', async () => { expect(await kit.reconciler.sweep()).toBe(0); });
});
