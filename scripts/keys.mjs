#!/usr/bin/env node
// Key helper for deployments. Secrets live in deployments/secrets/ (gitignored, chmod 600). Never print private keys to logs.
//   node scripts/keys.mjs gen                -> create near-keys.json (ops, relayer, bridgeworker) and evm-keys.json (relayer, bridgeworker, deployer) if missing
//   node scripts/keys.mjs near <name> pub|priv   ('root' reads the funded account from ./secret)
//   node scripts/keys.mjs evm <name> addr|priv
import fs from 'fs'; import path from 'path'; import { randomBytes } from 'crypto';
import { createRequire } from 'module';
const require = createRequire(path.resolve('shared/package.json'));
const { ed25519 } = require('@noble/curves/ed25519');
const { privateKeyToAccount } = require('viem/accounts');
const dir = path.resolve('deployments/secrets'); fs.mkdirSync(dir, { recursive: true });
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x) break; s = '1' + s; } return s; };
const unb58 = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
const nearPair = (sk32) => ({ public: 'ed25519:' + b58(ed25519.getPublicKey(sk32)), private: 'ed25519:' + b58(Buffer.concat([sk32, ed25519.getPublicKey(sk32)])) });
const secretFile = () => Object.fromEntries(fs.readFileSync('secret', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const write = (f, o) => { fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2), { mode: 0o600 }); };
const [cmd, name, what] = process.argv.slice(2);
if (cmd === 'gen') {
  const nf = path.join(dir, 'near-keys.json');
  if (!fs.existsSync(nf)) { write('near-keys.json', Object.fromEntries(['ops', 'relayer', 'bridgeworker'].map((n) => [n, nearPair(randomBytes(32))]))); console.log('created near-keys.json'); }
  const ef = path.join(dir, 'evm-keys.json');
  if (!fs.existsSync(ef)) { write('evm-keys.json', Object.fromEntries(['relayer', 'bridgeworker'].map((n) => { const pk = '0x' + randomBytes(32).toString('hex'); return [n, { address: privateKeyToAccount(pk).address, private: pk }]; }))); console.log('created evm-keys.json'); }
} else if (cmd === 'near') {
  if (name === 'root') { const sk = unb58(secretFile().NEAR_ACCOUNT_PRIVATE_KEY.replace('ed25519:', '')).subarray(0, 32); const p = nearPair(sk); console.log(what === 'pub' ? p.public : p.private); }
  else console.log(JSON.parse(fs.readFileSync(path.join(dir, 'near-keys.json'), 'utf8'))[name][what === 'pub' ? 'public' : 'private']);
} else if (cmd === 'evm') {
  if (name === 'sepolia') { const pk = secretFile().SEPOLIA_PRIVATE_KEY; console.log(what === 'addr' ? privateKeyToAccount(pk).address : pk); }
  else { const o = JSON.parse(fs.readFileSync(path.join(dir, 'evm-keys.json'), 'utf8'))[name]; console.log(what === 'addr' ? o.address : o.private); }
}
