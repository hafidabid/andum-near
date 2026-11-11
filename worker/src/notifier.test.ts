import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAll, upsertPackage, enqueueNotification, deliverNotification } from '@andum/shared';
import { WKit, part, pkgView, startWorkerKit } from './testkit';

let kit: WKit;
beforeAll(async () => { kit = await startWorkerKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => { await resetAll(kit.pool); kit.mailer.sent = []; kit.mailer.failNext = 0; kit.chain.transportFailures = 0; kit.packages.clear(); });

const NOW = 2_000_000_000_000_000_000n; // ns
const gated = (o: Record<string, unknown> = {}) => part({ unlock_ns: String(NOW - 1n), ...o });
async function accepted(id: string, parts: any[], owner = 'rina.testnet', chainParts?: any[]) {
  parts = parts.map((p, i) => ({ ...p, part_id: i }));
  await upsertPackage(kit.pool, pkgView(id, { status: 'ACCEPTED', owner, parts }));
  // the chain's own view decides: by default it agrees that the part is OPEN
  kit.packages.set(id, pkgView(id, { status: 'ACCEPTED', owner, parts: chainParts ?? parts.map((p, i) => ({ ...p, part_id: i, status: 'OPEN' })) }));
  await kit.pool.query(`insert into invites (id, sender_account, recipient_email, secret_hash, secret_enc, package_id, status) values ($1,'s','rina@example.com','\\x00','\\x00',$2,'ACCEPTED') on conflict do nothing`, [`inv${id}`, id]);
}
const partMails = () => kit.mailer.sent.filter((m) => /ready/i.test(m.subject));

describe('notifier part_ready (A-06)', () => {
  it('emails the receiver once when a dated part opens, after confirming on chain', async () => {
    await accepted('1', [gated()]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(1);
    expect(partMails()).toHaveLength(1); expect(partMails()[0].to).toBe('rina@example.com');
    expect(partMails()[0].text).toContain('https://andum.test/package/1');
    expect((await kit.pool.query(`select status, dedupe_key from notifications`)).rows).toEqual([{ status: 'SENT', dedupe_key: '1:0:part_ready' }]);
  });
  it('never sends twice: repeated and concurrent ticks produce one mail', async () => {
    await accepted('1', [gated()]);
    await Promise.all([kit.notifier.tick(NOW), kit.notifier.tick(NOW), kit.notifier.tick(NOW)]);
    await kit.notifier.tick(NOW);
    expect(partMails()).toHaveLength(1);
  });
  it('does not send if the chain says the part is not open, then sends once it is', async () => {
    await accepted('1', [gated()], 'rina.testnet', [gated({ status: 'WAITING_APPROVAL' })]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
    expect(kit.mailer.sent).toHaveLength(0);
    expect((await kit.pool.query('select count(*)::int n from notifications')).rows[0].n).toBe(0); // no row: it may still become open
    kit.packages.get('1').parts[0].status = 'OPEN';
    expect((await kit.notifier.tick(NOW)).partReady).toBe(1);
  });
  it('does not send before the date, or while approval is missing, or for taken parts, or for unaccepted packages', async () => {
    await accepted('1', [gated({ unlock_ns: String(NOW + 1n) })]);
    await accepted('2', [gated({ approvers: ['b.testnet'], threshold: 1, approvals: [] })]);
    await accepted('3', [gated({ state: 'TAKEN', taken_ns: '5' })]);
    await upsertPackage(kit.pool, pkgView('4', { status: 'FUNDED', owner: null, parts: [gated()] }));
    await accepted('5', [gated({ approvers: ['a', 'b', 'c'], threshold: 2, approvals: ['a'] })]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
    expect(kit.mailer.sent).toHaveLength(0);
  });
  it('sends when the threshold of an approver group is met, and for the exact unlock boundary', async () => {
    await accepted('1', [gated({ unlock_ns: String(NOW), approvers: ['a', 'b', 'c'], threshold: 2, approvals: ['a', 'b'] })]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(1);
  });
  it('immediately open parts (no date) get no part_ready mail', async () => {
    await accepted('1', [part({ unlock_ns: null })]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
  });
  it('each part gets its own mail', async () => {
    await accepted('1', [gated(), gated(), gated({ unlock_ns: String(NOW + 5n) })]);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(2);
    expect(partMails()).toHaveLength(2);
  });
  it('respects opt-out: SKIPPED row, no mail, and never retried', async () => {
    await accepted('1', [gated()]);
    await kit.pool.query(`insert into notification_prefs (account_id, email_enabled) values ('rina.testnet', false)`);
    await kit.notifier.tick(NOW); await kit.notifier.tick(NOW);
    expect(kit.mailer.sent).toHaveLength(0);
    expect((await kit.pool.query('select status from notifications')).rows).toEqual([{ status: 'SKIPPED' }]);
  });
  it('the receiver preference address wins over the invite address', async () => {
    await accepted('1', [gated()]);
    await kit.pool.query(`insert into notification_prefs (account_id, email_enabled, email) values ('rina.testnet', true, 'rina@work.example')`);
    await kit.notifier.tick(NOW);
    expect(partMails()[0].to).toBe('rina@work.example');
  });
  it('a package with no known email is retried later instead of dropped', async () => {
    await upsertPackage(kit.pool, pkgView('1', { status: 'ACCEPTED', owner: 'rina.testnet', parts: [gated()] }));
    kit.packages.set('1', pkgView('1', { status: 'ACCEPTED', owner: 'rina.testnet', parts: [gated({ status: 'OPEN' })] }));
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
    await kit.pool.query(`insert into notification_prefs (account_id, email_enabled, email) values ('rina.testnet', true, 'late@example.com')`);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(1);
  });
  it('a chain outage while re-checking sends nothing and records nothing', async () => {
    await accepted('1', [gated()]);
    kit.chain.transportFailures = 1;
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
    expect((await kit.pool.query('select count(*)::int n from notifications')).rows[0].n).toBe(0);
    expect((await kit.notifier.tick(NOW)).partReady).toBe(1);
  });
  it('mailer failure: stays PENDING with backoff, then is retried by the next tick once due', async () => {
    await accepted('1', [gated()]);
    kit.mailer.failNext = 1;
    expect((await kit.notifier.tick(NOW)).partReady).toBe(0);
    let n = (await kit.pool.query('select status, attempts, next_attempt_at > now() as later from notifications')).rows[0];
    expect(n).toMatchObject({ status: 'PENDING', attempts: 1, later: true });
    await kit.pool.query(`update notifications set next_attempt_at = now() - interval '1 second'`);
    expect((await kit.notifier.tick(NOW)).retried).toBe(1);
    n = (await kit.pool.query('select status, attempts from notifications')).rows[0];
    expect(n).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(partMails()).toHaveLength(1);
  });
  it('gives up after 5 attempts: FAILED', async () => {
    await accepted('1', [gated()]);
    kit.mailer.failNext = 100;
    await kit.notifier.tick(NOW);
    for (let i = 0; i < 6; i++) { await kit.pool.query(`update notifications set next_attempt_at = now() - interval '1 second'`); await kit.notifier.tick(NOW); }
    const n = (await kit.pool.query('select status, attempts, error from notifications')).rows[0];
    expect(n.status).toBe('FAILED'); expect(n.attempts).toBe(5); expect(n.error).toContain('mailer failure');
    kit.mailer.failNext = 0;
    await kit.notifier.tick(NOW);
    expect(kit.mailer.sent).toHaveLength(0); // a FAILED notification is never resent automatically
  });
});

describe('notifier approval requests and invites', () => {
  it('each named approver with a known address gets exactly one request', async () => {
    await accepted('1', [gated({ unlock_ns: String(NOW + 100n), approvers: ['a.testnet', 'b.testnet'], threshold: 2 })], 'rina.testnet', [gated()]);
    await kit.pool.query(`insert into notification_prefs (account_id, email_enabled, email) values ('a.testnet', true, 'a@example.com'), ('b.testnet', false, 'b@example.com')`);
    expect((await kit.notifier.tick(NOW)).approvals).toBe(1);
    await kit.notifier.tick(NOW);
    const mails = kit.mailer.sent.filter((m) => /approval/i.test(m.subject));
    expect(mails).toHaveLength(1); expect(mails[0].to).toBe('a@example.com');
    expect(mails[0].text).toContain('https://andum.test/approve/1');
  });
  it('approvers who already approved are not asked again, and unaccepted packages ask nobody', async () => {
    await accepted('1', [gated({ unlock_ns: String(NOW + 100n), approvers: ['a.testnet'], threshold: 1, approvals: ['a.testnet'] })], 'rina.testnet', [gated()]);
    await upsertPackage(kit.pool, pkgView('2', { status: 'FUNDED', parts: [gated({ approvers: ['a.testnet'], threshold: 1 })] }));
    await kit.pool.query(`insert into notification_prefs (account_id, email_enabled, email) values ('a.testnet', true, 'a@example.com')`);
    expect((await kit.notifier.tick(NOW)).approvals).toBe(0);
  });
  it('retryPending delivers an invite email the API could not send', async () => {
    const id = await enqueueNotification(kit.pool, { kind: 'invite', dedupeKey: 'invite:x', to: 'rina@example.com', payload: { sender: 's.testnet', link: 'https://andum.test/p/x' } });
    kit.mailer.failNext = 1;
    expect(await deliverNotification(kit.pool, kit.mailer, id!)).toBe('RETRY');
    await kit.pool.query(`update notifications set next_attempt_at = now()`);
    expect((await kit.notifier.tick(NOW)).retried).toBe(1);
    expect(kit.mailer.last('rina@example.com')?.text).toContain('https://andum.test/p/x');
  });
  it('enqueue is idempotent per dedupe key', async () => {
    const a = await enqueueNotification(kit.pool, { kind: 'invite', dedupeKey: 'k', to: 'a@b.co', payload: {} });
    const b = await enqueueNotification(kit.pool, { kind: 'invite', dedupeKey: 'k', to: 'a@b.co', payload: {} });
    expect(a).toBeTruthy(); expect(b).toBeNull();
  });
});
