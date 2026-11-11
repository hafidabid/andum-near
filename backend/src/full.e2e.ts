/**
 * Full-stack integration (E2E-01 shape): real API + real worker + real Postgres + real Redis/BullMQ,
 * with an in-memory model of the NEAR core contract standing behind the FakeChain.
 * The model mirrors the contract rules of ANDUM-PLAN 5 (the Rust unit tests prove the real contract follows them).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { CaptureMailer, DelegateActionInput, FakeChain, ChainClient, TxOutcome, decodeSignedDelegate, resetAll, sha256, createPool, migrate, signDelegate, keypairFromSecret } from '@andum/shared';
import { createWorker } from '../../worker/src/worker.module';
import { RelayService, Notifier } from '../../worker/src/worker.module';
import { FakeEvm } from '../../worker/src/testkit';
import { createApp } from './app.module';
import { CORE, ROOT, TEST_DB, TEST_REDIS, TGAS, USDC, TestUser, login } from './testkit';
import request from 'supertest';

const NS = 1_000_000_000n;
const ev = (event: string, data: Record<string, unknown>) => 'EVENT_JSON:' + JSON.stringify({ standard: 'andum', version: '1.0.0', event, data: [data] });

/** compact model of the core contract (state machine + error codes) */
class SimCore {
  pkgs = new Map<string, any>(); next = 1; tokenBalances = new Map<string, bigint>();
  constructor(private chain: FakeChain) {
    chain.setView(CORE, 'get_package', (a) => this.view(String(a.package_id)));
    chain.onSubmit = (call) => (call.kind === 'delegate' ? this.apply(call.delegate!) : undefined);
  }
  now() { return this.chain.chainTimeNs; }
  view(id: string) {
    const p = this.pkgs.get(id); if (!p) return null;
    const parts = p.parts.map((x: any, i: number) => {
      const approved = x.approvers.length > 0 && x.approvals.length >= x.threshold;
      const dateOk = x.unlock_ns == null || this.now() >= BigInt(x.unlock_ns); const apprOk = x.approvers.length === 0 || approved;
      let status = 'OPEN', reason: string | null = null;
      if (x.state === 'TAKEN') status = 'TAKEN';
      else if (p.status !== 'ACCEPTED') { status = 'NOT_ACCEPTED'; reason = 'PACKAGE_NOT_ACTIVE'; }
      else if (!dateOk && !apprOk) { status = 'WAITING_DATE_AND_APPROVAL'; reason = 'TIME_NOT_REACHED'; }
      else if (!dateOk) { status = 'WAITING_DATE'; reason = 'TIME_NOT_REACHED'; }
      else if (!apprOk) { status = 'WAITING_APPROVAL'; reason = 'APPROVAL_MISSING'; }
      return { part_id: i, ...x, approved, status, reason };
    });
    return { ...p, parts };
  }
  fail(code: string): Partial<TxOutcome> { return { success: false, failure: `{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ANDUM_ERR:${code}"}}}}` }; }
  apply(d: ReturnType<typeof decodeSignedDelegate>): Partial<TxOutcome> {
    const a = d.actions[0] as any; const args = JSON.parse(a.args.toString()); const who = d.senderId; const logs: string[] = [];
    if (d.receiverId === CORE && a.methodName === 'create_package') {
      const c = args.args; const id = String(this.next++);
      this.pkgs.set(id, { id, sender: who, recipient: c.recipient ?? null, owner: null, invite_hash: c.invite_hash ?? null, status: 'AWAITING_FUNDS', note: c.note ?? null, theme: c.theme ?? 'none',
        accept_by_ns: c.accept_by_ns, created_ns: this.now().toString(), accepted_ns: null,
        parts: c.parts.map((p: any) => ({ token: p.token, amount: p.amount, funded: '0', unlock_ns: p.unlock_ns ?? null, approvers: p.approvers ?? [], threshold: p.approvers?.length ? (p.approval_threshold ?? 1) : 0, approvals: [], state: 'LOCKED', taken_ns: null })) });
      return { logs: [ev('package_created', { package_id: id, sender: who })] };
    }
    if (a.methodName === 'ft_transfer_call') {
      const m = JSON.parse(args.msg); const p = this.pkgs.get(m.package_id); const part = p?.parts[m.part_id];
      if (!p || !part) return this.fail('PACKAGE_NOT_FOUND'); if (p.sender !== who) return this.fail('WRONG_SENDER'); if (part.token !== d.receiverId) return this.fail('WRONG_TOKEN');
      part.funded = (BigInt(part.funded) + BigInt(args.amount)).toString(); logs.push(ev('part_funded', { package_id: p.id, part_id: m.part_id }));
      if (p.parts.every((x: any) => x.funded === x.amount)) { p.status = 'FUNDED'; logs.push(ev('package_funded', { package_id: p.id })); }
      return { logs };
    }
    const p = this.pkgs.get(args.package_id); if (!p) return this.fail('PACKAGE_NOT_FOUND');
    if (a.methodName === 'accept_package') {
      if (p.status === 'ACCEPTED') return this.fail('ALREADY_ACCEPTED'); if (p.status !== 'FUNDED') return this.fail('PACKAGE_NOT_ACTIVE');
      if (!Buffer.from(args.invite_secret ?? '', 'base64').length || sha256(Buffer.from(args.invite_secret, 'base64')).toString('base64') !== p.invite_hash) return this.fail('INVITE_SECRET_INVALID');
      if (p.parts.some((x: any) => x.approvers.includes(who))) return this.fail('RECEIVER_IS_APPROVER');
      p.owner = who; p.status = 'ACCEPTED'; return { logs: [ev('package_accepted', { package_id: p.id, owner: who })] };
    }
    if (a.methodName === 'approve_part') {
      const x = p.parts[args.part_id]; if (!x.approvers.includes(who)) return this.fail('NOT_APPROVER');
      if (!x.approvals.includes(who)) x.approvals.push(who); return { logs: [ev('part_approved', { package_id: p.id, part_id: args.part_id, approver: who })] };
    }
    if (a.methodName === 'claim') {
      if (p.owner !== who) return this.fail('NOT_PASS_OWNER'); const x = p.parts[args.part_id];
      if (x.state === 'TAKEN') return this.fail('ALREADY_TAKEN');
      if (x.unlock_ns && this.now() < BigInt(x.unlock_ns)) return this.fail('TIME_NOT_REACHED');
      if (x.approvers.length && x.approvals.length < x.threshold) return this.fail('APPROVAL_MISSING');
      x.state = 'TAKEN'; x.taken_ns = this.now().toString();
      this.tokenBalances.set(`${who}:${x.token}`, (this.tokenBalances.get(`${who}:${x.token}`) ?? 0n) + BigInt(x.amount));
      return { logs: [ev('part_claimed', { package_id: p.id, part_id: args.part_id })] };
    }
    return this.fail('BAD_MSG');
  }
}

let chain: FakeChain; let sim: SimCore; let mailer: CaptureMailer; let api: Awaited<ReturnType<typeof createApp>>; let worker: Awaited<ReturnType<typeof createWorker>>; let pool: ReturnType<typeof createPool>;
let nonce = 1n;
beforeAll(async () => {
  pool = createPool(TEST_DB, 2); await migrate(pool); await resetAll(pool);
  chain = new FakeChain(); sim = new SimCore(chain); mailer = new CaptureMailer();
  const env = { DATABASE_URL: TEST_DB, REDIS_URL: TEST_REDIS, QUEUE_PREFIX: `full${randomBytes(3).toString('hex')}`, NEAR_ROOT: ROOT, NEAR_CORE: CORE, NEAR_BRIDGE: `bridge.${ROOT}`, PUBLIC_WEB_BASE: 'https://andum.test', WORKER_AUTOSTART: false } as any;
  api = await createApp({ chain, mailer, env }); await api.init();
  worker = await createWorker({ chain, bridgeNear: new FakeChain(), mailer, evm: new FakeEvm(), env });
  worker.get(RelayService).start();
});
afterAll(async () => { await api.close(); await worker.close(); await pool.end(); });
beforeEach(async () => { await resetAll(pool); sim.pkgs.clear(); sim.next = 1; sim.tokenBalances.clear(); mailer.sent = []; nonce = 1n; });

const http = () => request(api.getHttpServer());
function sign(u: TestUser, receiver: string, method: string, args: unknown, deposit = 0n, gas = 100n * TGAS): string {
  const d: DelegateActionInput = { senderId: u.account, receiverId: receiver, actions: [{ type: 'FunctionCall', methodName: method, args: Buffer.from(JSON.stringify(args)), gas, deposit }], nonce: nonce++, maxBlockHeight: chain.blockHeight + 100n, publicKey: u.pk };
  return signDelegate(d, u.sk);
}
async function relay(u: TestUser, b64: string) {
  const r = await u.agent.post('/v1/relay/submit').send({ signed_delegate_b64: b64, client_request_id: randomBytes(6).toString('hex') });
  if (r.status !== 202) return { submitStatus: r.status, body: r.body } as any;
  for (let i = 0; i < 100; i++) {
    const s = (await u.agent.get(`/v1/relay/${r.body.relay_id}`)).body;
    if (s.status !== 'QUEUED' && s.status !== 'SUBMITTED') return { submitStatus: 202, ...s };
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('relay did not finish');
}

describe('E2E-01: the demo script across API, queue, worker, database', () => {
  it('create, fund, invite, verify, accept, take part 1, refused part 2, approve, notified, take part 2', async () => {
    const sender = await login({ app: api, pool } as any); const rina = await login({ app: api, pool } as any); const approver = await login({ app: api, pool } as any);
    const T0 = chain.chainTimeNs;
    chain.setView(`usdc.${ROOT}`, 'ft_balance_of', () => '0');

    // sender: invite -> create_package (relayed) -> fund (relayed) -> attach
    const inv = (await sender.agent.post('/v1/invites').send({ recipient_email: 'rina@example.com' })).body;
    const created = await relay(sender, sign(sender, CORE, 'create_package', { args: {
      parts: [
        { token: USDC, amount: '200000000' },
        { token: USDC, amount: '800000000', unlock_ns: (T0 + 150n * NS).toString(), approvers: [approver.account] },
      ], accept_by_ns: (T0 + 3600n * NS).toString(), invite_hash: inv.invite_hash_b64, theme: 'confetti', note: 'Thanks!' } }, 0n, 30n * TGAS));
    expect(created.status).toBe('SUCCEEDED');
    expect((await pool.query('select count(*)::int n from packages')).rows[0].n).toBe(1); // reconciler cached it
    for (const [i, amt] of [[0, '200000000'], [1, '800000000']] as const) {
      const f = await relay(sender, sign(sender, USDC, 'ft_transfer_call', { receiver_id: CORE, amount: amt, msg: JSON.stringify({ package_id: '1', part_id: i }) }, 1n, 80n * TGAS));
      expect(f.status).toBe('SUCCEEDED');
    }
    expect((await sender.agent.get('/v1/packages/1')).body.status).toBe('FUNDED');
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: created.tx_hash })).status).toBe(200);
    expect(mailer.sent.some((m) => m.to === 'rina@example.com' && /sent you/.test(m.subject))).toBe(true);

    // receiver sees funds before accepting, verifies by email, accepts
    const pub = (await http().get(`/v1/invites/${inv.invite_id}/public`)).body;
    expect(pub.package.total_by_token[USDC]).toBe('1000000000'); expect(pub.package.has_note).toBe(true);
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    const code = /(\d{6})/.exec(mailer.last('rina@example.com')!.text)![1];
    const secret = (await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code })).body;
    // accepting with a wrong secret fails with the mapped contract code
    const bad = await relay(rina, sign(rina, CORE, 'accept_package', { package_id: '1', invite_secret: Buffer.alloc(32, 1).toString('base64') }, 0n, 150n * TGAS));
    expect(bad).toMatchObject({ status: 'FAILED', error_code: 'INVITE_SECRET_INVALID' });
    const acc = await relay(rina, sign(rina, CORE, 'accept_package', secret, 0n, 150n * TGAS));
    expect(acc.status).toBe('SUCCEEDED');
    expect((await rina.agent.get('/v1/packages?role=owner')).body.items).toHaveLength(1);
    expect((await pool.query('select status from invites')).rows[0].status).toBe('ACCEPTED');
    expect((await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'too-late' })).body.error.code).toBe('LINK_LOCKED');

    // take part 1 (open now); take part 2 too early -> TIME_NOT_REACHED
    expect((await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 0 }))).status).toBe('SUCCEEDED');
    expect(sim.tokenBalances.get(`${rina.account}:${USDC}`)).toBe(200000000n);
    const early = await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }));
    expect(early).toMatchObject({ status: 'FAILED', error_code: 'TIME_NOT_REACHED' });
    // twice is refused too
    expect((await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 0 }))).error_code).toBe('ALREADY_TAKEN');
    // a stranger cannot take
    const eve = await login({ app: api, pool } as any);
    expect((await relay(eve, sign(eve, CORE, 'claim', { package_id: '1', part_id: 1 }))).error_code).toBe('NOT_PASS_OWNER');

    // date passes; still blocked without approval
    chain.chainTimeNs = T0 + 200n * NS;
    expect((await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }))).error_code).toBe('APPROVAL_MISSING');
    // time-based status is computed by the chain at read time; a cache older than 10 s is refreshed on read
    await pool.query(`update packages set updated_at = now() - interval '1 minute'`);
    expect((await rina.agent.get('/v1/packages/1')).body.parts[1]).toMatchObject({ status: 'WAITING_APPROVAL', reason: 'APPROVAL_MISSING' });
    // a stranger cannot approve; the approver can
    expect((await relay(eve, sign(eve, CORE, 'approve_part', { package_id: '1', part_id: 1 }, 0n, 30n * TGAS))).error_code).toBe('NOT_APPROVER');
    expect((await relay(approver, sign(approver, CORE, 'approve_part', { package_id: '1', part_id: 1 }, 0n, 30n * TGAS))).status).toBe('SUCCEEDED');

    // notifier: part_ready email goes out once the chain agrees the part is open
    await pool.query(`update parts set unlock_ns = $1 where package_id=1 and part_id=1`, [(T0 + 150n * NS).toString()]);
    const notifier = worker.get(Notifier);
    expect((await notifier.tick(T0 + 200n * NS)).partReady).toBeGreaterThanOrEqual(1);
    await notifier.tick(T0 + 201n * NS);
    expect(mailer.sent.filter((m) => /ready/i.test(m.subject))).toHaveLength(1);

    // take part 2; everything taken; further takes refused
    expect((await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }))).status).toBe('SUCCEEDED');
    expect(sim.tokenBalances.get(`${rina.account}:${USDC}`)).toBe(1000000000n);
    expect((await relay(rina, sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }))).error_code).toBe('ALREADY_TAKEN');

    // history is queryable for parties
    const events = (await sender.agent.get('/v1/packages/1/events')).body.map((e: any) => e.event);
    expect(events).toEqual(expect.arrayContaining(['package_created', 'part_funded', 'package_funded', 'package_accepted', 'part_approved', 'part_claimed']));
    expect((await eve.agent.get('/v1/packages/1/events')).status).toBe(403);
  });

  it('negative: nobody can fund someone else\'s package, over/under policy calls never reach the chain', async () => {
    const sender = await login({ app: api, pool } as any); const mallory = await login({ app: api, pool } as any);
    const T0 = chain.chainTimeNs;
    const created = await relay(sender, sign(sender, CORE, 'create_package', { args: { parts: [{ token: USDC, amount: '5' }], accept_by_ns: (T0 + 100n * NS).toString(), invite_hash: Buffer.alloc(32, 2).toString('base64') } }, 0n, 30n * TGAS));
    expect(created.status).toBe('SUCCEEDED');
    const f = await relay(mallory, sign(mallory, USDC, 'ft_transfer_call', { receiver_id: CORE, amount: '5', msg: JSON.stringify({ package_id: '1', part_id: 0 }) }, 1n, 80n * TGAS));
    expect(f).toMatchObject({ status: 'FAILED', error_code: 'WRONG_SENDER' });
    const submittedBefore = chain.submitted.length;
    const denied = await relay(mallory, sign(mallory, 'evil.testnet', 'steal', {}));
    expect(denied.submitStatus).toBe(403);
    expect(chain.submitted.length).toBe(submittedBefore);
  });

  it('edge: reclaim-style unaccepted flow leaves the invite usable until accepted; a second user cannot attach the same package', async () => {
    const sender = await login({ app: api, pool } as any); const other = await login({ app: api, pool } as any);
    const T0 = chain.chainTimeNs;
    const inv = (await sender.agent.post('/v1/invites').send({ recipient_email: 'a@example.com' })).body;
    await relay(sender, sign(sender, CORE, 'create_package', { args: { parts: [{ token: USDC, amount: '5' }], accept_by_ns: (T0 + 100n * NS).toString(), invite_hash: inv.invite_hash_b64 } }, 0n, 30n * TGAS));
    const inv2 = (await other.agent.post('/v1/invites').send({ recipient_email: 'b@example.com' })).body;
    expect((await other.agent.post(`/v1/invites/${inv2.invite_id}/attach`).send({ package_id: '1', tx_hash: 'x' })).status).toBe(403);
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: 'x' })).status).toBe(200);
  });
});
void keypairFromSecret; void migrate;
