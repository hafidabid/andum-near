import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import http from 'http';
import request from 'supertest';
import { EVENT_CHANNEL, resetAll, setKill, upsertPackage, storeEvents } from '@andum/shared';
import { Kit, TEST_REDIS, TestUser, USDC, login, pkgView, startKit } from './testkit';

let kit: Kit; let u: TestUser; let v: TestUser;
beforeAll(async () => { kit = await startKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.chain.transportFailures = 0; kit.chain.submitted = []; kit.chain.onSubmit = undefined; kit.packages.clear(); u = await login(kit); v = await login(kit); });
const api = () => request(kit.app.getHttpServer());
const asText = (res: any, cb: any) => { let d = ''; res.on('data', (c: Buffer) => (d += c)); res.on('end', () => cb(null, d)); };

describe('packages (A-05)', () => {
  it('lists by role and keeps roles separate', async () => {
    await upsertPackage(kit.pool, pkgView('1', { sender: u.account }));
    await upsertPackage(kit.pool, pkgView('2', { sender: v.account, owner: u.account, status: 'ACCEPTED' }));
    await upsertPackage(kit.pool, pkgView('3', { sender: v.account, parts: [{ ...pkgView('3').parts[0], approvers: [u.account], threshold: 1 }] }));
    const ids = async (role: string) => (await u.agent.get(`/v1/packages?role=${role}`)).body.items.map((p: any) => p.id);
    expect(await ids('sender')).toEqual(['1']);
    expect(await ids('owner')).toEqual(['2']);
    expect(await ids('approver')).toEqual(['3']);
    expect((await u.agent.get('/v1/packages')).body.items.map((p: any) => p.id)).toEqual(['1']); // default role = sender
  });
  it('paginates with a cursor, newest first, with no overlap', async () => {
    for (let i = 1; i <= 5; i++) await upsertPackage(kit.pool, pkgView(String(i), { sender: u.account }));
    const a = (await u.agent.get('/v1/packages?limit=2')).body;
    expect(a.items.map((p: any) => p.id)).toEqual(['5', '4']); expect(a.next).toBe('4');
    const b = (await u.agent.get(`/v1/packages?limit=2&cursor=${a.next}`)).body;
    expect(b.items.map((p: any) => p.id)).toEqual(['3', '2']);
    const c = (await u.agent.get(`/v1/packages?limit=2&cursor=${b.next}`)).body;
    expect(c.items.map((p: any) => p.id)).toEqual(['1']); expect(c.next).toBeNull();
  });
  it('validates role, cursor and limit', async () => {
    for (const q of ['role=admin', 'cursor=abc', 'limit=0', 'limit=51', 'limit=x']) expect((await u.agent.get(`/v1/packages?${q}`)).status, q).toBe(400);
  });
  it('detail is for parties only (sender, owner, recipient, approver)', async () => {
    kit.packages.set('1', pkgView('1', { sender: u.account, owner: v.account }));
    expect((await u.agent.get('/v1/packages/1')).status).toBe(200);
    expect((await v.agent.get('/v1/packages/1')).status).toBe(200);
    const w = await login(kit);
    const r = await w.agent.get('/v1/packages/1'); expect(r.status).toBe(403); expect(r.body.error.code).toBe('FORBIDDEN');
    kit.packages.set('2', pkgView('2', { sender: u.account, parts: [{ ...pkgView('2').parts[0], approvers: [w.account], threshold: 1 }] }));
    expect((await w.agent.get('/v1/packages/2')).status).toBe(200);
    kit.packages.set('3', pkgView('3', { sender: u.account, recipient: w.account }));
    expect((await w.agent.get('/v1/packages/3')).status).toBe(200);
  });
  it('unknown, malformed and out-of-range ids are 404', async () => {
    for (const id of ['99', 'abc', '1.5', '99999999999999999999999']) expect((await u.agent.get(`/v1/packages/${id}`)).status, id).toBe(404);
  });
  it('fresh cache is served without touching the chain; stale cache is refreshed from the chain', async () => {
    kit.packages.set('1', pkgView('1', { sender: u.account, status: 'FUNDED' }));
    await u.agent.get('/v1/packages/1');
    kit.packages.set('1', pkgView('1', { sender: u.account, status: 'ACCEPTED', owner: v.account }));
    expect((await u.agent.get('/v1/packages/1')).body.status).toBe('FUNDED'); // cached < 10 s
    await kit.pool.query(`update packages set updated_at = now() - interval '11 seconds'`);
    expect((await u.agent.get('/v1/packages/1')).body.status).toBe('ACCEPTED');
    expect((await kit.pool.query('select status from packages where id=1')).rows[0].status).toBe('ACCEPTED');
  });
  it('serves stale cache when the chain is briefly down, but 503 if there is no cache', async () => {
    kit.packages.set('1', pkgView('1', { sender: u.account }));
    await u.agent.get('/v1/packages/1');
    await kit.pool.query(`update packages set updated_at = now() - interval '1 minute'`);
    kit.chain.transportFailures = 1;
    expect((await u.agent.get('/v1/packages/1')).status).toBe(200);
    kit.packages.set('2', pkgView('2', { sender: u.account }));
    kit.chain.transportFailures = 1;
    expect((await u.agent.get('/v1/packages/2')).status).toBe(503);
  });
  it('events are listed oldest first for parties only', async () => {
    kit.packages.set('1', pkgView('1', { sender: u.account }));
    await storeEvents(kit.pool, 'near', 'T1', [{ standard: 'andum', event: 'package_created', data: { package_id: '1' }, logIndex: 0 }]);
    await storeEvents(kit.pool, 'near', 'T2', [{ standard: 'andum', event: 'part_funded', data: { package_id: '1' }, logIndex: 0 }, { standard: 'andum', event: 'part_funded', data: { package_id: '2' }, logIndex: 1 }]);
    const r = await u.agent.get('/v1/packages/1/events');
    expect(r.body.map((e: any) => e.event)).toEqual(['package_created', 'part_funded']);
    expect(r.body[0]).toHaveProperty('tx_hash', 'T1');
    expect((await v.agent.get('/v1/packages/1/events')).status).toBe(403);
  });
  it('nft.svg is public, themed, and escapes user text', async () => {
    kit.packages.set('1', pkgView('1', { note: '<script>alert(1)</script>', theme: 'gold' }));
    const r = await api().get('/v1/packages/1/nft.svg').buffer(true).parse(asText);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('image/svg+xml');
    const svg = String(r.body);
    expect(svg).toContain('#b45309'); expect(svg).not.toContain('<script>'); expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('0 of 1 parts taken');
    kit.packages.set('2', pkgView('2', { theme: 'nope' as any }));
    expect((await api().get('/v1/packages/2/nft.svg')).status).toBe(200); // unknown theme falls back
    expect((await api().get('/v1/packages/77/nft.svg')).status).toBe(404);
  });
});

describe('faucet (A-07)', () => {
  const mint = (who: TestUser, b: Record<string, unknown>) => who.agent.post('/v1/faucet/near').send(b);
  it('mints by calling the token as relayer for the caller', async () => {
    const r = await mint(u, { asset_id: 'usdc', amount: '5000000' });
    expect(r.status).toBe(200); expect(r.body.minted).toBe('5000000');
    expect(kit.chain.submitted[0]).toMatchObject({ kind: 'call', contract: USDC, method: 'ft_mint', args: { account_id: u.account, amount: '5000000' } });
    expect((await kit.pool.query('select * from faucet_claims')).rows[0]).toMatchObject({ recipient: u.account, asset_id: 'usdc', amount: '5000000' });
  });
  it('defaults to the per-call amount and honours stock/gold caps', async () => {
    expect((await mint(u, { asset_id: 'usdc' })).body.minted).toBe('10000000000');
    expect((await mint(u, { asset_id: 'xau' })).body.minted).toBe('100000000');
  });
  it('per-call cap boundary', async () => {
    expect((await mint(u, { asset_id: 'xau', amount: '100000000' })).status).toBe(200);
    const r = await mint(u, { asset_id: 'xau', amount: '100000001' });
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('FAUCET_CAP');
  });
  it('daily cap per account and asset (another asset or account is unaffected)', async () => {
    for (let i = 0; i < 10; i++) expect((await mint(u, { asset_id: 'xau' })).status).toBe(200);
    const r = await mint(u, { asset_id: 'xau', amount: '1' });
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('FAUCET_CAP');
    expect((await mint(u, { asset_id: 'aapl', amount: '1' })).status).toBe(200);
    expect((await mint(v, { asset_id: 'xau', amount: '1' })).status).toBe(200);
  });
  it('validates asset and amount', async () => {
    for (const b of [{ asset_id: 'doge' }, {}, { asset_id: 'usdc', amount: '0' }, { asset_id: 'usdc', amount: '-1' }, { asset_id: 'usdc', amount: '1.5' }, { asset_id: 'usdc', amount: 5 }, { asset_id: 'usdc', amount: '9'.repeat(40) }]) {
      expect((await mint(u, b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('kill switch', async () => {
    await setKill(kit.pool, 'faucet', true);
    expect((await mint(u, { asset_id: 'usdc' })).status).toBe(503);
    expect(kit.chain.submitted).toHaveLength(0);
  });
  it('maps a token cap error and other chain failures; failed mints are not recorded', async () => {
    kit.chain.onSubmit = () => ({ success: false, failure: 'Smart contract panicked: ANDUM_ERR:FAUCET_CAP_DAILY' });
    expect((await mint(u, { asset_id: 'usdc' })).body.error.code).toBe('FAUCET_CAP');
    kit.chain.onSubmit = () => ({ success: false, failure: 'something odd' });
    expect((await mint(u, { asset_id: 'usdc' })).status).toBe(502);
    expect((await kit.pool.query('select count(*)::int n from faucet_claims')).rows[0].n).toBe(0);
    kit.chain.onSubmit = undefined; kit.chain.transportFailures = 1;
    expect((await mint(u, { asset_id: 'usdc' })).status).toBe(503);
  });
  it('per-ip limit', async () => {
    const small = await startKit({ FAUCET_IP_PER_HOUR: 2 });
    try {
      const w = await login(small);
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await w.agent.post('/v1/faucet/near').send({ asset_id: 'usdc', amount: '1' })).status);
      expect(codes).toEqual([200, 200, 429]);
    } finally { await small.close(); }
  });
  it('EVM faucet is not enabled yet', async () => { expect((await u.agent.post('/v1/faucet/evm').send({})).status).toBe(501); });
  it('requires a session', async () => { expect((await api().post('/v1/faucet/near').send({ asset_id: 'usdc' })).status).toBe(401); });
});

describe('notification prefs (A-06)', () => {
  it('defaults, update, partial update keeps email', async () => {
    expect((await u.agent.get('/v1/notifications/prefs')).body).toEqual({ email_enabled: true, email: null });
    expect((await u.agent.put('/v1/notifications/prefs').send({ email_enabled: false, email: 'me@example.com' })).body).toEqual({ email_enabled: false, email: 'me@example.com' });
    expect((await u.agent.put('/v1/notifications/prefs').send({ email_enabled: true })).body).toEqual({ email_enabled: true, email: 'me@example.com' });
    expect((await v.agent.get('/v1/notifications/prefs')).body.email_enabled).toBe(true); // per account
  });
  it('validates', async () => {
    expect((await u.agent.put('/v1/notifications/prefs').send({ email_enabled: 'yes' })).status).toBe(400);
    expect((await u.agent.put('/v1/notifications/prefs').send({ email_enabled: true, email: 'nope' })).status).toBe(400);
    expect((await api().put('/v1/notifications/prefs').send({ email_enabled: true })).status).toBe(401);
  });
});

describe('bridge read side (A-08)', () => {
  it('lists only bridgeable assets and is public', async () => {
    const r = await api().get('/v1/bridge/assets');
    expect(r.status).toBe(200); expect(r.body).toHaveLength(7);
    expect(r.body.map((a: any) => a.id)).not.toContain('xau');
    expect(r.body[0]).toMatchObject({ id: 'usdc', near: USDC, decimals: 6 });
  });
  it('quote builds the ft_transfer_call arguments', async () => {
    const r = await u.agent.post('/v1/bridge/out/quote').send({ asset_id: 'usdc', amount: '1000000', dest_chain: 'baseSepolia', dest_address: '0xAbCdEf0123456789aBcDeF0123456789abcdef01' });
    expect(r.status).toBe(200);
    expect(r.body.fee).toBe('0');
    expect(r.body.ft_transfer_call).toMatchObject({ token: USDC, receiver_id: `bridge.andum-hack.testnet`, amount: '1000000' });
    expect(JSON.parse(r.body.ft_transfer_call.msg)).toEqual({ dest_chain: 'baseSepolia', dest_address: '0xabcdef0123456789abcdef0123456789abcdef01' });
  });
  it('quote refuses non-bridgeable assets, bad chains, bad addresses and bad amounts', async () => {
    const ok = { asset_id: 'usdc', amount: '1', dest_chain: 'sepolia', dest_address: '0x' + '1'.repeat(40) };
    for (const bad of [{ asset_id: 'xau' }, { asset_id: 'nope' }, { dest_chain: 'mainnet' }, { dest_address: '0x123' }, { dest_address: '0x' + '0'.repeat(40) }, { dest_address: '1'.repeat(42) }, { amount: '0' }, { amount: '-5' }]) {
      expect((await u.agent.post('/v1/bridge/out/quote').send({ ...ok, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });
  it('transfers are visible only to the NEAR account they belong to', async () => {
    const ins = (acct: string) => kit.pool.query(`insert into bridge_transfers (direction, evm_chain, asset_id, amount, evm_address, near_account, src_nonce, src_tx) values ('EVM_TO_NEAR','sepolia','usdc',5,'0x1',$1,$2,'0xtx') returning id`, [acct, Math.floor(Math.random() * 1e9)]);
    const mine = (await ins(u.account)).rows[0].id; const theirs = (await ins(v.account)).rows[0].id;
    expect((await u.agent.get('/v1/bridge/transfers')).body).toHaveLength(1);
    expect((await u.agent.get(`/v1/bridge/transfers/${mine}`)).body.status).toBe('DETECTED');
    expect((await u.agent.get(`/v1/bridge/transfers/${theirs}`)).status).toBe(404);
    expect((await u.agent.get('/v1/bridge/transfers/xyz')).status).toBe(404);
  });
});

describe('SSE stream (A-09)', () => {
  function open(user: TestUser): Promise<{ chunks: string[]; close: () => void }> {
    return new Promise((resolve) => {
      const addr = kit.app.getHttpServer().address() as { port: number };
      const cookie = user.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false } as any).map((c: any) => c.toValueString()).join('; ');
      const req = http.get({ host: '127.0.0.1', port: addr.port, path: '/v1/stream', headers: { cookie } }, (res) => {
        const chunks: string[] = [];
        res.on('data', (d) => chunks.push(d.toString()));
        resolve({ chunks, close: () => req.destroy() });
      });
    });
  }
  it('delivers events only to the accounts they target', async () => {
    await new Promise<void>((r) => kit.app.getHttpServer().listening ? r() : kit.app.getHttpServer().listen(0, r));
    const a = await open(u); const b = await open(v);
    await new Promise((r) => setTimeout(r, 300));
    const pub = new Redis(TEST_REDIS);
    await pub.publish(EVENT_CHANNEL, JSON.stringify({ type: 'package.updated', accounts: [u.account], data: { package_id: '7' } }));
    await pub.publish(EVENT_CHANNEL, 'not json');
    await new Promise((r) => setTimeout(r, 400));
    pub.disconnect(); a.close(); b.close();
    expect(a.chunks.join('')).toContain('event: package.updated');
    expect(a.chunks.join('')).toContain('"package_id":"7"');
    expect(b.chunks.join('')).not.toContain('package.updated');
  });
});
