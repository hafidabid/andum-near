import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import request from 'supertest';
import { RELAY_QUEUE, resetAll, setKill } from '@andum/shared';
import { BRIDGE, CORE, Kit, TGAS, TestUser, USDC, delegate, login, startKit, TEST_REDIS } from './testkit';

let kit: Kit; let u: TestUser; let v: TestUser; let q: Queue | undefined;
beforeAll(async () => { kit = await startKit(); });
afterAll(async () => { await q?.close(); await kit.close(); });
beforeEach(async () => {
  await resetAll(kit.pool); kit.chain.transportFailures = 0; kit.chain.submitted = [];
  u = await login(kit); v = await login(kit);
  kit.chain.blockHeight = 1000n;
});
const submit = (who: TestUser, b64: string, id = 'req-1', extra: Record<string, unknown> = {}) => who.agent.post('/v1/relay/submit').send({ signed_delegate_b64: b64, client_request_id: id, purpose: 'test', ...extra });
const fund = (who: TestUser, o: Record<string, unknown> = {}) => delegate(who, { receiver: USDC, method: 'ft_transfer_call', deposit: 1n, gas: 80n * TGAS, args: { receiver_id: CORE, amount: '100', msg: JSON.stringify({ package_id: '1', part_id: 0 }) }, ...o });

describe('POST /relay/submit (A-04)', () => {
  it('accepts an allowed claim: 202, stored QUEUED, job in the Redis queue', async () => {
    const r = await submit(u, delegate(u));
    expect(r.status).toBe(202); expect(r.body.status).toBe('QUEUED');
    const row = (await kit.pool.query('select * from relay_jobs where id=$1', [r.body.relay_id])).rows[0];
    expect(row.status).toBe('QUEUED'); expect(row.method).toBe('claim'); expect(row.account_id).toBe(u.account);
    const conn = new Redis(TEST_REDIS, { maxRetriesPerRequest: null });
    const keys = await conn.keys(`*:${RELAY_QUEUE}:${r.body.relay_id}`);
    expect(keys.length).toBe(1);
    conn.disconnect();
    expect(kit.chain.submitted).toHaveLength(0); // the API never submits; the worker does
  });
  it('accepts funding transfers (1 yocto) and approvals/accept/reclaim/create', async () => {
    expect((await submit(u, fund(u), 'a')).status).toBe(202);
    expect((await submit(u, delegate(u, { method: 'approve_part', gas: 30n * TGAS, nonce: 2n }), 'b')).status).toBe(202);
    expect((await submit(u, delegate(u, { method: 'accept_package', args: { package_id: '1', invite_secret: 'abc' }, gas: 150n * TGAS, nonce: 3n }), 'c')).status).toBe(202);
    expect((await submit(u, delegate(u, { method: 'create_package', args: { args: { parts: [] } }, gas: 30n * TGAS, nonce: 4n }), 'd')).status).toBe(202);
  });
  it('R1: a delegate signed for another account is refused', async () => {
    const r = await submit(u, delegate(v)); // v's delegate in u's session
    expect(r.status).toBe(401); expect(r.body.error.details.rule).toBe('R1');
  });
  it('R2: tampered signature is refused', async () => {
    const raw = Buffer.from(delegate(u), 'base64'); raw[raw.length - 5] ^= 1;
    const r = await submit(u, raw.toString('base64'));
    expect(r.status).toBe(401); expect(r.body.error.details.rule).toBe('R2');
  });
  it('R3: expired and too-far heights', async () => {
    const e = await submit(u, delegate(u, { height: 1000n }), 'e');
    expect(e.status).toBe(400); expect(e.body.error.code).toBe('RELAY_EXPIRED');
    const f = await submit(u, delegate(u, { height: 1201n }), 'f');
    expect(f.status).toBe(403); expect(f.body.error.code).toBe('RELAY_POLICY_DENIED'); expect(f.body.error.details.rule).toBe('R3');
    expect((await submit(u, delegate(u, { height: 1200n }), 'g')).status).toBe(202); // boundary
  });
  it('R4: a nonce not above the chain key nonce is refused', async () => {
    kit.chain.setKeyNonce(u.account, u.pk, 7n);
    const r = await submit(u, delegate(u, { nonce: 7n }));
    expect(r.status).toBe(403); expect(r.body.error.details.rule).toBe('R4');
    expect((await submit(u, delegate(u, { nonce: 8n }), 'ok')).status).toBe(202);
  });
  it('R5: receivers, methods and shapes outside the allowlist', async () => {
    for (const [i, d] of [delegate(u, { receiver: 'evil.testnet' }), delegate(u, { method: 'new' }), delegate(u, { receiver: USDC, method: 'ft_burn_privileged' }), delegate(u, { receiver: BRIDGE, method: 'bridge_in' })].entries()) {
      const r = await submit(u, d, `r5-${i}`);
      expect(r.status).toBe(403); expect(r.body.error.code).toBe('RELAY_POLICY_DENIED'); expect(r.body.error.details.rule).toBe('R5');
    }
  });
  it('R6: wrong deposit', async () => {
    expect((await submit(u, delegate(u, { deposit: 1n }), 'x')).body.error.details.rule).toBe('R6');
    expect((await submit(u, fund(u, { deposit: 0n }), 'y')).body.error.details.rule).toBe('R6');
    expect((await submit(u, fund(u, { deposit: 10n ** 24n }), 'z')).body.error.details.rule).toBe('R6'); // attempt to spend a lot of NEAR
  });
  it('R7: too much gas', async () => {
    expect((await submit(u, delegate(u, { gas: 300n * TGAS }))).body.error.details.rule).toBe('R7');
  });
  it('R8: arguments', async () => {
    expect((await submit(u, delegate(u, { args: { package_id: 1, part_id: 0 } }), 'a')).body.error.details.rule).toBe('R8');
    expect((await submit(u, delegate(u, { receiver: USDC, method: 'ft_mint', gas: 30n * TGAS, args: { account_id: v.account, amount: '1' } }), 'b')).body.error.details.rule).toBe('R8');
    expect((await submit(u, fund(u, { args: { receiver_id: 'attacker.testnet', amount: '1', msg: '{}' } }), 'c')).body.error.details.rule).toBe('R8');
  });
  it('R9: per-minute quota', async () => {
    for (let i = 0; i < 30; i++) expect((await submit(u, delegate(u, { nonce: BigInt(i + 1) }), `q${i}`)).status).toBe(202);
    const r = await submit(u, delegate(u, { nonce: 99n }), 'q-over');
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('RATE_LIMITED'); expect(r.body.error.details.rule).toBe('R9');
    // another user is unaffected
    expect((await submit(v, delegate(v))).status).toBe(202);
  });
  it('R9: faucet mints are limited to 3 a minute', async () => {
    const mint = (n: bigint) => delegate(u, { receiver: USDC, method: 'ft_mint', gas: 30n * TGAS, args: { account_id: u.account, amount: '5' }, nonce: n });
    for (let i = 0; i < 3; i++) expect((await submit(u, mint(BigInt(i + 1)), `m${i}`)).status).toBe(202);
    expect((await submit(u, mint(10n), 'm-over')).status).toBe(429);
  });
  it('R10: the same signed payload cannot be submitted twice (even with a new request id)', async () => {
    const d = delegate(u);
    expect((await submit(u, d, 'one')).status).toBe(202);
    const r = await submit(u, d, 'two');
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('RELAY_DUPLICATE');
    expect((await submit(v, d, 'three')).status).toBe(401); // and nobody else can replay it either (R1)
  });
  it('R11: kill switch', async () => {
    await setKill(kit.pool, 'relayer', true);
    const r = await submit(u, delegate(u));
    expect(r.status).toBe(403); expect(r.body.error.details.rule).toBe('R11');
    await setKill(kit.pool, 'relayer', false);
    expect((await submit(u, delegate(u), 'again')).status).toBe(202);
  });
  it('client_request_id makes the call idempotent; a different payload under the same id is a conflict', async () => {
    const d = delegate(u);
    const a = await submit(u, d, 'same'); const b = await submit(u, d, 'same');
    expect(b.status).toBe(202); expect(b.body.relay_id).toBe(a.body.relay_id);
    expect((await kit.pool.query('select count(*)::int n from relay_jobs')).rows[0].n).toBe(1);
    const c = await submit(u, delegate(u, { nonce: 2n }), 'same');
    expect(c.status).toBe(409); expect(c.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('Idempotency-Key header replays the original response and rejects a different body', async () => {
    const d = delegate(u);
    const a = await u.agent.post('/v1/relay/submit').set('Idempotency-Key', 'k1').send({ signed_delegate_b64: d, client_request_id: 'c1' });
    const b = await u.agent.post('/v1/relay/submit').set('Idempotency-Key', 'k1').send({ signed_delegate_b64: d, client_request_id: 'c1' });
    expect(b.status).toBe(a.status); expect(b.body).toEqual(a.body); expect(b.headers['idempotent-replay']).toBe('true');
    const c = await u.agent.post('/v1/relay/submit').set('Idempotency-Key', 'k1').send({ signed_delegate_b64: delegate(u, { nonce: 2n }), client_request_id: 'c2' });
    expect(c.status).toBe(409); expect(c.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('rejects malformed bodies, garbage payloads and oversize payloads', async () => {
    expect((await u.agent.post('/v1/relay/submit').send({})).status).toBe(400);
    expect((await submit(u, 'AAAA'.repeat(10))).status).toBe(400);
    expect((await submit(u, Buffer.from('not a delegate action at all, sorry').toString('base64'))).status).toBe(400);
    expect((await submit(u, 'A'.repeat(31_000))).status).toBe(400);
    expect((await u.agent.post('/v1/relay/submit').send({ signed_delegate_b64: delegate(u), client_request_id: '' })).status).toBe(400);
    expect((await kit.pool.query('select count(*)::int n from relay_jobs')).rows[0].n).toBe(0);
  });
  it('requires a session', async () => {
    expect((await request(kit.app.getHttpServer()).post('/v1/relay/submit').send({ signed_delegate_b64: delegate(u), client_request_id: 'x' })).status).toBe(401);
  });
  it('chain outage while checking policy is a 503 and queues nothing', async () => {
    kit.chain.transportFailures = 1;
    const r = await submit(u, delegate(u));
    expect(r.status).toBe(503); expect(r.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect((await kit.pool.query('select count(*)::int n from relay_jobs')).rows[0].n).toBe(0);
  });
  it('a failed policy check is not recorded as a job (denied calls cannot fill the table)', async () => {
    for (let i = 0; i < 5; i++) await submit(u, delegate(u, { receiver: 'evil.testnet', nonce: BigInt(i + 1) }), `evil${i}`);
    expect((await kit.pool.query('select count(*)::int n from relay_jobs')).rows[0].n).toBe(0);
  });
});

describe('GET /relay/:id', () => {
  it('returns status for the owner only', async () => {
    const r = await submit(u, delegate(u));
    const s = await u.agent.get(`/v1/relay/${r.body.relay_id}`);
    expect(s.status).toBe(200); expect(s.body.status).toBe('QUEUED');
    expect((await v.agent.get(`/v1/relay/${r.body.relay_id}`)).status).toBe(404);
    expect((await request(kit.app.getHttpServer()).get(`/v1/relay/${r.body.relay_id}`)).status).toBe(401);
  });
  it('exposes the mapped contract error code after a failure', async () => {
    const r = await submit(u, delegate(u));
    await kit.pool.query(`update relay_jobs set status='FAILED', error_code='TIME_NOT_REACHED', error_message='x' where id=$1`, [r.body.relay_id]);
    const s = await u.agent.get(`/v1/relay/${r.body.relay_id}`);
    expect(s.body).toMatchObject({ status: 'FAILED', error_code: 'TIME_NOT_REACHED' });
  });
  it('bad ids are 404, not 500', async () => {
    expect((await u.agent.get('/v1/relay/not-a-uuid')).status).toBe(404);
    expect((await u.agent.get('/v1/relay/11111111-1111-1111-1111-111111111111')).status).toBe(404);
    expect((await u.agent.get("/v1/relay/1' or '1'='1")).status).toBe(404);
  });
});
void Queue;
