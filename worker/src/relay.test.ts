import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { RELAY_QUEUE, resetAll, setKill } from '@andum/shared';
import { CORE, WKit, ev, jobRow, pkgView, queuedJob, startWorkerKit, TEST_REDIS } from './testkit';

let kit: WKit;
beforeAll(async () => { kit = await startWorkerKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.chain.submitted = []; kit.chain.onSubmit = undefined; kit.chain.transportFailures = 0; kit.chain.blockHeight = 1000n; kit.packages.clear(); });

describe('relayer worker (A-04)', () => {
  it('submits a queued delegate, stores events, refreshes the package cache, marks SUCCEEDED', async () => {
    const j = await queuedJob(kit);
    kit.packages.set('1', pkgView('1', { status: 'ACCEPTED' }));
    kit.chain.onSubmit = () => ({ logs: [ev('part_claimed', { package_id: '1', part_id: 0 })] });
    expect(await kit.relay.process(j.id)).toBe('SUCCEEDED');
    const row = await jobRow(kit, j.id);
    expect(row.status).toBe('SUCCEEDED'); expect(row.tx_hash).toMatch(/^FAKE/); expect(row.outcome).toMatchObject({ events: 1, packages: ['1'] });
    expect(kit.chain.submitted).toHaveLength(1);
    expect((await kit.pool.query('select event from chain_events')).rows).toEqual([{ event: 'part_claimed' }]);
    expect((await kit.pool.query('select status from packages where id=1')).rows[0].status).toBe('ACCEPTED');
  });
  it('a contract failure is final: FAILED with the ANDUM code, never retried', async () => {
    const j = await queuedJob(kit);
    kit.chain.onSubmit = () => ({ success: false, failure: '{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ANDUM_ERR:TIME_NOT_REACHED"}}' });
    expect(await kit.relay.process(j.id)).toBe('FAILED');
    const row = await jobRow(kit, j.id);
    expect(row).toMatchObject({ status: 'FAILED', error_code: 'TIME_NOT_REACHED' });
    expect(kit.chain.submitted).toHaveLength(1);
    expect(await kit.relay.process(j.id)).toBe('SKIPPED'); // a re-delivery does not retry it either
    expect(kit.chain.submitted).toHaveLength(1);
  });
  it('an unknown failure text maps to RELAY_CHAIN_FAILURE', async () => {
    const j = await queuedJob(kit);
    kit.chain.onSubmit = () => ({ success: false, failure: 'out of gas' });
    await kit.relay.process(j.id);
    expect((await jobRow(kit, j.id)).error_code).toBe('RELAY_CHAIN_FAILURE');
  });
  it('transport errors are retried and then succeed', async () => {
    const j = await queuedJob(kit);
    kit.chain.transportFailures = 2;
    expect(await kit.relay.process(j.id)).toBe('SUCCEEDED');
    expect(kit.chain.submitted).toHaveLength(1);
  });
  it('persistent transport errors end as FAILED UPSTREAM_UNAVAILABLE after the retry budget', async () => {
    const j = await queuedJob(kit);
    kit.chain.transportFailures = 100;
    expect(await kit.relay.process(j.id)).toBe('FAILED');
    expect((await jobRow(kit, j.id)).error_code).toBe('UPSTREAM_UNAVAILABLE');
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('re-checks policy: an expired delegate is REJECTED and never submitted', async () => {
    const j = await queuedJob(kit, { height: 1100n });
    kit.chain.blockHeight = 1100n; // the chain moved on while the job waited
    expect(await kit.relay.process(j.id)).toBe('REJECTED');
    const row = await jobRow(kit, j.id);
    expect(row.status).toBe('REJECTED'); expect(row.error_message).toContain('R3');
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('re-checks policy: a stale nonce is REJECTED', async () => {
    const j = await queuedJob(kit, { nonce: 3n });
    kit.chain.setKeyNonce(j.account, j.pk, 5n);
    expect(await kit.relay.process(j.id)).toBe('REJECTED');
    expect((await jobRow(kit, j.id)).error_message).toContain('R4');
  });
  it('the kill switch stops queued jobs', async () => {
    const j = await queuedJob(kit);
    await setKill(kit.pool, 'relayer', true);
    expect(await kit.relay.process(j.id)).toBe('REJECTED');
    expect((await jobRow(kit, j.id)).error_message).toContain('R11');
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('the job itself is not counted as a duplicate or against its own quota', async () => {
    const j = await queuedJob(kit);
    expect(await kit.relay.process(j.id)).toBe('SUCCEEDED');
  });
  it('processing the same job twice calls the chain once (I-3 for relays)', async () => {
    const j = await queuedJob(kit);
    const [a, b] = await Promise.all([kit.relay.process(j.id), kit.relay.process(j.id)]);
    expect([a, b].sort()).toEqual(['SKIPPED', 'SUCCEEDED']);
    expect(kit.chain.submitted).toHaveLength(1);
  });
  it('unknown job id and undecodable payloads', async () => {
    expect(await kit.relay.process('11111111-1111-1111-1111-111111111111')).toBe('SKIPPED');
    const j = await queuedJob(kit);
    await kit.pool.query(`update relay_jobs set signed_delegate_b64='AAAA' where id=$1`, [j.id]);
    expect(await kit.relay.process(j.id)).toBe('REJECTED');
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('an ingest failure after a successful submit does not turn success into failure', async () => {
    const j = await queuedJob(kit);
    kit.chain.onSubmit = () => ({ logs: [ev('part_claimed', { package_id: '9', part_id: 0 })] });
    kit.chain.setView(CORE, 'get_package', () => { throw new Error('view exploded'); });
    expect(await kit.relay.process(j.id)).toBe('SUCCEEDED');
    expect((await jobRow(kit, j.id)).status).toBe('SUCCEEDED');
  });
  it('end to end through the Redis queue: the BullMQ worker picks the job up', async () => {
    const prefix = `e2e${Date.now()}`;
    const own = await startWorkerKit({ QUEUE_PREFIX: prefix });
    try {
      own.relay.start();
      const j = await queuedJob(own);
      const q = new Queue(RELAY_QUEUE, { connection: new Redis(TEST_REDIS, { maxRetriesPerRequest: null }), prefix });
      await q.add('relay', { relayId: j.id }, { jobId: j.id });
      for (let i = 0; i < 50; i++) { if ((await jobRow(own, j.id)).status === 'SUCCEEDED') break; await new Promise((r) => setTimeout(r, 100)); }
      expect((await jobRow(own, j.id)).status).toBe('SUCCEEDED');
      expect(own.chain.submitted).toHaveLength(1);
      await q.close();
    } finally { await own.close(); }
  });
  it('publishes relay.updated on completion for live updates', async () => {
    const sub = new Redis(TEST_REDIS); const got: string[] = [];
    await sub.subscribe('andum:events'); sub.on('message', (_c, m) => got.push(m));
    const j = await queuedJob(kit);
    await kit.relay.process(j.id);
    await new Promise((r) => setTimeout(r, 200)); sub.disconnect();
    expect(got.map((g) => JSON.parse(g)).find((m) => m.type === 'relay.updated')).toMatchObject({ accounts: [j.account], data: { status: 'SUCCEEDED' } });
  });
});
