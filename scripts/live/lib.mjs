#!/usr/bin/env node
// LIVE end-to-end on NEAR testnet through the real API + worker + relayer. Needs: API on :8090, worker, Mailpit (SMTP :1025, UI :8025), contracts deployed (deployments/near.testnet.json).
// Run from repo root:  node scripts/live/live-e2e.mjs
import path from 'path'; import { randomBytes, createHash } from 'crypto'; import { createRequire } from 'module';
const require = createRequire(path.resolve('shared/package.json'));
const { ed25519 } = require('@noble/curves/ed25519');
const shared = require(path.resolve('shared/dist/index.js'));
const { signDelegate, keypairFromSecret } = shared;
import fs from 'fs';
const dep = JSON.parse(fs.readFileSync('deployments/near.testnet.json', 'utf8'));
const API = process.env.API ?? 'http://localhost:8090', MAIL = process.env.MAIL ?? 'http://localhost:8025', RPC = 'https://test.rpc.fastnear.com';
const CORE = dep.core, USDC = dep.tokens.usdc, TGAS = 10n ** 12n;
const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', m: '\x1b[35m', R: '\x1b[31m' };
const out = (s = '') => console.log(s); const step = (n, t) => out(`\n${C.b}${C.m}━━ ${n}. ${t}${C.r}`);
const ok = (t) => out(`   ${C.g}✔ ${t}${C.r}`), bad = (t) => out(`   ${C.y}✖ ${t}${C.r}`), note = (t) => out(`${C.d}   # ${t}${C.r}`);
const short = (v) => { const s = JSON.stringify(v); return s.length > 140 ? s.slice(0, 137) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const view = async (acct, m, args) => { const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: acct, method_name: m, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }); return r.result ? JSON.parse(Buffer.from(r.result.result).toString()) : { error: r.error?.data ?? r.error }; };
const explorer = (tx) => `https://testnet.nearblocks.io/txns/${tx}`;

class User {
  jar = ''; sk = randomBytes(32); nonce = 0n;
  constructor(name, email) { this.name = name; this.email = email; const kp = keypairFromSecret(new Uint8Array(this.sk)); this.pk = kp.publicKey; this.account = kp.accountId; }
  async call(method, p, body, quiet = false) {
    const res = await fetch(API + p, { method: method.toUpperCase(), headers: { 'content-type': 'application/json', cookie: this.jar }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie?.() ?? []; if (sc.length) this.jar = sc.map((c) => c.split(';')[0]).join('; ');
    const j = await res.json().catch(() => ({}));
    if (!quiet) out(`   ${C.c}${this.name} ${C.b}${method.toUpperCase()} ${p}${C.r}${body ? C.d + ' ' + short(body) : ''}${C.r}\n   ${res.status < 300 ? C.g : C.R}↳ ${res.status}${C.r} ${C.d}${short(j)}${C.r}`);
    return { status: res.status, body: j };
  }
  async code() { for (let i = 0; i < 20; i++) { const l = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + this.email)}`)).json(); const m = l.messages?.[0]; if (m && Date.now() - new Date(m.Created).getTime() < 120000) { const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json(); const c = /(\d{6})/.exec(full.Text)?.[1]; if (c && !this.used?.has(c)) { (this.used ??= new Set()).add(c); return { code: c, subject: m.Subject }; } } await sleep(500); } throw new Error('no mail'); }
  async login() {
    await this.call('post', '/v1/auth/email/start', { email: this.email });
    const { code, subject } = await this.code(); out(`   ${C.y}✉  Mailpit inbox of ${this.email}: "${subject}" → ${C.b}${code}${C.r}`);
    await this.call('post', '/v1/auth/email/verify', { email: this.email, code });
    const n = (await this.call('get', '/v1/auth/nonce', null, true)).body.nonce;
    const signature = Buffer.from(ed25519.sign(Buffer.from(`andum-bind:${n}:${this.account}`), this.sk)).toString('base64');
    await this.call('post', '/v1/auth/key', { public_key: this.pk, signature, nonce: n });
    ok(`${this.name} signed in with email; implicit NEAR account ${C.b}${this.account.slice(0, 14)}…${C.r}${C.g} (key never leaves this process)`);
  }
  async bootstrap() { const r = await this.call('post', '/v1/accounts/bootstrap'); if (r.body.topup_tx) { ok(`relayer funded the new account with a tiny top-up  ${C.d}${explorer(r.body.topup_tx)}${C.r}`); await sleep(2500); } this.nonce = 0n; await this.syncNonce(); }
  async syncNonce() { const r = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: this.account, public_key: this.pk }); this.nonce = BigInt(r.result?.nonce ?? 0); }
  async relay(label, receiver, method, args, deposit = 0n, gas = 100n * TGAS) {
    await this.syncNonce();
    const h = BigInt((await rpc('status', [])).result.sync_info.latest_block_height);
    const b64 = signDelegate({ senderId: this.account, receiverId: receiver, actions: [{ type: 'FunctionCall', methodName: method, args: Buffer.from(JSON.stringify(args)), gas, deposit }], nonce: this.nonce + 1n, maxBlockHeight: h + 120n, publicKey: this.pk }, this.sk);
    out(`   ${C.c}${this.name} signs ${C.b}${label}${C.r}${C.d}  (delegate action, user pays no gas)${C.r}`);
    const sub = await this.call('post', '/v1/relay/submit', { signed_delegate_b64: b64, client_request_id: randomBytes(6).toString('hex') }, null, true);
    if (sub.status !== 202) { bad(`API refused: ${sub.status} ${sub.body?.error?.code}`); return { status: 'REFUSED', ...sub.body }; }
    for (let i = 0; i < 90; i++) { const s = (await this.call('get', `/v1/relay/${sub.body.relay_id}`, null, true)).body; if (!['QUEUED', 'SUBMITTED'].includes(s.status)) { s.status === 'SUCCEEDED' ? ok(`on-chain: SUCCEEDED  ${C.d}${explorer(s.tx_hash)}${C.r}`) : bad(`on-chain: ${s.status} ${C.b}${s.error_code}${C.r}${C.y}`); return s; } await sleep(1500); }
    throw new Error('relay stuck');
  }
}

export { dep, API, MAIL, CORE, USDC, TGAS, C, out, step, ok, bad, note, short, sleep, rpc, view, explorer, User };
