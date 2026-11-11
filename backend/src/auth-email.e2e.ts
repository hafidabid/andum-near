import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { keypairFromSecret, resetAll, unwrapSeed, wrapSeed } from '@andum/shared';
import { Kit, startKit } from './testkit';

let kit: Kit;
beforeAll(async () => { kit = await startKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.mailer.sent = []; kit.mailer.failNext = 0; });

const http = () => request(kit.app.getHttpServer());
const codeFor = (email: string) => /(\d{6})/.exec(kit.mailer.last(email)!.text)![1];

async function emailLogin(email = 'rina@example.com') {
  const agent = request.agent(kit.app.getHttpServer());
  expect((await agent.post('/v1/auth/email/start').send({ email })).status).toBe(200);
  const r = await agent.post('/v1/auth/email/verify').send({ email, code: codeFor(email) });
  expect(r.status).toBe(200);
  return { agent, body: r.body };
}
async function bind(agent: ReturnType<typeof request.agent>, seed = randomBytes(32), extra: Record<string, unknown> = {}) {
  const sk = new Uint8Array(seed); const kp = keypairFromSecret(sk);
  const { nonce } = (await agent.get('/v1/auth/nonce')).body;
  const signature = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${nonce}:${kp.accountId}`), sk)).toString('base64');
  const r = await agent.post('/v1/auth/key').send({ public_key: kp.publicKey, signature, nonce, ...extra });
  return { r, sk, kp };
}

describe('email login (passwordless, SMTP)', () => {
  it('start sends a 6 digit code from the login template; the code is stored hashed', async () => {
    const r = await http().post('/v1/auth/email/start').send({ email: 'Rina@Example.com ' });
    expect(r.status).toBe(200); expect(r.body).toEqual({ sent: true, resend_after_s: 60 });
    const m = kit.mailer.last('rina@example.com')!;
    expect(m.subject).toMatch(/sign-in code/i);
    const code = /(\d{6})/.exec(m.text)![1];
    const row = (await kit.pool.query('select * from login_otps')).rows[0];
    expect(row.email).toBe('rina@example.com'); // normalised
    expect(JSON.stringify(row)).not.toContain(`"${code}"`);
  });
  it('verify creates the user and a session, and says a key is still needed', async () => {
    const { agent, body } = await emailLogin();
    expect(body).toMatchObject({ email: 'rina@example.com', near_account_id: null, public_key: null, key_required: true, has_backup: false });
    expect((await agent.get('/v1/auth/me')).body.email).toBe('rina@example.com');
    expect((await kit.pool.query('select auth_method from sessions')).rows[0].auth_method).toBe('email');
  });
  it('same email logs into the same user every time', async () => {
    const a = await emailLogin(); await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    const b = await emailLogin();
    expect(a.body.user_id).toBe(b.body.user_id);
  });
  it('validates input (bad email, bad code format)', async () => {
    for (const email of ['', 'nope', 'a@', 'x'.repeat(260) + '@b.co']) expect((await http().post('/v1/auth/email/start').send({ email })).status, email).toBe(400);
    await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    for (const code of ['12345', '1234567', 'abcdef', '']) expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code })).status).toBe(400);
  });
  it('wrong code is counted; five wrong codes lock even the right one', async () => {
    await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    const good = codeFor('a@b.co'); const bad = good === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) { const r = await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code: bad }); expect(r.body.error.code).toBe('OTP_INVALID'); expect(r.body.error.details.attempts_left).toBe(5 - i); }
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code: bad })).body.error.code).toBe('OTP_LOCKED');
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code: good })).body.error.code).toBe('OTP_LOCKED');
  });
  it('a used code cannot be reused, an expired code is refused, a code for another email is refused', async () => {
    await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    const code = codeFor('a@b.co');
    expect((await http().post('/v1/auth/email/verify').send({ email: 'other@b.co', code })).body.error.code).toBe('OTP_INVALID');
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code })).status).toBe(200);
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code })).body.error.code).toBe('OTP_INVALID');
    await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    const c2 = codeFor('a@b.co');
    await kit.pool.query(`update login_otps set expires_at = now() - interval '1 second' where used_at is null`);
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code: c2 })).body.error.code).toBe('OTP_EXPIRED');
  });
  it('verify without start is refused', async () => {
    expect((await http().post('/v1/auth/email/verify').send({ email: 'a@b.co', code: '123456' })).body.error.code).toBe('OTP_INVALID');
  });
  it('resend is limited to once a minute and the second email is not sent', async () => {
    await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    const r = await http().post('/v1/auth/email/start').send({ email: 'a@b.co' });
    expect(r.status).toBe(429); expect(r.body.error.details.resend_after_s).toBeGreaterThan(0);
    expect(kit.mailer.sent).toHaveLength(1);
  });
  it('per-address hourly limit (10) and per-ip limit', async () => {
    let last = 200;
    for (let i = 0; i < 11; i++) { await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`); last = (await http().post('/v1/auth/email/start').send({ email: 'busy@b.co' })).status; }
    expect(last).toBe(429);
  });
  it('mailer outage is a 503 that leaves no code and does not block a retry', async () => {
    kit.mailer.failNext = 1;
    expect((await http().post('/v1/auth/email/start').send({ email: 'a@b.co' })).status).toBe(503);
    expect((await kit.pool.query('select count(*)::int n from login_otps')).rows[0].n).toBe(0);
    expect((await http().post('/v1/auth/email/start').send({ email: 'a@b.co' })).status).toBe(200);
  });
  it('gives the same answer for known and unknown addresses (no account enumeration)', async () => {
    await emailLogin('known@b.co'); await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    const known = await http().post('/v1/auth/email/start').send({ email: 'known@b.co' });
    const unknown = await http().post('/v1/auth/email/start').send({ email: 'unknown@b.co' });
    expect(known.status).toBe(unknown.status); expect(known.body).toEqual(unknown.body);
  });
  it('can be switched off', async () => {
    const off = await startKit({ AUTH_EMAIL_ENABLED: false });
    try {
      expect((await request(off.app.getHttpServer()).post('/v1/auth/email/start').send({ email: 'a@b.co' })).status).toBe(403);
      expect((await request(off.app.getHttpServer()).post('/v1/auth/email/verify').send({ email: 'a@b.co', code: '123456' })).status).toBe(403);
    } finally { await off.close(); }
  });
});

describe('key binding (non-custodial)', () => {
  it('a keyless session is blocked from everything except auth endpoints', async () => {
    const { agent } = await emailLogin();
    for (const [m, p] of [['get', '/v1/packages'], ['post', '/v1/relay/submit'], ['post', '/v1/invites'], ['post', '/v1/faucet/near'], ['post', '/v1/accounts/bootstrap']] as const) {
      const r = await (agent as any)[m](p);
      expect(r.status, p).toBe(403); expect(r.body.error.code).toBe('KEY_REQUIRED');
    }
    expect((await agent.get('/v1/auth/me')).status).toBe(200);
  });
  it('binding a key proven by signature unlocks the account and sets the NEAR account id', async () => {
    const { agent } = await emailLogin();
    const { r, kp } = await bind(agent);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ near_account_id: kp.accountId, public_key: kp.publicKey, key_required: false });
    expect((await agent.get('/v1/packages')).status).toBe(200);
    // email becomes the notification address for this account
    expect((await agent.get('/v1/notifications/prefs')).body).toEqual({ email_enabled: true, email: 'rina@example.com' });
  });
  it('binding is idempotent for the same key', async () => {
    const { agent } = await emailLogin(); const seed = randomBytes(32);
    expect((await bind(agent, seed)).r.status).toBe(200);
    expect((await bind(agent, seed)).r.status).toBe(200);
  });
  it('rejects a bad signature, a signature for the login prefix, a stale nonce and a forged account', async () => {
    const { agent } = await emailLogin();
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const n1 = (await agent.get('/v1/auth/nonce')).body.nonce;
    const wrongKey = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${n1}:${kp.accountId}`), new Uint8Array(32).fill(6))).toString('base64');
    expect((await agent.post('/v1/auth/key').send({ public_key: kp.publicKey, signature: wrongKey, nonce: n1 })).status).toBe(401);
    const n2 = (await agent.get('/v1/auth/nonce')).body.nonce;
    const loginPrefix = Buffer.from(ed25519.sign(Buffer.from(`andum-login:${n2}:${kp.accountId}`), sk)).toString('base64');
    expect((await agent.post('/v1/auth/key').send({ public_key: kp.publicKey, signature: loginPrefix, nonce: n2 })).status).toBe(401); // a login signature cannot be replayed as a bind
    const n3 = (await agent.get('/v1/auth/nonce')).body.nonce;
    await kit.pool.query(`update login_nonces set created_at = now() - interval '11 minutes' where nonce=$1`, [n3]);
    const ok = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${n3}:${kp.accountId}`), sk)).toString('base64');
    expect((await agent.post('/v1/auth/key').send({ public_key: kp.publicKey, signature: ok, nonce: n3 })).status).toBe(401);
    expect((await agent.post('/v1/auth/key').send({ public_key: 'garbage-garbage', signature: ok, nonce: n3 })).status).toBe(401);
    expect((await agent.post('/v1/auth/key').send({})).status).toBe(400);
  });
  it('a nonce cannot be used twice', async () => {
    const { agent } = await emailLogin();
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await agent.get('/v1/auth/nonce')).body;
    const signature = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${nonce}:${kp.accountId}`), sk)).toString('base64');
    const body = { public_key: kp.publicKey, signature, nonce };
    expect((await agent.post('/v1/auth/key').send(body)).status).toBe(200);
    const other = await emailLogin('second@b.co');
    expect((await other.agent.post('/v1/auth/key').send(body)).status).toBe(401);
  });
  it('one key cannot belong to two users', async () => {
    const a = await emailLogin('a@b.co'); const seed = randomBytes(32);
    expect((await bind(a.agent, seed)).r.status).toBe(200);
    await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    const b = await emailLogin('b@b.co');
    const r = await bind(b.agent, seed);
    expect(r.r.status).toBe(409);
  });
  it('replacing a key needs replace=true and a fresh email proof', async () => {
    const { agent } = await emailLogin();
    expect((await bind(agent)).r.status).toBe(200);
    expect((await bind(agent)).r.status).toBe(409); // different key, no flag
    const ok = await bind(agent, randomBytes(32), { replace: true });
    expect(ok.r.status).toBe(200); expect(ok.r.body.near_account_id).toBe(ok.kp.accountId);
    await kit.pool.query(`update sessions set created_at = now() - interval '11 minutes'`);
    expect((await bind(agent, randomBytes(32), { replace: true })).r.status).toBe(403); // session too old
  });
  it('a key-only (local) session cannot replace a key at all', async () => {
    const sk = new Uint8Array(32).fill(7); const kp = keypairFromSecret(sk);
    const agent = request.agent(kit.app.getHttpServer());
    const { nonce } = (await agent.get('/v1/auth/nonce')).body;
    await agent.post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: Buffer.from(ed25519.sign(Buffer.from(`andum-login:${nonce}:${kp.accountId}`), sk)).toString('base64'), nonce });
    expect((await bind(agent, randomBytes(32), { replace: true })).r.status).toBe(403);
  });
  it('the relay policy uses the bound key: a delegate signed by the bound key is accepted, one by another key is not', async () => {
    const { agent } = await emailLogin();
    const seed = randomBytes(32); const { sk, kp } = await bind(agent, seed);
    const { signDelegate } = await import('@andum/shared');
    const mk = (key: Uint8Array, pk: string, nonce: bigint) => signDelegate({ senderId: kp.accountId, receiverId: `core.andum-hack.testnet`, actions: [{ type: 'FunctionCall', methodName: 'claim', args: Buffer.from('{"package_id":"1","part_id":0}'), gas: 100n * 10n ** 12n, deposit: 0n }], nonce, maxBlockHeight: 1100n, publicKey: pk }, key);
    expect((await agent.post('/v1/relay/submit').send({ signed_delegate_b64: mk(sk, kp.publicKey, 1n), client_request_id: 'ok' })).status).toBe(202);
    const other = keypairFromSecret(new Uint8Array(32).fill(1));
    const r = await agent.post('/v1/relay/submit').send({ signed_delegate_b64: mk(new Uint8Array(32).fill(1), other.publicKey, 2n), client_request_id: 'bad' });
    expect(r.status).toBe(401); expect(r.body.error.details.rule).toBe('R2');
  });
});

describe('encrypted key backup (server cannot read it)', () => {
  const blob = (seed = randomBytes(32)) => wrapSeed(seed, 'correct horse battery', 100_000);
  it('stores and returns an opaque blob; the passphrase restores the seed on a new device', async () => {
    const { agent } = await emailLogin();
    const seed = randomBytes(32);
    expect((await agent.put('/v1/auth/key-backup').send(blob(seed))).body).toEqual({ stored: true });
    expect((await agent.get('/v1/auth/me')).body.has_backup).toBe(true);
    await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    const device2 = await emailLogin();
    const got = (await device2.agent.get('/v1/auth/key-backup')).body;
    expect(Buffer.from(unwrapSeed(got, 'correct horse battery')).equals(seed)).toBe(true);
    expect(() => unwrapSeed(got, 'wrong passphrase!')).toThrow();
    expect(JSON.stringify((await kit.pool.query('select blob from key_backups')).rows[0])).not.toContain(seed.toString('base64'));
  });
  it('404 when none, update overwrites, private to the user', async () => {
    const a = await emailLogin('a@b.co');
    expect((await a.agent.get('/v1/auth/key-backup')).status).toBe(404);
    await a.agent.put('/v1/auth/key-backup').send(blob()); const second = blob();
    await a.agent.put('/v1/auth/key-backup').send(second);
    expect((await a.agent.get('/v1/auth/key-backup')).body.ct).toBe(second.ct);
    await kit.pool.query(`update login_otps set created_at = now() - interval '2 minutes'`);
    const b = await emailLogin('b@b.co');
    expect((await b.agent.get('/v1/auth/key-backup')).status).toBe(404);
    expect((await http().get('/v1/auth/key-backup')).status).toBe(401);
  });
  it('rejects weak or malformed blobs (low iteration count, wrong version, oversize, extra shapes)', async () => {
    const { agent } = await emailLogin();
    const good = blob();
    for (const bad of [{ ...good, iter: 1000 }, { ...good, v: 2 }, { ...good, kdf: 'md5' }, { ...good, ct: 'x'.repeat(400) }, { ...good, ct: 'short' }, {}]) {
      expect((await agent.put('/v1/auth/key-backup').send(bad)).status).toBe(400);
    }
  });
  it('wrapSeed refuses bad inputs', () => {
    expect(() => wrapSeed(new Uint8Array(31), 'longenough')).toThrow();
    expect(() => wrapSeed(new Uint8Array(32), 'short')).toThrow();
  });
  it('replacing the key deletes the now-useless backup', async () => {
    const { agent } = await emailLogin();
    await bind(agent); await agent.put('/v1/auth/key-backup').send(blob());
    await bind(agent, randomBytes(32), { replace: true });
    expect((await agent.get('/v1/auth/key-backup')).status).toBe(404);
  });
});

describe('privy provider (optional)', () => {
  it('is not configured by default', async () => {
    expect((await http().post('/v1/auth/session').send({ provider: 'privy', token: 'abc' })).status).toBe(401);
  });
  it('accepts a valid Privy token plus a key proof, rejects forged/expired/wrong-audience tokens', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const pem = await exportSPKI(publicKey);
    const p = await startKit({ PRIVY_APP_ID: 'app123', PRIVY_VERIFICATION_KEY: pem });
    try {
      const token = (o: { aud?: string; iss?: string; exp?: string; key?: any } = {}) => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject('did:privy:abc').setIssuer(o.iss ?? 'privy.io').setAudience(o.aud ?? 'app123').setIssuedAt().setExpirationTime(o.exp ?? '5m').sign(o.key ?? privateKey);
      const sk = new Uint8Array(32).fill(4); const kp = keypairFromSecret(sk);
      const proof = async (a: any) => { const { nonce } = (await a.get('/v1/auth/nonce')).body; return { account_id: kp.accountId, public_key: kp.publicKey, nonce, signature: Buffer.from(ed25519.sign(Buffer.from(`andum-login:${nonce}:${kp.accountId}`), sk)).toString('base64') }; };
      const agent = request.agent(p.app.getHttpServer());
      const ok = await agent.post('/v1/auth/session').send({ provider: 'privy', token: await token(), ...(await proof(agent)) });
      expect(ok.status).toBe(200); expect(ok.body.near_account_id).toBe(kp.accountId);
      expect((await agent.get('/v1/packages')).status).toBe(200);
      const other = await generateKeyPair('ES256');
      for (const bad of [await token({ key: other.privateKey }), await token({ aud: 'other-app' }), await token({ iss: 'evil.io' }), await token({ exp: '-1m' }), 'not.a.jwt']) {
        const a2 = request.agent(p.app.getHttpServer());
        expect((await a2.post('/v1/auth/session').send({ provider: 'privy', token: bad, ...(await proof(a2)) })).status).toBe(401);
      }
      // a valid token without proof of the key is not enough
      expect((await request(p.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'privy', token: await token() })).status).toBe(400);
      // the same Privy user cannot be re-pointed at a different key
      const sk2 = new Uint8Array(32).fill(9); const kp2 = keypairFromSecret(sk2);
      const a3 = request.agent(p.app.getHttpServer()); const { nonce } = (await a3.get('/v1/auth/nonce')).body;
      const r3 = await a3.post('/v1/auth/session').send({ provider: 'privy', token: await token(), account_id: kp2.accountId, public_key: kp2.publicKey, nonce, signature: Buffer.from(ed25519.sign(Buffer.from(`andum-login:${nonce}:${kp2.accountId}`), sk2)).toString('base64') });
      expect(r3.status).toBe(401);
    } finally { await p.close(); }
  });
});

describe('key-only (local) sign-in switch', () => {
  it('can be disabled for production', async () => {
    const off = await startKit({ AUTH_LOCAL_ENABLED: false });
    try {
      const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
      const a = request.agent(off.app.getHttpServer()); const { nonce } = (await a.get('/v1/auth/nonce')).body;
      const r = await a.post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, nonce, signature: Buffer.from(ed25519.sign(Buffer.from(`andum-login:${nonce}:${kp.accountId}`), sk)).toString('base64') });
      expect(r.status).toBe(403);
    } finally { await off.close(); }
  });
});
