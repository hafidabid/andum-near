import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetAll } from '@andum/shared';
import { Kit, TestUser, USDC, login, pkgView, sha, startKit } from './testkit';

let kit: Kit; let sender: TestUser; let other: TestUser;
beforeAll(async () => { kit = await startKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => {
  await resetAll(kit.pool); kit.chain.transportFailures = 0; kit.mailer.sent = []; kit.mailer.failNext = 0; kit.packages.clear();
  sender = await login(kit); other = await login(kit);
});

async function createInvite(u = sender, email = 'rina@example.com') {
  const r = await u.agent.post('/v1/invites').send({ recipient_email: email });
  expect(r.status).toBe(201);
  return r.body as { invite_id: string; invite_hash_b64: string };
}
/** invite + on-chain package that carries its hash, attached */
async function attached(pkgId = '1', o: Record<string, unknown> = {}) {
  const inv = await createInvite();
  kit.packages.set(pkgId, pkgView(pkgId, { sender: sender.account, invite_hash: inv.invite_hash_b64, ...o }));
  const r = await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: pkgId, tx_hash: 'TX' });
  expect(r.status).toBe(200);
  return inv;
}
const otpFrom = () => /(\d{6})/.exec(kit.mailer.last('rina@example.com')!.text)![1];
const http = () => request(kit.app.getHttpServer());

describe('invites (A-03)', () => {
  it('creates an invite, returns only the hash and stores the secret encrypted', async () => {
    const inv = await createInvite();
    expect(Buffer.from(inv.invite_hash_b64, 'base64')).toHaveLength(32);
    const row = (await kit.pool.query('select * from invites where id=$1', [inv.invite_id])).rows[0];
    expect(row.secret_hash.toString('base64')).toBe(inv.invite_hash_b64);
    expect(row.secret_enc.length).toBeGreaterThan(48); // iv+tag+32
    expect(row.secret_enc.toString('base64')).not.toContain(inv.invite_hash_b64);
    expect(row.status).toBe('DRAFT');
  });
  it('validates the email and requires a session', async () => {
    expect((await sender.agent.post('/v1/invites').send({ recipient_email: 'not-an-email' })).status).toBe(400);
    expect((await sender.agent.post('/v1/invites').send({})).status).toBe(400);
    expect((await http().post('/v1/invites').send({ recipient_email: 'a@b.co' })).status).toBe(401);
  });
  it('attach verifies the chain, marks ATTACHED and sends exactly one invite email', async () => {
    const inv = await attached();
    const row = (await kit.pool.query('select * from invites where id=$1', [inv.invite_id])).rows[0];
    expect(row.status).toBe('ATTACHED'); expect(String(row.package_id)).toBe('1'); expect(row.accept_by).toBeTruthy();
    expect(kit.mailer.sent.filter((m) => m.to === 'rina@example.com' && /sent you/.test(m.subject))).toHaveLength(1);
    // attaching again is idempotent: no second email
    await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: 'TX' });
    expect(kit.mailer.sent).toHaveLength(1);
  });
  it('attach is refused for someone else, a wrong sender, a wrong hash, an unknown package', async () => {
    const inv = await createInvite();
    kit.packages.set('1', pkgView('1', { sender: sender.account, invite_hash: inv.invite_hash_b64 }));
    expect((await other.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: 'T' })).status).toBe(403);
    kit.packages.set('2', pkgView('2', { sender: other.account, invite_hash: inv.invite_hash_b64 }));
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '2', tx_hash: 'T' })).status).toBe(403);
    kit.packages.set('3', pkgView('3', { sender: sender.account, invite_hash: Buffer.alloc(32, 1).toString('base64') }));
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '3', tx_hash: 'T' })).status).toBe(403);
    kit.packages.set('4', pkgView('4', { sender: sender.account, invite_hash: null, recipient: 'x.testnet' }));
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '4', tx_hash: 'T' })).status).toBe(403);
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '99', tx_hash: 'T' })).status).toBe(404);
    expect((await kit.pool.query('select status from invites')).rows[0].status).toBe('DRAFT');
    expect(kit.mailer.sent).toHaveLength(0);
  });
  it('attach validates input and handles unknown invites and chain outages', async () => {
    const inv = await createInvite();
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: 'abc', tx_hash: 'T' })).status).toBe(400);
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1' })).status).toBe(400);
    expect((await sender.agent.post('/v1/invites/nope/attach').send({ package_id: '1', tx_hash: 'T' })).body.error.code).toBe('INVITE_NOT_FOUND');
    kit.chain.transportFailures = 1;
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: 'T' })).status).toBe(503);
  });
  it('one package cannot be attached to two invites', async () => {
    const a = await attached('1');
    const b = await createInvite();
    kit.packages.set('1', pkgView('1', { sender: sender.account, invite_hash: a.invite_hash_b64 }));
    const r = await sender.agent.post(`/v1/invites/${b.invite_id}/attach`).send({ package_id: '1', tx_hash: 'T' });
    expect(r.status).toBe(409);
  });
  it('mailer outage on attach does not fail the call; the notification stays pending for the worker', async () => {
    const inv = await createInvite();
    kit.packages.set('1', pkgView('1', { sender: sender.account, invite_hash: inv.invite_hash_b64 }));
    kit.mailer.failNext = 1;
    expect((await sender.agent.post(`/v1/invites/${inv.invite_id}/attach`).send({ package_id: '1', tx_hash: 'T' })).status).toBe(200);
    const n = (await kit.pool.query('select status, attempts from notifications')).rows[0];
    expect(n.status).toBe('PENDING'); expect(n.attempts).toBe(1);
  });
});

describe('email gated secret release (A-03)', () => {
  it('start refuses unattached invites', async () => {
    const inv = await createInvite();
    const r = await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('INVITE_NOT_ATTACHED');
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: '123456' })).body.error.code).toBe('INVITE_NOT_ATTACHED');
  });
  it('start emails a 6 digit code; the code is stored hashed only', async () => {
    const inv = await attached();
    const r = await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    expect(r.status).toBe(200); expect(r.body).toEqual({ sent: true, resend_after_s: 60 });
    const code = otpFrom();
    expect(code).toMatch(/^\d{6}$/);
    const row = (await kit.pool.query('select * from otp_codes')).rows[0];
    expect(row.code_hash.toString('hex')).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(`"${code}"`);
  });
  it('correct code releases the secret once; its sha256 equals the on-chain invite hash', async () => {
    const inv = await attached();
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    const code = otpFrom();
    const r = await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code });
    expect(r.status).toBe(200); expect(r.body.package_id).toBe('1');
    expect(sha(Buffer.from(r.body.invite_secret, 'base64')).toString('base64')).toBe(inv.invite_hash_b64);
    expect((await kit.pool.query('select status from invites')).rows[0].status).toBe('VERIFIED');
    // the same code cannot be used again
    const again = await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code });
    expect(again.status).toBe(400); expect(again.body.error.code).toBe('OTP_INVALID');
  });
  it('wrong code is rejected and counts attempts; five wrong codes lock the code, even for the right one', async () => {
    const inv = await attached();
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    const good = otpFrom(); const bad = good === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const r = await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: bad });
      expect(r.status).toBe(400); expect(r.body.error.code).toBe('OTP_INVALID'); expect(r.body.error.details.attempts_left).toBe(5 - i);
    }
    const fifth = await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: bad });
    expect(fifth.status).toBe(429); expect(fifth.body.error.code).toBe('OTP_LOCKED');
    const right = await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: good });
    expect(right.body.error.code).toBe('OTP_LOCKED');
  });
  it('a locked invite can be unlocked by requesting a new code after the resend window', async () => {
    const inv = await attached();
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    for (let i = 0; i < 5; i++) await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: '999999' });
    await kit.pool.query(`update otp_codes set created_at = now() - interval '2 minutes'`);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/start`)).status).toBe(200);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: otpFrom() })).status).toBe(200);
  });
  it('code format is validated', async () => {
    const inv = await attached();
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    for (const code of ['12345', '1234567', 'abcdef', '', '12 456']) expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code })).status).toBe(400);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({})).status).toBe(400);
  });
  it('confirming without ever starting is refused', async () => {
    const inv = await attached();
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code: '123456' })).body.error.code).toBe('OTP_INVALID');
  });
  it('resend is limited to once a minute', async () => {
    const inv = await attached();
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/start`)).status).toBe(200);
    const r = await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('RATE_LIMITED'); expect(r.body.error.details.resend_after_s).toBeGreaterThan(0);
    expect(kit.mailer.sent.filter((m) => /code/i.test(m.subject))).toHaveLength(1);
  });
  it('expired code (edge: 10 minutes)', async () => {
    const inv = await attached();
    await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    const code = otpFrom();
    await kit.pool.query(`update otp_codes set expires_at = now() - interval '1 second'`);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/confirm`).send({ code })).body.error.code).toBe('OTP_EXPIRED');
  });
  it('expired invites and accepted invites cannot start verification', async () => {
    const inv = await attached();
    await kit.pool.query(`update invites set accept_by = now() - interval '1 second'`);
    const r = await http().post(`/v1/invites/${inv.invite_id}/verify/start`);
    expect(r.status).toBe(410); expect(r.body.error.code).toBe('INVITE_EXPIRED');
    await kit.pool.query(`update invites set accept_by = now() + interval '1 day', status='ACCEPTED'`);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/start`)).status).toBe(409);
  });
  it('unknown invite is 404 and mailer failure is a 503 that leaves no code behind', async () => {
    expect((await http().post('/v1/invites/does-not-exist/verify/start')).status).toBe(404);
    const inv = await attached();
    kit.mailer.failNext = 1;
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/start`)).status).toBe(503);
    expect((await kit.pool.query('select count(*)::int n from otp_codes')).rows[0].n).toBe(0);
    expect((await http().post(`/v1/invites/${inv.invite_id}/verify/start`)).status).toBe(200); // not blocked by the resend limit
  });
  it('a code for one invite does not work on another', async () => {
    const a = await attached('1'); const b = await createInvite(sender, 'rina@example.com');
    kit.packages.set('2', pkgView('2', { sender: sender.account, invite_hash: b.invite_hash_b64 }));
    await sender.agent.post(`/v1/invites/${b.invite_id}/attach`).send({ package_id: '2', tx_hash: 'T' });
    await http().post(`/v1/invites/${a.invite_id}/verify/start`);
    const code = otpFrom();
    await http().post(`/v1/invites/${b.invite_id}/verify/start`);
    expect((await http().post(`/v1/invites/${b.invite_id}/verify/confirm`).send({ code })).status).toBe(400);
  });
});

describe('custom link (D-10, L-01)', () => {
  it('availability check covers valid, invalid, reserved and taken (with suggestion)', async () => {
    const inv = await attached();
    expect((await sender.agent.get('/v1/links/check?slug=rina-audit-bonus')).body).toEqual({ available: true });
    expect((await sender.agent.get('/v1/links/check?slug=A')).body).toEqual({ available: false, reason: 'SLUG_INVALID' });
    expect((await sender.agent.get('/v1/links/check')).body.reason).toBe('SLUG_INVALID');
    expect((await sender.agent.get('/v1/links/check?slug=admin')).body.reason).toBe('SLUG_RESERVED');
    await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'rina-bonus' });
    const taken = (await other.agent.get('/v1/links/check?slug=rina-bonus')).body;
    expect(taken).toEqual({ available: false, reason: 'SLUG_TAKEN', suggestion: 'rina-bonus-2' });
    expect(JSON.stringify(taken)).not.toContain(sender.account); // never reveals the owner
  });
  it('availability check is rate limited to 30 a minute', async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await sender.agent.get('/v1/links/check?slug=abc')).status;
    expect(last).toBe(429);
  });
  it('sets slug, title and amount switch; returns url and preview', async () => {
    const inv = await attached();
    const r = await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'rina-audit-bonus', title: 'Audit bonus for Rina', show_amount: true });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://andum.test/p/rina-audit-bonus');
    expect(r.body.preview.title).toBe('Audit bonus for Rina');
    expect(r.body.preview.description).toContain('200000000'); // show_amount on
    expect(r.body.preview.description).not.toContain('rina@example.com');
    const off = await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ show_amount: false });
    expect(off.body.preview.description).not.toContain('200000000');
  });
  it('default preview hides amounts and the note', async () => {
    const inv = await attached();
    const r = await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'my-link' });
    expect(JSON.stringify(r.body)).not.toContain('secret note');
    expect(r.body.show_amount).toBe(false);
  });
  it('slug rules are enforced with the right codes', async () => {
    const inv = await attached();
    const p = (slug: string) => sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug });
    for (const s of ['ab', 'Upper', 'a--b', '-abc', 'x'.repeat(33)]) { const r = await p(s); expect(r.status, s).toBe(400); expect(r.body.error.code).toBe('SLUG_INVALID'); }
    const rs = await p('andum-official'); expect(rs.status).toBe(400); expect(rs.body.error.code).toBe('SLUG_RESERVED');
    expect((await p('abc')).status).toBe(200); // boundary 3
    expect((await p('x'.repeat(32))).status).toBe(200); // boundary 32
  });
  it('a taken slug is a 409 SLUG_TAKEN with a suggestion', async () => {
    const a = await attached('1'); const b = await createInvite(other, 'x@example.com');
    await sender.agent.patch(`/v1/invites/${a.invite_id}/link`).send({ slug: 'shared-name' });
    const r = await other.agent.patch(`/v1/invites/${b.invite_id}/link`).send({ slug: 'shared-name' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('SLUG_TAKEN'); expect(r.body.error.details.suggestion).toBe('shared-name-2');
    expect((await other.agent.patch(`/v1/invites/${b.invite_id}/link`).send({ slug: 'SHARED-NAME' })).status).toBe(400);
  });
  it('title limit (60), control characters stripped, html is escaped on output', async () => {
    const inv = await attached();
    expect((await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ title: 'x'.repeat(61) })).status).toBe(400);
    expect((await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ title: 'x'.repeat(60) })).status).toBe(200);
    const r = await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'xss-test', title: '<script>alert(1)</script>"\u0000' });
    expect(r.body.title).not.toContain('\u0000');
    const page = await http().get('/p/xss-test');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('<script>');
    expect(page.text).toContain('&lt;script&gt;');
    expect(page.text).toContain('og:title'); expect(page.text).toContain('twitter:card');
    expect(page.text).not.toContain('rina@example.com');
  });
  it('only the sender can edit and an unknown invite is 404', async () => {
    const inv = await attached();
    expect((await other.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'hijack' })).status).toBe(403);
    expect((await sender.agent.patch('/v1/invites/none/link').send({ slug: 'abc' })).status).toBe(404);
    expect((await http().patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'abc' })).status).toBe(401);
  });
  it('changing the slug keeps the old one as a 24h redirect; it expires afterwards', async () => {
    const inv = await attached();
    await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'first-name' });
    await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'second-name' });
    expect((await http().get('/v1/links/second-name')).body).toEqual({ invite_id: inv.invite_id });
    expect((await http().get('/v1/links/first-name')).body).toEqual({ invite_id: inv.invite_id, redirect_to: 'second-name' });
    expect((await http().get('/p/first-name')).status).toBe(200);
    await kit.pool.query(`update link_redirects set expires_at = now() - interval '1 second'`);
    expect((await http().get('/v1/links/first-name')).status).toBe(404);
    expect((await http().get('/p/first-name')).status).toBe(404);
  });
  it('an old slug that still redirects cannot be claimed by another invite', async () => {
    const a = await attached('1'); const b = await createInvite(other, 'x@example.com');
    await sender.agent.patch(`/v1/invites/${a.invite_id}/link`).send({ slug: 'old-one' });
    await sender.agent.patch(`/v1/invites/${a.invite_id}/link`).send({ slug: 'new-one' });
    expect((await other.agent.patch(`/v1/invites/${b.invite_id}/link`).send({ slug: 'old-one' })).status).toBe(409);
    expect((await other.agent.get('/v1/links/check?slug=old-one')).body.reason).toBe('SLUG_TAKEN');
    // the original owner can take it back
    expect((await sender.agent.patch(`/v1/invites/${a.invite_id}/link`).send({ slug: 'old-one' })).status).toBe(200);
  });
  it('at most 10 slug changes per hour', async () => {
    const inv = await attached();
    let last = 200;
    for (let i = 0; i < 11; i++) last = (await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: `name-${i}x` })).status;
    expect(last).toBe(429);
  });
  it('the link is locked once the invite is accepted', async () => {
    const inv = await attached();
    await kit.pool.query(`update invites set status='ACCEPTED'`);
    const r = await sender.agent.patch(`/v1/invites/${inv.invite_id}/link`).send({ slug: 'too-late' });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('LINK_LOCKED');
  });
  it('unknown slugs are 404', async () => {
    expect((await http().get('/v1/links/nothing-here')).status).toBe(404);
    expect((await http().get('/p/nothing-here')).status).toBe(404);
  });
  it('slug lookups are rate limited per ip', async () => {
    let last = 404;
    for (let i = 0; i < 62; i++) last = (await http().get('/v1/links/probe-me')).status;
    expect(last).toBe(429);
  });
});

describe('public invite view', () => {
  it('shows what the chain shows, masks the email, hides the note and never contains the secret', async () => {
    const inv = await attached('1', { parts: [
      { part_id: 0, token: USDC, amount: '200000000', funded: '200000000', unlock_ns: null, approvers: [], threshold: 0, approvals: [], approved: false, state: 'LOCKED', status: 'NOT_ACCEPTED', reason: 'PACKAGE_NOT_ACTIVE', taken_ns: null },
      { part_id: 1, token: USDC, amount: '800000000', funded: '800000000', unlock_ns: '123', approvers: ['a.testnet', 'b.testnet'], threshold: 2, approvals: [], approved: false, state: 'LOCKED', status: 'NOT_ACCEPTED', reason: 'PACKAGE_NOT_ACTIVE', taken_ns: null },
    ] });
    const r = await http().get(`/v1/invites/${inv.invite_id}/public`);
    expect(r.status).toBe(200);
    expect(r.body.email_hint).toBe('r***@example.com');
    expect(r.body.package.has_note).toBe(true);
    expect(r.body.package.total_by_token[USDC]).toBe('1000000000');
    expect(r.body.package.parts[1]).toEqual({ token: USDC, amount: '800000000', unlock_ns: '123', approver_count: 2, threshold: 2 });
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('secret note'); expect(text).not.toContain('rina@example.com');
    const secret = (await kit.pool.query('select secret_enc from invites')).rows[0];
    expect(text).not.toContain(secret.secret_enc.toString('base64'));
  });
  it('works for an unattached invite (no package yet) and 404s for unknown ids', async () => {
    const inv = await createInvite();
    const r = await http().get(`/v1/invites/${inv.invite_id}/public`);
    expect(r.status).toBe(200); expect(r.body.package).toBeNull();
    expect((await http().get('/v1/invites/unknown/public')).status).toBe(404);
  });
  it('is 503 when the chain is unreachable', async () => {
    const inv = await attached();
    await kit.pool.query('delete from packages');
    kit.chain.transportFailures = 1;
    expect((await http().get(`/v1/invites/${inv.invite_id}/public`)).status).toBe(503);
  });
});
