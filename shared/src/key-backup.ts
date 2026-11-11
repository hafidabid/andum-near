/**
 * Client-side key backup format (reference implementation, WebCrypto compatible).
 * The server stores the blob but can never open it: the key is derived from a passphrase only the user knows.
 * PBKDF2-HMAC-SHA256 (600k iterations) -> AES-256-GCM. The 32-byte ed25519 seed is the plaintext.
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

export interface KeyBackupBlob { v: 1; kdf: 'pbkdf2-sha256'; iter: number; salt: string; iv: string; ct: string }
export const BACKUP_ITER = 600_000;

export function wrapSeed(seed32: Uint8Array, passphrase: string, iter = BACKUP_ITER): KeyBackupBlob {
  if (seed32.length !== 32) throw new Error('seed must be 32 bytes');
  if (passphrase.length < 8) throw new Error('passphrase too short');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, iter, 32, 'sha256');
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(seed32), c.final(), c.getAuthTag()]);
  return { v: 1, kdf: 'pbkdf2-sha256', iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}

export function unwrapSeed(b: KeyBackupBlob, passphrase: string): Uint8Array {
  const key = pbkdf2Sync(passphrase, Buffer.from(b.salt, 'base64'), b.iter, 32, 'sha256');
  const raw = Buffer.from(b.ct, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'base64'));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return new Uint8Array(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]));
}
