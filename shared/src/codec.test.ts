import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { BorshReader, BorshWriter } from './borsh';
import { decodeSignedDelegate, encodeDelegateAction, keypairFromSecret, signDelegate, verifyDelegateSignature, implicitAccountId, parsePublicKey, DelegateActionInput, buildRelayTransaction, delegateHash } from './near-tx';
import bs58 from 'bs58';

const sk = new Uint8Array(32).fill(9);
const kp = keypairFromSecret(sk);
const base = (): DelegateActionInput => ({
  senderId: kp.accountId, receiverId: 'core.andum.testnet',
  actions: [{ type: 'FunctionCall', methodName: 'claim', args: Buffer.from('{"package_id":"1","part_id":0}'), gas: 100_000_000_000_000n, deposit: 0n }],
  nonce: 5n, maxBlockHeight: 1200n, publicKey: kp.publicKey,
});

describe('borsh', () => {
  it('round trips ints, strings and vectors', () => {
    const b = new BorshWriter().u8(255).u32(4_000_000_000).u64(2n ** 64n - 1n).u128(2n ** 128n - 1n).string('héllo').vecU8(Buffer.from([1, 2])).toBuffer();
    const r = new BorshReader(b);
    expect([r.u8(), r.u32(), r.u64(), r.u128(), r.string(), [...r.vecU8()]]).toEqual([255, 4_000_000_000, 2n ** 64n - 1n, 2n ** 128n - 1n, 'héllo', [1, 2]]);
    expect(r.done).toBe(true);
  });
  it('rejects out of range u128 and truncated input', () => {
    expect(() => new BorshWriter().u128(2n ** 128n)).toThrow();
    expect(() => new BorshWriter().u128(-1n)).toThrow();
    expect(() => new BorshReader(Buffer.from([1, 2])).u32()).toThrow(/unexpected end/);
  });
  it('rejects absurd vector lengths', () => {
    const b = new BorshWriter().u32(4_000_001).toBuffer();
    expect(() => new BorshReader(b).vecU8()).toThrow();
  });
});

describe('NEP-366 delegate codec', () => {
  it('sign then decode then verify', () => {
    const d = decodeSignedDelegate(signDelegate(base(), sk));
    expect(d.senderId).toBe(kp.accountId);
    expect(d.nonce).toBe(5n);
    expect(d.maxBlockHeight).toBe(1200n);
    expect(d.publicKey).toBe(kp.publicKey);
    expect(d.actions[0]).toMatchObject({ type: 'FunctionCall', methodName: 'claim', gas: 100_000_000_000_000n, deposit: 0n });
    expect(verifyDelegateSignature(d)).toBe(true);
  });
  it('signature binds to the NEP-461 prefix (raw sha256 of the action does not verify)', () => {
    const enc = encodeDelegateAction(base());
    const wrongHash = require('crypto').createHash('sha256').update(enc).digest();
    expect(wrongHash.equals(delegateHash(enc))).toBe(false);
    const sig = ed25519.sign(wrongHash, sk);
    const b64 = Buffer.concat([enc, Buffer.from([0]), Buffer.from(sig)]).toString('base64');
    expect(verifyDelegateSignature(decodeSignedDelegate(b64))).toBe(false);
  });
  it('tampering with any byte breaks the signature or decoding', () => {
    const raw = Buffer.from(signDelegate(base(), sk), 'base64');
    let failures = 0;
    for (const i of [3, 20, 40, raw.length - 70, raw.length - 40]) {
      const t = Buffer.from(raw); t[i] ^= 0x01;
      try { if (!verifyDelegateSignature(decodeSignedDelegate(t.toString('base64')))) failures++; } catch { failures++; }
    }
    expect(failures).toBe(5);
  });
  it('signature from another key is invalid', () => {
    const other = new Uint8Array(32).fill(3);
    const enc = encodeDelegateAction(base()); // claims kp public key
    const sig = ed25519.sign(delegateHash(enc), other);
    const d = decodeSignedDelegate(Buffer.concat([enc, Buffer.from([0]), Buffer.from(sig)]).toString('base64'));
    expect(verifyDelegateSignature(d)).toBe(false);
  });
  it('reports non-FunctionCall actions as other', () => {
    const w = new BorshWriter().string('a').string('b').u32(1).u8(3).u128(1).toBuffer(); // Transfer
    const d = decodeSignedDelegate(w.toString('base64'));
    expect(d.actions[0]).toEqual({ type: 'other', code: 3 });
    expect(verifyDelegateSignature(d)).toBe(false);
  });
  it('rejects garbage, empty and trailing bytes', () => {
    expect(() => decodeSignedDelegate('')).toThrow();
    expect(() => decodeSignedDelegate(Buffer.from('nonsense').toString('base64'))).toThrow();
    const ok = Buffer.from(signDelegate(base(), sk), 'base64');
    expect(() => decodeSignedDelegate(Buffer.concat([ok, Buffer.from([0])]).toString('base64'))).toThrow(/trailing/);
    expect(() => decodeSignedDelegate(Buffer.alloc(30_000).toString('base64'))).toThrow(/bad size/);
  });
  it('handles unicode method args and large deposit', () => {
    const d = base(); d.actions[0].deposit = 2n ** 100n; d.actions[0].args = Buffer.from('{"msg":"héllo ✓"}');
    const dec = decodeSignedDelegate(signDelegate(d, sk));
    expect(dec.actions[0]).toMatchObject({ deposit: 2n ** 100n });
    expect((dec.actions[0] as any).args.toString()).toContain('✓');
  });
  it('implicit account id is hex of the public key', () => {
    expect(kp.accountId).toBe(Buffer.from(parsePublicKey(kp.publicKey)).toString('hex'));
    expect(implicitAccountId(kp.publicKey)).toBe(kp.accountId);
    expect(kp.accountId).toHaveLength(64);
  });
  it('only ed25519 public keys are accepted', () => {
    expect(() => parsePublicKey('secp256k1:abc')).toThrow();
    expect(() => parsePublicKey('ed25519:' + bs58.encode(Buffer.alloc(31)))).toThrow();
  });
  it('builds a relay transaction with a stable hash', () => {
    const relayerSk = new Uint8Array(32).fill(4); const rk = keypairFromSecret(relayerSk);
    const args = { relayerId: 'relayer.testnet', relayerPublicKey: rk.publicKey, relayerSecretKey: relayerSk, nonce: 1n, blockHash: bs58.encode(Buffer.alloc(32, 1)), receiverId: kp.accountId, signedDelegateB64: signDelegate(base(), sk) };
    const a = buildRelayTransaction(args); const b = buildRelayTransaction(args);
    expect(a).toEqual(b);
    expect(() => buildRelayTransaction({ ...args, blockHash: bs58.encode(Buffer.alloc(5)) })).toThrow();
    expect(buildRelayTransaction({ ...args, nonce: 2n }).hash).not.toBe(a.hash);
  });
});
