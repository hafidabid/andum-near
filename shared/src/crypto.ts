import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual, createHmac } from 'crypto';

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function randomId(len = 22): string {
  let s = ''; const b = randomBytes(len);
  for (let i = 0; i < len; i++) s += URL_ALPHABET[b[i] & 63];
  return s;
}
export const newInviteSecret = () => randomBytes(32);

/** AES-256-GCM. Output layout: iv(12) | tag(16) | ciphertext */
export function encrypt(key32: Buffer, plain: Buffer): Buffer {
  if (key32.length !== 32) throw new Error('key must be 32 bytes');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key32, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decrypt(key32: Buffer, blob: Buffer): Buffer {
  if (blob.length < 29) throw new Error('ciphertext too short');
  const d = createDecipheriv('aes-256-gcm', key32, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export const generateOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const hashOtp = (inviteId: string, code: string) => sha256(`otp:${inviteId}:${code}`);
export function safeEqual(a: Buffer, b: Buffer): boolean { return a.length === b.length && timingSafeEqual(a, b); }
export const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex');
