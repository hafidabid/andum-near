/**
 * NEP-366 delegate actions and the minimum of NEAR transaction encoding the relayer needs.
 * Only FunctionCall actions can be decoded; anything else is reported as `other` so the policy can deny it.
 * [VERIFY] against nearcore on testnet (spike S-01): field order follows nearcore primitives.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { BorshReader, BorshWriter } from './borsh';

/** NEP-461 prefix for NEP-366: 2^30 + 366 */
export const DELEGATE_PREFIX = (1 << 30) + 366;
export const ACTION_FUNCTION_CALL = 2;
export const ACTION_DELEGATE = 8;

export interface FunctionCallAction { type: 'FunctionCall'; methodName: string; args: Buffer; gas: bigint; deposit: bigint }
export interface OtherAction { type: 'other'; code: number }
export type DecodedAction = FunctionCallAction | OtherAction;

export interface DelegateActionInput {
  senderId: string;
  receiverId: string;
  actions: FunctionCallAction[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: string; // ed25519:base58
}
export interface DecodedDelegate {
  senderId: string;
  receiverId: string;
  actions: DecodedAction[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: string;
  signature: Buffer; // 64 bytes
  /** bytes that were signed (sha256 input), re-encoded from the decoded fields */
  signedHash: Buffer;
}

export function parsePublicKey(pk: string): Buffer {
  if (!pk.startsWith('ed25519:')) throw new Error('only ed25519 keys are supported');
  const raw = Buffer.from(bs58.decode(pk.slice(8)));
  if (raw.length !== 32) throw new Error('bad public key length');
  return raw;
}
export const formatPublicKey = (raw: Uint8Array) => 'ed25519:' + bs58.encode(raw);

/** Implicit NEAR account id of an ed25519 key: lowercase hex of the public key. */
export function implicitAccountId(publicKey: string): string {
  return parsePublicKey(publicKey).toString('hex');
}

function writePublicKey(w: BorshWriter, pk: string) { w.u8(0).bytes(parsePublicKey(pk)); }

export function encodeDelegateAction(d: DelegateActionInput): Buffer {
  const w = new BorshWriter();
  w.string(d.senderId).string(d.receiverId).u32(d.actions.length);
  for (const a of d.actions) {
    w.u8(ACTION_FUNCTION_CALL).string(a.methodName).vecU8(a.args).u64(a.gas).u128(a.deposit);
  }
  w.u64(d.nonce).u64(d.maxBlockHeight);
  writePublicKey(w, d.publicKey);
  return w.toBuffer();
}

export function delegateHash(encodedDelegateAction: Uint8Array): Buffer {
  const w = new BorshWriter().u32(DELEGATE_PREFIX).bytes(encodedDelegateAction);
  return Buffer.from(sha256(w.toBuffer()));
}

/** Sign (used by tests and the demo LocalKeySigner reference implementation). */
export function signDelegate(d: DelegateActionInput, secretKey32: Uint8Array): string {
  const enc = encodeDelegateAction(d);
  const sig = ed25519.sign(delegateHash(enc), secretKey32);
  const w = new BorshWriter().bytes(enc).u8(0).bytes(sig);
  return w.toBuffer().toString('base64');
}

export function decodeSignedDelegate(b64: string): DecodedDelegate {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length === 0 || raw.length > 20_000) throw new Error('bad size');
  const r = new BorshReader(raw);
  const start = 0;
  const senderId = r.string();
  const receiverId = r.string();
  const n = r.u32();
  if (n > 16) throw new Error('too many actions');
  const actions: DecodedAction[] = [];
  let sawOther = false;
  for (let i = 0; i < n; i++) {
    const code = r.u8();
    if (code === ACTION_FUNCTION_CALL) {
      const methodName = r.string();
      const args = r.vecU8();
      const gas = r.u64();
      const deposit = r.u128();
      actions.push({ type: 'FunctionCall', methodName, args, gas, deposit });
    } else {
      // cannot parse the remainder reliably; record and stop (policy denies it)
      actions.push({ type: 'other', code });
      sawOther = true;
      break;
    }
  }
  if (sawOther) {
    return { senderId, receiverId, actions, nonce: 0n, maxBlockHeight: 0n, publicKey: '', signature: Buffer.alloc(64), signedHash: Buffer.alloc(32) };
  }
  const nonce = r.u64();
  const maxBlockHeight = r.u64();
  const keyType = r.u8();
  if (keyType !== 0) throw new Error('unsupported key type');
  const publicKey = formatPublicKey(r.bytes(32));
  const delegateBytes = raw.subarray(start, r.offset);
  const sigType = r.u8();
  if (sigType !== 0) throw new Error('unsupported signature type');
  const signature = r.bytes(64);
  if (!r.done) throw new Error('trailing bytes');
  return { senderId, receiverId, actions, nonce, maxBlockHeight, publicKey, signature, signedHash: delegateHash(delegateBytes) };
}

export function verifyDelegateSignature(d: DecodedDelegate): boolean {
  try {
    if (!d.publicKey) return false;
    return ed25519.verify(d.signature, d.signedHash, parsePublicKey(d.publicKey));
  } catch {
    return false;
  }
}

/** Build a transaction that wraps a signed delegate (relayer signs it). Returns base64 SignedTransaction. */
export function buildRelayTransaction(opts: {
  relayerId: string; relayerPublicKey: string; relayerSecretKey: Uint8Array; nonce: bigint;
  blockHash: string; /* base58 */ receiverId: string; signedDelegateB64: string;
}): { base64: string; hash: string } {
  const w = new BorshWriter();
  w.string(opts.relayerId);
  writePublicKey(w, opts.relayerPublicKey);
  w.u64(opts.nonce).string(opts.receiverId);
  const bh = Buffer.from(bs58.decode(opts.blockHash));
  if (bh.length !== 32) throw new Error('bad block hash');
  w.bytes(bh);
  w.u32(1).u8(ACTION_DELEGATE).bytes(Buffer.from(opts.signedDelegateB64, 'base64'));
  const tx = w.toBuffer();
  const txHash = Buffer.from(sha256(tx));
  const sig = ed25519.sign(txHash, opts.relayerSecretKey);
  const signed = Buffer.concat([tx, Buffer.from([0]), Buffer.from(sig)]);
  return { base64: signed.toString('base64'), hash: bs58.encode(txHash) };
}

/** Build a plain transfer transaction (for account top-ups and, with FunctionCall, faucet calls). */
export function buildTransaction(opts: {
  signerId: string; signerPublicKey: string; signerSecretKey: Uint8Array; nonce: bigint; blockHash: string; receiverId: string;
  action: { type: 'Transfer'; deposit: bigint } | FunctionCallAction;
}): { base64: string; hash: string } {
  const w = new BorshWriter();
  w.string(opts.signerId);
  writePublicKey(w, opts.signerPublicKey);
  w.u64(opts.nonce).string(opts.receiverId).bytes(Buffer.from(bs58.decode(opts.blockHash)));
  w.u32(1);
  if (opts.action.type === 'Transfer') w.u8(3).u128(opts.action.deposit);
  else w.u8(ACTION_FUNCTION_CALL).string(opts.action.methodName).vecU8(opts.action.args).u64(opts.action.gas).u128(opts.action.deposit);
  const tx = w.toBuffer();
  const h = Buffer.from(sha256(tx));
  const sig = ed25519.sign(h, opts.signerSecretKey);
  return { base64: Buffer.concat([tx, Buffer.from([0]), Buffer.from(sig)]).toString('base64'), hash: bs58.encode(h) };
}

export function keypairFromSecret(secretKey32: Uint8Array) {
  const pub = ed25519.getPublicKey(secretKey32);
  return { publicKey: formatPublicKey(pub), accountId: Buffer.from(pub).toString('hex') };
}

/** Parse a NEAR-style secret `ed25519:<base58 of 64 bytes (secret||public)>` or 32-byte seed. */
export function parseSecretKey(s: string): Uint8Array {
  const raw = Buffer.from(bs58.decode(s.replace(/^ed25519:/, '')));
  if (raw.length === 64 || raw.length === 32) return raw.subarray(0, 32);
  throw new Error('bad secret key length');
}
