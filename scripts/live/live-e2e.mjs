#!/usr/bin/env node
// LIVE end-to-end on NEAR testnet through the real API + worker + relayer. See lib.mjs for setup. Run from repo root: node scripts/live/live-e2e.mjs
import { dep, API, MAIL, CORE, USDC, TGAS, C, out, step, ok, bad, note, short, sleep, rpc, view, explorer, User } from './lib.mjs';
import { randomBytes } from 'crypto';
const NS = 1_000_000_000n; const nowNs = async () => BigInt((await rpc('block', { finality: 'final' })).result.header.timestamp);
const run = Date.now().toString(36);
const sender = new User('Sender', `sender+${run}@example.com`), rina = new User('Rina  ', `rina+${run}@example.com`), appr = new User('Appr. ', `approver+${run}@example.com`), eve = new User('Eve   ', `eve+${run}@example.com`);
const results = [];
const expect = (name, cond) => { results.push([name, !!cond]); cond ? ok(name) : bad('UNEXPECTED: ' + name); };

out(`${C.b}ANDUM — LIVE on NEAR testnet${C.r}  ${C.d}core ${CORE} · token ${USDC} · real relayer, worker, Postgres, Redis, Mailpit${C.r}`);
step(1, 'Sign in by email (SMTP → Mailpit) and create the NEAR accounts');
for (const u of [sender, rina, appr, eve]) { await u.login(); await u.bootstrap(); }

step(2, 'Sender gets 1,000 test USDC from the faucet');
const f = await sender.call('post', '/v1/faucet/near', { asset_id: 'usdc', amount: '1000000000' });
await sleep(2500); note('sender balance on chain: ' + JSON.stringify(await view(USDC, 'ft_balance_of', { account_id: sender.account })));

step(3, 'Sender builds a 2-part package: part 1 open now; part 2 opens by date AND needs approval');
const inv = (await sender.call('post', '/v1/invites', { recipient_email: rina.email })).body;
const T = await nowNs();
const created = await sender.relay('create_package (2 parts, 1000 USDC)', CORE, 'create_package', { args: { parts: [{ token: USDC, amount: '200000000' }, { token: USDC, amount: '800000000', unlock_ns: (T + 150n * NS).toString(), approvers: [appr.account] }], accept_by_ns: (T + 3600n * NS).toString(), invite_hash: inv.invite_hash_b64, theme: 'confetti', note: 'Thanks for the audit!' } }, 0n, 30n * TGAS);
expect('package created on testnet', created.status === 'SUCCEEDED');
const pkgId = '1' === '1' ? (await view(CORE, 'get_package', { package_id: '1' })) && null : null;
// find the package id from the event the reconciler cached
await sleep(3000); const mine = (await sender.call('get', '/v1/packages?role=sender', null, true)).body.items ?? [];
const pid = mine[0]?.id ?? mine[0]?.package_id; note('package id: ' + pid);

step(4, 'Sender funds each part with ft_transfer_call (1 yocto), then attaches the invite → email to Rina');
for (const [i, amt] of [[0, '200000000'], [1, '800000000']]) { const r = await sender.relay(`fund part ${i + 1}`, USDC, 'ft_transfer_call', { receiver_id: CORE, amount: amt, msg: JSON.stringify({ package_id: String(pid), part_id: i }) }, 1n, 80n * TGAS); expect(`part ${i + 1} funded`, r.status === 'SUCCEEDED'); }
await sender.call('post', `/v1/invites/${inv.invite_id}/attach`, { package_id: String(pid), tx_hash: created.tx_hash });
await sleep(2500); const mails = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + rina.email)}`)).json(); out(`   ${C.y}✉  Mailpit inbox of ${rina.email}: "${mails.messages?.[0]?.Subject}"${C.r}`);

step(5, 'Rina opens the link: sees the funds before accepting, verifies her email, receives the secret');
const pub = (await fetch(`${API}/v1/invites/${inv.invite_id}/public`).then((r) => r.json())); out(`   ${C.c}public preview${C.r} ${C.d}${short({ total_by_token: pub.package?.total_by_token, parts: pub.package?.parts?.length })}${C.r}`);
await rina.call('post', `/v1/invites/${inv.invite_id}/verify/start`);
const { code: icode } = await rina.code(); out(`   ${C.y}✉  invite code ${C.b}${icode}${C.r}`);
const secret = (await rina.call('post', `/v1/invites/${inv.invite_id}/verify/confirm`, { code: icode })).body;

step(6, 'Negative: a wrong invite secret is refused by the contract');
const bad1 = await rina.relay('accept_package (WRONG secret)', CORE, 'accept_package', { package_id: String(pid), invite_secret: Buffer.alloc(32, 1).toString('base64') }, 0n, 150n * TGAS);
expect('wrong secret → INVITE_SECRET_INVALID', bad1.error_code === 'INVITE_SECRET_INVALID');
step(7, 'Accept with the real secret → Rina holds the non-transferable pass');
const acc = await rina.relay('accept_package', CORE, 'accept_package', secret, 0n, 150n * TGAS); expect('accepted', acc.status === 'SUCCEEDED');
note('NFT tokens of Rina: ' + short(await view(CORE, 'nft_tokens_for_owner', { account_id: rina.account })));

step(8, 'Take part 1 (open now)');
const c1 = await rina.relay('claim part 1', CORE, 'claim', { package_id: String(pid), part_id: 0 }); expect('part 1 claimed', c1.status === 'SUCCEEDED');
await sleep(4000); const bal = await view(USDC, 'ft_balance_of', { account_id: rina.account }); note('Rina USDC balance on chain: ' + JSON.stringify(bal)); expect('Rina received 200 USDC', bal === '200000000');

step(9, 'Negative cases against the live contract');
expect('part 1 twice → ALREADY_TAKEN', (await rina.relay('claim part 1 again', CORE, 'claim', { package_id: String(pid), part_id: 0 })).error_code === 'ALREADY_TAKEN');
expect('part 2 too early → TIME_NOT_REACHED', (await rina.relay('claim part 2 (too early)', CORE, 'claim', { package_id: String(pid), part_id: 1 })).error_code === 'TIME_NOT_REACHED');
expect('stranger → NOT_PASS_OWNER', (await eve.relay('claim as a stranger', CORE, 'claim', { package_id: String(pid), part_id: 1 })).error_code === 'NOT_PASS_OWNER');
expect('unknown contract refused by relayer policy', (await eve.relay('call an unknown contract', 'evil.testnet', 'steal', {})).status === 'REFUSED');

step(10, 'Wait for the date, then approval is still missing');
while ((await nowNs()) < T + 155n * NS) { await sleep(5000); }
expect('date passed, no approval → APPROVAL_MISSING', (await rina.relay('claim part 2 (date ok, no approval)', CORE, 'claim', { package_id: String(pid), part_id: 1 })).error_code === 'APPROVAL_MISSING');
step(11, 'Approver approves (a stranger cannot)');
expect('stranger → NOT_APPROVER', (await eve.relay('approve as a stranger', CORE, 'approve_part', { package_id: String(pid), part_id: 1 }, 0n, 30n * TGAS)).error_code === 'NOT_APPROVER');
expect('approved', (await appr.relay('approve part 2', CORE, 'approve_part', { package_id: String(pid), part_id: 1 }, 0n, 30n * TGAS)).status === 'SUCCEEDED');
step(12, 'Take part 2 → everything claimed');
expect('part 2 claimed', (await rina.relay('claim part 2', CORE, 'claim', { package_id: String(pid), part_id: 1 })).status === 'SUCCEEDED');
await sleep(4000); const bal2 = await view(USDC, 'ft_balance_of', { account_id: rina.account }); expect('Rina holds 1,000 USDC', bal2 === '1000000000');
const evs = (await sender.call('get', `/v1/packages/${pid}/events`, null, true)).body; out(`   ${C.c}history${C.r} ${C.d}${(evs.map?.((e) => e.event) ?? []).join(', ')}${C.r}`);
const passed = results.filter((r) => r[1]).length; out(`\n${C.b}${passed === results.length ? C.g : C.R}Live run: ${passed}/${results.length} checks passed on NEAR testnet.${C.r}`);
process.exit(passed === results.length ? 0 : 1);
