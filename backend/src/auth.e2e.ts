import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import request from 'supertest';
import { resetAll, keypairFromSecret } from '@andum/shared';
import { Kit, login, startKit } from './testkit';

let kit: Kit;
beforeAll(async () => { kit = await startKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.chain.transportFailures = 0; kit.chain.balances.clear(); kit.chain.submitted = []; kit.chain.onSubmit = undefined; });

const sign = (sk: Uint8Array, msg: string) => Buffer.from(ed25519.sign(Buffer.from(msg), sk)).toString('base64');

describe('auth (A-01)', () => {
  it('logs in with a signed challenge and sets an httpOnly cookie', async () => {
    const u = await login(kit);
    const me = await u.agent.get('/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.near_account_id).toBe(u.account);
    const raw = await request(kit.app.getHttpServer()).get('/v1/auth/nonce');
    expect(raw.status).toBe(200);
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const nonce = raw.body.nonce;
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(sk, `andum-login:${nonce}:${kp.accountId}`), nonce });
    expect(r.status).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
  it('same key logging in twice maps to the same user', async () => {
    const seed = Buffer.alloc(32, 8);
    const a = await login(kit, seed); const b = await login(kit, seed);
    expect(a.id).toBe(b.id);
    expect((await kit.pool.query('select count(*)::int n from users')).rows[0].n).toBe(1);
  });
  it('rejects a wrong signature', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await request(kit.app.getHttpServer()).get('/v1/auth/nonce')).body;
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(new Uint8Array(32).fill(6), `andum-login:${nonce}:${kp.accountId}`), nonce });
    expect(r.status).toBe(401); expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('rejects a signature over a different account or nonce', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await request(kit.app.getHttpServer()).get('/v1/auth/nonce')).body;
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(sk, `andum-login:other:${kp.accountId}`), nonce });
    expect(r.status).toBe(401);
  });
  it('rejects an account id that is not the implicit account of the key', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await request(kit.app.getHttpServer()).get('/v1/auth/nonce')).body;
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: 'victim.testnet', public_key: kp.publicKey, signature: sign(sk, `andum-login:${nonce}:victim.testnet`), nonce });
    expect(r.status).toBe(401);
    expect((await kit.pool.query('select count(*)::int n from users')).rows[0].n).toBe(0);
  });
  it('a nonce cannot be replayed', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await request(kit.app.getHttpServer()).get('/v1/auth/nonce')).body;
    const body = { provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(sk, `andum-login:${nonce}:${kp.accountId}`), nonce };
    expect((await request(kit.app.getHttpServer()).post('/v1/auth/session').send(body)).status).toBe(200);
    expect((await request(kit.app.getHttpServer()).post('/v1/auth/session').send(body)).status).toBe(401);
  });
  it('a nonce we never issued is refused', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const nonce = 'made-up-nonce-12345';
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(sk, `andum-login:${nonce}:${kp.accountId}`), nonce });
    expect(r.status).toBe(401);
  });
  it('an expired nonce is refused', async () => {
    const sk = new Uint8Array(32).fill(5); const kp = keypairFromSecret(sk);
    const { nonce } = (await request(kit.app.getHttpServer()).get('/v1/auth/nonce')).body;
    await kit.pool.query(`update login_nonces set created_at = now() - interval '11 minutes' where nonce=$1`, [nonce]);
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature: sign(sk, `andum-login:${nonce}:${kp.accountId}`), nonce });
    expect(r.status).toBe(401);
  });
  it('validates the body', async () => {
    const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'nope' });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local' })).status).toBe(400);
    expect((await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider: 'local', account_id: 'x', public_key: 'garbage-garbage', signature: 'sigsigsigsig', nonce: 'nonce-nonce' })).status).toBe(401);
  });
  it('privy and web3auth are not configured and cannot authenticate', async () => {
    for (const provider of ['privy', 'web3auth']) {
      const r = await request(kit.app.getHttpServer()).post('/v1/auth/session').send({ provider, token: 'abc' });
      expect(r.status).toBe(401);
    }
  });
  it('protected endpoints need a session', async () => {
    for (const [m, p] of [['get', '/v1/auth/me'], ['get', '/v1/packages'], ['post', '/v1/accounts/bootstrap'], ['post', '/v1/relay/submit'], ['post', '/v1/invites'], ['post', '/v1/faucet/near'], ['get', '/v1/stream']] as const) {
      const r = await (request(kit.app.getHttpServer()) as any)[m](p);
      expect(r.status, p).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
  it('garbage or unknown session cookies are refused', async () => {
    expect((await request(kit.app.getHttpServer()).get('/v1/auth/me').set('Cookie', 'andum_session=not-a-uuid')).status).toBe(401);
    expect((await request(kit.app.getHttpServer()).get('/v1/auth/me').set('Cookie', 'andum_session=11111111-1111-1111-1111-111111111111')).status).toBe(401);
    expect((await request(kit.app.getHttpServer()).get('/v1/auth/me').set('Cookie', "andum_session=1' or '1'='1")).status).toBe(401);
  });
  it('expired session is refused', async () => {
    const u = await login(kit);
    await kit.pool.query(`update sessions set expires_at = now() - interval '1 second'`);
    expect((await u.agent.get('/v1/auth/me')).status).toBe(401);
  });
  it('logout destroys the session server side', async () => {
    const u = await login(kit);
    expect((await u.agent.post('/v1/auth/logout')).status).toBe(200);
    expect((await kit.pool.query('select count(*)::int n from sessions')).rows[0].n).toBe(0);
    const stale = await request(kit.app.getHttpServer()).get('/v1/auth/me').set('Cookie', `andum_session=${(await kit.pool.query('select gen_random_uuid() id')).rows[0].id}`);
    expect(stale.status).toBe(401);
  });
  it('unknown routes use the error body shape', async () => {
    const r = await request(kit.app.getHttpServer()).get('/v1/nothing-here');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(r.body.error).toBeDefined();
  });
});

describe('time and health', () => {
  it('GET /v1/time is public and returns both clocks', async () => {
    const r = await request(kit.app.getHttpServer()).get('/v1/time');
    expect(r.status).toBe(200);
    expect(Math.abs(r.body.server_ms - Date.now())).toBeLessThan(5000);
    expect(typeof r.body.chain_ns).toBe('string');
  });
  it('healthz and readyz', async () => {
    expect((await request(kit.app.getHttpServer()).get('/healthz')).body).toEqual({ ok: true });
    const r = await request(kit.app.getHttpServer()).get('/readyz');
    expect(r.status).toBe(200); expect(r.body.checks).toEqual({ db: true, redis: true, near: true });
  });
  it('readyz is 503 when the chain is unreachable', async () => {
    kit.chain.transportFailures = 1;
    const r = await request(kit.app.getHttpServer()).get('/readyz');
    expect(r.status).toBe(503);
    expect(r.body.error.details.checks.near).toBe(false);
  });
});

describe('bootstrap (A-02)', () => {
  it('tops up a new account once', async () => {
    const u = await login(kit);
    const r = await u.agent.post('/v1/accounts/bootstrap');
    expect(r.status).toBe(200); expect(r.body.created).toBe(true); expect(r.body.topup_tx).toBeTruthy();
    expect(r.body.near_balance_yocto).toBe('20000000000000000000000');
    const again = await u.agent.post('/v1/accounts/bootstrap');
    expect(again.body.created).toBe(false);
    expect(kit.chain.submitted.filter((s) => s.kind === 'transfer')).toHaveLength(1);
  });
  it('does not top up an account that already has enough', async () => {
    const u = await login(kit);
    kit.chain.balances.set(u.account, 10n ** 24n);
    const r = await u.agent.post('/v1/accounts/bootstrap');
    expect(r.body.created).toBe(false);
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('enforces the daily limit when the balance drops again', async () => {
    const u = await login(kit);
    for (let i = 0; i < 2; i++) { expect((await u.agent.post('/v1/accounts/bootstrap')).body.created).toBe(true); kit.chain.balances.set(u.account, 0n); }
    const r = await u.agent.post('/v1/accounts/bootstrap');
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('BOOTSTRAP_LIMIT');
  });
  it('reports upstream problems without recording a top-up', async () => {
    const u = await login(kit);
    kit.chain.transportFailures = 1;
    const r = await u.agent.post('/v1/accounts/bootstrap');
    expect(r.status).toBe(503); expect(r.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect((await kit.pool.query('select count(*)::int n from topups')).rows[0].n).toBe(0);
  });
  it('a failed transfer outcome is not recorded', async () => {
    const u = await login(kit);
    kit.chain.onSubmit = () => ({ success: false, failure: 'boom' });
    const r = await u.agent.post('/v1/accounts/bootstrap');
    kit.chain.onSubmit = undefined;
    expect(r.status).toBe(502);
    expect((await kit.pool.query('select count(*)::int n from topups')).rows[0].n).toBe(0);
  });
});
