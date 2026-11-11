/**
 * Narrated demo of the whole backend (API + BullMQ + worker + Postgres), with an in-memory model of the core contract.
 * Run:  cd backend && DEMO_DB=postgres://andum@localhost:5544/andum_demo npx vitest run --config ../scripts/demo/vitest.config.ts
 * Prints coloured, human-readable steps. Used to record the demo videos in docs/report.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { randomBytes } from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import request from 'supertest';
import { CaptureMailer, DelegateActionInput, FakeChain, TxOutcome, decodeSignedDelegate, resetAll, sha256, createPool, migrate, signDelegate, keypairFromSecret } from '@andum/shared';
import { createWorker, RelayService, Notifier } from '../../worker/src/worker.module';
import { FakeEvm } from '../../worker/src/testkit';
import { createApp } from '../../backend/src/app.module';

const DB = process.env.DEMO_DB ?? 'postgres://andum@localhost:5544/andum_demo';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390';
const ROOT = 'andum-hack.testnet', CORE = `core.${ROOT}`, USDC = `usdc.${ROOT}`, TGAS = 10n ** 12n, NS = 1_000_000_000n;
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


// ------------------------------------------------------------------ narration helpers
const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', m: '\x1b[35m', R: '\x1b[31m', B: '\x1b[34m' };
const out = (s = '') => process.stdout.write(s + '\n');
const step = (n: number, t: string) => out(`\n${C.b}${C.m}━━ ${n}. ${t}${C.r}`);
const note = (t: string) => out(`${C.d}   # ${t}${C.r}`);
const short = (v: unknown) => { const s = JSON.stringify(v); return s.length > 150 ? s.slice(0, 147) + '…' : s; };
const ok = (t: string) => out(`   ${C.g}✔ ${t}${C.r}`);
const bad = (t: string) => out(`   ${C.y}✖ ${t}${C.r}`);

class Who {
  agent: ReturnType<typeof request.agent>; sk!: Uint8Array; pk = ''; account = '';
  constructor(public name: string, app: any) { this.agent = request.agent(app.getHttpServer()); }
  async call(method: 'get' | 'post' | 'put' | 'patch', path: string, body?: unknown, quiet = false) {
    const r = await (this.agent as any)[method](path).send(body);
    if (!quiet) {
      const col = r.status < 300 ? C.g : C.R;
      out(`   ${C.c}${this.name} ${C.b}${method.toUpperCase()} ${path}${C.r}${body ? C.d + ' ' + short(body) + C.r : ''}`);
      out(`   ${col}↳ ${r.status}${C.r} ${C.d}${short(r.body)}${C.r}`);
    }
    return r;
  }
}

let chain: FakeChain; let sim: SimCore; let mailer: CaptureMailer; let api: Awaited<ReturnType<typeof createApp>>; let worker: Awaited<ReturnType<typeof createWorker>>; let pool: ReturnType<typeof createPool>;
let nonce = 1n;
beforeAll(async () => {
  pool = createPool(DB, 2); await migrate(pool); await resetAll(pool);
  chain = new FakeChain(); sim = new SimCore(chain); mailer = new CaptureMailer();
  const env = { DATABASE_URL: DB, REDIS_URL: REDIS, QUEUE_PREFIX: `demo${randomBytes(3).toString('hex')}`, NEAR_ROOT: ROOT, NEAR_CORE: CORE, NEAR_BRIDGE: `bridge.${ROOT}`, PUBLIC_WEB_BASE: 'https://andum.app', WORKER_AUTOSTART: false } as any;
  api = await createApp({ chain, mailer, env }); await api.init();
  worker = await createWorker({ chain, bridgeNear: new FakeChain(), mailer, evm: new FakeEvm(), env });
  worker.get(RelayService).start();
});
afterAll(async () => { await api.close(); await worker.close(); await pool.end(); });

function sign(u: Who, receiver: string, method: string, args: unknown, deposit = 0n, gas = 100n * TGAS): string {
  const d: DelegateActionInput = { senderId: u.account, receiverId: receiver, actions: [{ type: 'FunctionCall', methodName: method, args: Buffer.from(JSON.stringify(args)), gas, deposit }], nonce: nonce++, maxBlockHeight: chain.blockHeight + 100n, publicKey: u.pk };
  return signDelegate(d, u.sk);
}
async function relay(u: Who, what: string, b64: string) {
  out(`   ${C.c}${u.name} signs a delegate action in the browser: ${C.b}${what}${C.r}${C.d}  (NEP-366, ${b64.length} b64 chars; user pays no gas)${C.r}`);
  const sub = await (u.agent as any).post('/v1/relay/submit').send({ signed_delegate_b64: b64, client_request_id: randomBytes(6).toString('hex') });
  if (sub.status !== 202) { bad(`API refused before the chain: ${sub.status} ${sub.body?.error?.code}`); return { ...sub.body, status: 'REFUSED' } as any; }
  for (let i = 0; i < 100; i++) {
    const s = (await u.agent.get(`/v1/relay/${sub.body.relay_id}`)).body;
    if (s.status !== 'QUEUED' && s.status !== 'SUBMITTED') {
      if (s.status === 'SUCCEEDED') ok(`worker relayed it on chain: SUCCEEDED  ${C.d}tx ${String(s.tx_hash).slice(0, 18)}…${C.r}`);
      else bad(`chain rejected it: ${s.status} ${C.b}${s.error_code}${C.r}${C.y} ${C.d}${s.error_message ?? ''}${C.r}`);
      return s;
    }
    await new Promise((res) => setTimeout(res, 40));
  }
  throw new Error('relay stuck');
}
async function emailLogin(u: Who, email: string, skipStart = false) {
  await u.call('get', '/v1/auth/nonce', undefined, true);
  if (!skipStart) await u.call('post', '/v1/auth/email/start', { email });
  const code = /(\d{6})/.exec(mailer.last(email)!.text)![1];
  out(`   ${C.y}✉  SMTP inbox of ${email}: "Your Andum sign-in code" → ${C.b}${code}${C.r}`);
  await u.call('post', '/v1/auth/email/verify', { email, code });
  // the browser generates the NEAR key, then binds it with a signature over a server nonce
  u.sk = randomBytes(32); const kp = keypairFromSecret(new Uint8Array(u.sk)); u.pk = kp.publicKey; u.account = kp.accountId;
  const n = (await u.agent.get('/v1/auth/nonce')).body.nonce;
  const signature = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${n}:${kp.accountId}`), u.sk)).toString('base64');
  await u.call('post', '/v1/auth/key', { public_key: kp.publicKey, signature, nonce: n });
  ok(`${u.name} is signed in; NEAR account ${C.b}${u.account.slice(0, 16)}…${C.r}${C.g} lives only in the browser (non-custodial)`);
}

describe('Andum demo', () => {
  it('story', async () => {
    out(`${C.b}ANDUM backend demo${C.r}  ${C.d}real NestJS API · BullMQ/Redis · PostgreSQL · worker (relayer, reconciler, notifier) · in-memory contract model${C.r}`);
    const T0 = chain.chainTimeNs;
    const sender = new Who('Sender', api), rina = new Who('Rina ', api), approver = new Who('Appr. ', api), eve = new Who('Eve   ', api);
    chain.setView(`usdc.${ROOT}`, 'ft_balance_of', () => '0');

    step(1, 'Sender signs in with an email code (SMTP)');
    await emailLogin(sender, 'sender@example.com');
    step(2, 'Negative: a wrong email code is refused; asking for another code too soon is rate-limited');
    const bogus = new Who('Eve   ', api);
    await bogus.call('post', '/v1/auth/email/start', { email: 'eve@example.com' });
    const wrong = await bogus.call('post', '/v1/auth/email/verify', { email: 'eve@example.com', code: '000000' });
    wrong.status === 400 || wrong.status === 401 ? bad('a wrong code is refused') : null;
    await bogus.call('post', '/v1/auth/email/start', { email: 'eve@example.com' });
    await emailLogin(eve, 'eve@example.com', true);

    step(3, 'Sender builds a 2-part package: part 1 open now, part 2 opens by date AND needs approval');
    await emailLogin(approver, 'approver@example.com');
    const inv = (await sender.call('post', '/v1/invites', { recipient_email: 'rina@example.com' })).body;
    const created = await relay(sender, 'create_package (2 parts, 1000 USDC)', sign(sender, CORE, 'create_package', { args: {
      parts: [{ token: USDC, amount: '200000000' }, { token: USDC, amount: '800000000', unlock_ns: (T0 + 150n * NS).toString(), approvers: [approver.account] }],
      accept_by_ns: (T0 + 3600n * NS).toString(), invite_hash: inv.invite_hash_b64, theme: 'confetti', note: 'Thanks for the audit!' } }, 0n, 30n * TGAS));
    step(4, 'Sender funds each part (ft_transfer_call), then attaches the invite → email goes to Rina');
    for (const [i, amt] of [[0, '200000000'], [1, '800000000']] as const)
      await relay(sender, `fund part ${i + 1}`, sign(sender, USDC, 'ft_transfer_call', { receiver_id: CORE, amount: amt, msg: JSON.stringify({ package_id: '1', part_id: i }) }, 1n, 80n * TGAS));
    await sender.call('post', `/v1/invites/${inv.invite_id}/attach`, { package_id: '1', tx_hash: created.tx_hash });
    out(`   ${C.y}✉  inbox of rina@example.com: "${mailer.last('rina@example.com')!.subject}"${C.r}`);

    step(5, 'Rina opens the link: she sees the funds BEFORE accepting, proves her email, gets the secret');
    const pub = (await (rina.agent as any).get(`/v1/invites/${inv.invite_id}/public`)).body;
    out(`   ${C.c}public preview${C.r} ${C.d}${short({ total_by_token: pub.package.total_by_token, parts: pub.package.parts?.length, has_note: pub.package.has_note })}${C.r}`);
    await rina.call('post', `/v1/invites/${inv.invite_id}/verify/start`);
    const code = /(\d{6})/.exec(mailer.last('rina@example.com')!.text)![1];
    out(`   ${C.y}✉  inbox: invite code ${C.b}${code}${C.r}`);
    const secret = (await rina.call('post', `/v1/invites/${inv.invite_id}/verify/confirm`, { code })).body;
    await emailLogin(rina, 'rina@example.com');

    step(6, 'Negative: accepting with a wrong secret is refused by the contract');
    await relay(rina, 'accept_package (WRONG secret)', sign(rina, CORE, 'accept_package', { package_id: '1', invite_secret: Buffer.alloc(32, 1).toString('base64') }, 0n, 150n * TGAS));
    step(7, 'Accept with the real secret → Rina owns the non-transferable pass');
    await relay(rina, 'accept_package', sign(rina, CORE, 'accept_package', secret, 0n, 150n * TGAS));

    step(8, 'Take part 1 (open now)');
    await relay(rina, 'claim part 1', sign(rina, CORE, 'claim', { package_id: '1', part_id: 0 }));
    note(`Rina's balance in the model: ${Number(sim.tokenBalances.get(`${rina.account}:${USDC}`) ?? 0n) / 1e6} USDC`);

    step(9, 'Negative: part 2 too early, taking part 1 twice, a stranger taking, relayer policy');
    await relay(rina, 'claim part 2 (too early)', sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }));
    await relay(rina, 'claim part 1 again', sign(rina, CORE, 'claim', { package_id: '1', part_id: 0 }));
    await relay(eve, 'claim part 2 as a stranger', sign(eve, CORE, 'claim', { package_id: '1', part_id: 1 }));
    await relay(eve, 'call an unknown contract (policy R: allowlist)', sign(eve, 'evil.testnet', 'steal', {}));

    step(10, 'Date passes but approval is still missing');
    chain.chainTimeNs = T0 + 200n * NS; note('chain clock advanced +200 s');
    await relay(rina, 'claim part 2 (date ok, no approval)', sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }));
    await pool.query(`update packages set updated_at = now() - interval '1 minute'`);
    const st = (await rina.agent.get('/v1/packages/1')).body.parts[1];
    out(`   ${C.c}part 2 status${C.r} ${C.b}${st.status}${C.r} ${C.d}reason ${st.reason}${C.r}`);

    step(11, 'Approver approves (a stranger cannot)');
    await relay(eve, 'approve part 2 as a stranger', sign(eve, CORE, 'approve_part', { package_id: '1', part_id: 1 }, 0n, 30n * TGAS));
    await relay(approver, 'approve part 2', sign(approver, CORE, 'approve_part', { package_id: '1', part_id: 1 }, 0n, 30n * TGAS));

    step(12, 'Notifier emails Rina "part 2 is ready", exactly once');
    await pool.query(`update parts set unlock_ns = $1 where package_id=1 and part_id=1`, [(T0 + 150n * NS).toString()]);
    const notifier = worker.get(Notifier);
    await notifier.tick(T0 + 200n * NS); await notifier.tick(T0 + 201n * NS);
    for (const m of mailer.sent.filter((m) => /ready/i.test(m.subject))) out(`   ${C.y}✉  ${m.to}: "${m.subject}"${C.r}`);

    step(13, 'Take part 2 → everything claimed');
    await relay(rina, 'claim part 2', sign(rina, CORE, 'claim', { package_id: '1', part_id: 1 }));
    note(`Rina's balance in the model: ${Number(sim.tokenBalances.get(`${rina.account}:${USDC}`) ?? 0n) / 1e6} USDC`);

    step(14, 'History is visible to parties only');
    const evs = (await sender.agent.get('/v1/packages/1/events')).body.map((e: any) => e.event);
    out(`   ${C.c}Sender events${C.r} ${C.d}${evs.join(', ')}${C.r}`);
    const forbidden = await eve.call('get', '/v1/packages/1/events');
    forbidden.status === 403 && bad('stranger is refused (403)');
    out(`\n${C.b}${C.g}Demo complete: ${(await pool.query('select count(*)::int n from relay_jobs where status=\'SUCCEEDED\'')).rows[0].n} relayed transactions, ${mailer.sent.length} emails, 0 gas paid by users.${C.r}`);
  });
});
