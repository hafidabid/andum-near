#!/usr/bin/env node
// LIVE bridge rehearsal: NEAR testnet <-> an EVM chain (NET=anvil local, or NET=sepolia), through the real worker.
// Needs anvil on :8545 with deployments/anvil.json, and the API/worker started with EVM_BASE_SEPOLIA_* pointing at anvil (see deployments/secrets/live.env).
import { execSync } from 'child_process'; import fs from 'fs'; import pg from '../../node_modules/pg/lib/index.js';
import { dep, C, out, step, ok, bad, note, sleep, view, explorer, User, USDC, API } from './lib.mjs';
const NET = process.env.NET ?? 'anvil'; // anvil | sepolia
const anvil = JSON.parse(fs.readFileSync(`deployments/${NET}.json`, 'utf8'));
const DEST_CHAIN = NET === 'anvil' ? 'baseSepolia' : 'sepolia';
const RPC = NET === 'anvil' ? 'http://127.0.0.1:8545' : (process.env.EVM_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com');
const sh0 = (c) => execSync(c, { env: { ...process.env, PATH: process.env.HOME + '/.foundry/bin:' + process.env.PATH }, encoding: 'utf8' }).trim();
const sh = (c) => { for (let i = 0; ; i++) { try { return sh0(c); } catch (e) { if (i >= 3 || !/nonce|underpriced|rate|timeout|429/i.test(String(e.stderr ?? e))) throw e; execSync('sleep 6'); } } };
// throwaway EVM user for the rehearsal, funded on the local chain
const _w = JSON.parse(sh('cast wallet new --json'))[0]; const ACC = _w.address, KEY = _w.private_key;
if (NET === 'anvil') sh(`cast rpc anvil_setBalance ${ACC} 0x56BC75E2D63100000 --rpc-url ${RPC}`);
else { const dk = sh0('node scripts/keys.mjs evm sepolia priv'); sh(`cast send ${ACC} --value 0.01ether --rpc-url ${RPC} --private-key ${dk}`); }
const DEST = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // arbitrary receiving address
const db = new pg.Pool({ connectionString: 'postgres://andum@localhost:5544/andum_live' });
const results = []; const expect = (n, c) => { results.push(!!c); c ? ok(n) : bad('UNEXPECTED: ' + n); };
const usdcEvm = anvil.tokens.usdc, GW = anvil.gateway, ASSET = sh('cast keccak usdc');
const evmBal = (a) => BigInt(sh(`cast call ${usdcEvm} "balanceOf(address)(uint256)" ${a} --rpc-url ${RPC}`).split(' ')[0]);
const mine = (n) => (NET === 'anvil' ? sh(`cast rpc anvil_mine ${n} --rpc-url ${RPC}`) : '');
const waitFor = async (label, q, args, want, ms = NET === 'anvil' ? 120000 : 300000) => { const t = Date.now(); for (;;) { const r = (await db.query(q, args)).rows[0]; if (r && want.includes(r.status)) return r; if (Date.now() - t > ms) return r ?? null; mine(1); await sleep(3000); } };

out(`${C.b}ANDUM — LIVE bridge rehearsal${C.r}  ${C.d}NEAR testnet ↔ ${NET} · gateway ${GW.slice(0, 10)}… · bridge ${dep.bridge}${C.r}`);
const rina = new User('Rina', `rina+${Date.now().toString(36)}@example.com`);
step(1, 'Rina signs in by email and gets a NEAR account'); await rina.login(); await rina.bootstrap();

step(2, 'EVM → NEAR: Rina deposits 50 test USDC into the gateway on the EVM chain');
sh(`cast send ${usdcEvm} "faucet(address,uint256)" ${ACC} 100000000 --rpc-url ${RPC} --private-key ${KEY}`);
sh(`cast send ${usdcEvm} "approve(address,uint256)" ${GW} 50000000 --rpc-url ${RPC} --private-key ${KEY}`);
const tx = sh(`cast send ${GW} "depositForNear(bytes32,uint256,string,uint64,uint8,bool)" ${ASSET} 50000000 ${rina.account} 0 0 false --rpc-url ${RPC} --private-key ${KEY} --json`);
out(`   ${C.c}${NET}${C.r} depositForNear(usdc, 50, ${rina.account.slice(0, 12)}…)  ${C.d}EVM balance now ${evmBal(ACC)} (was 100000000)${C.r}`);
mine(6);
const t1 = await waitFor('evm->near', `select * from bridge_transfers where direction='EVM_TO_NEAR' and near_account=$1 order by created_at desc limit 1`, [rina.account], ['DONE', 'FAILED']);
out(`   ${C.d}worker row: ${t1?.status} ${t1?.error ?? ''}${C.r}`);
expect('worker detected, confirmed and minted on NEAR (DONE)', t1?.status === 'DONE');
await sleep(3000); const nb = await view(USDC, 'ft_balance_of', { account_id: rina.account }); note('Rina NEAR USDC balance: ' + JSON.stringify(nb)); expect('Rina holds 50 USDC on NEAR', nb === '50000000');
if (t1?.dst_tx) note(explorer(t1.dst_tx));
const again = await db.query(`select count(*)::int n from bridge_transfers where direction='EVM_TO_NEAR' and near_account=$1`, [rina.account]); expect('exactly one transfer row (idempotent)', again.rows[0].n === 1);

step(3, 'NEAR → EVM: Rina sends 20 USDC out through the bridge contract (gasless)');
const before = evmBal(DEST);
const quote = (await rina.call('post', '/v1/bridge/out/quote', { asset_id: 'usdc', amount: '20000000', dest_chain: DEST_CHAIN, dest_address: DEST })).body;
const r = await rina.relay('bridge out 20 USDC', quote.ft_transfer_call.token, 'ft_transfer_call', { receiver_id: quote.ft_transfer_call.receiver_id, amount: quote.ft_transfer_call.amount, msg: quote.ft_transfer_call.msg }, 1n, 80n * 10n ** 12n);
expect('NEAR transfer to bridge succeeded', r.status === 'SUCCEEDED');
const t2 = await waitFor('near->evm', `select * from bridge_transfers where direction='NEAR_TO_EVM' and near_account=$1 order by created_at desc limit 1`, [rina.account], ['DONE', 'FAILED']);
out(`   ${C.d}worker row: ${t2?.status} ${t2?.error ?? ''}${C.r}`); expect('worker released on EVM (DONE)', t2?.status === 'DONE');
const after = evmBal(DEST); note(`EVM destination balance ${before} → ${after}`); expect('destination received 20 USDC on EVM', after - before === 20000000n);
await sleep(2500); const nb2 = await view(USDC, 'ft_balance_of', { account_id: rina.account }); expect('NEAR side burned 20 (30 left)', nb2 === '30000000');

step(4, 'Negative: bad destination chain and zero address are refused');
expect('unknown chain refused by the quote API', (await rina.call('post', '/v1/bridge/out/quote', { asset_id: 'usdc', amount: '1', dest_chain: 'mars', dest_address: DEST })).status === 400);
expect('zero address refused', (await rina.call('post', '/v1/bridge/out/quote', { asset_id: 'usdc', amount: '1', dest_chain: 'baseSepolia', dest_address: '0x' + '0'.repeat(40) })).status === 400);
const p = results.filter(Boolean).length; out(`\n${C.b}${p === results.length ? C.g : C.R}Bridge rehearsal: ${p}/${results.length} checks passed.${C.r}`); await db.end(); process.exit(p === results.length ? 0 : 1);
