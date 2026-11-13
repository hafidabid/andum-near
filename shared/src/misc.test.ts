import { describe, expect, it } from 'vitest';
import { validateSlug, normalizeSlugInput, suggestSlug, maskEmail, RESERVED_SLUGS } from './slug';
import { parseChainError, ApiError } from './errors';
import { parseEventLogs, packageIdsFromEvents } from './events';
import { decrypt, encrypt, generateOtp, hashOtp, randomId, safeEqual, sha256 } from './crypto';
import { reasonCopy } from './copy';
import { ASSETS, assetIdFromTokenAccount, getAsset, nearTokenAccount } from './assets';
import { outcomeFromRpc, FakeChain, outcomeErrorCode } from './chain';
import { loadEnv, nearToYocto } from './config';
import { CaptureMailer } from './mailer';

describe('slug rules', () => {
  it.each(['abc', 'rina-audit-bonus', 'a1-b2', 'x'.repeat(32), '123'])('valid %s', (s) => expect(validateSlug(s)).toEqual({ ok: true }));
  it.each(['ab', 'x'.repeat(33), 'Rina', '-abc', 'abc-', 'a--b', 'a_b', 'a b', 'é-é-é', '', 'a/b', '../x'])('invalid %s', (s) => expect(validateSlug(s)).toEqual({ ok: false, reason: 'SLUG_INVALID' }));
  it('reserved words and andum prefix', () => {
    for (const r of RESERVED_SLUGS.filter((x) => x.length >= 3)) expect(validateSlug(r)).toEqual({ ok: false, reason: 'SLUG_RESERVED' });
    expect(validateSlug('andum-fan')).toEqual({ ok: false, reason: 'SLUG_RESERVED' });
    expect(validateSlug('andumx')).toEqual({ ok: false, reason: 'SLUG_RESERVED' });
    expect(validateSlug('anduin')).toEqual({ ok: true });
  });
  it('normalizes typing input', () => {
    expect(normalizeSlugInput('Rina Audit_Bonus!!')).toBe('rinaauditbonus');
    expect(normalizeSlugInput('--a--b--')).toBe('a-b');
    expect(normalizeSlugInput('x'.repeat(50))).toHaveLength(32);
  });
  it('suggestion stays valid and within length', () => {
    expect(suggestSlug('rina')).toBe('rina-2');
    expect(validateSlug(suggestSlug('x'.repeat(32), 12))).toEqual({ ok: true });
    expect(suggestSlug('x'.repeat(32), 12)).toHaveLength(32);
  });
  it('masks emails', () => {
    expect(maskEmail('rina@example.com')).toBe('r***@example.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

describe('errors', () => {
  it('extracts contract codes from chain failure text', () => {
    expect(parseChainError('{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ANDUM_ERR:TIME_NOT_REACHED"}}}}')).toBe('TIME_NOT_REACHED');
    expect(parseChainError('ANDUM_ERR:NOT_A_CODE')).toBeNull();
    expect(parseChainError('Smart contract panicked: something else')).toBeNull();
    expect(parseChainError(undefined)).toBeNull();
    expect(parseChainError('')).toBeNull();
  });
  it('ApiError body shape', () => {
    expect(new ApiError(429, 'RATE_LIMITED', 'slow down', { retry: 5 }).toBody()).toEqual({ error: { code: 'RATE_LIMITED', message: 'slow down', details: { retry: 5 } } });
  });
});

describe('events', () => {
  const ev = (o: unknown) => 'EVENT_JSON:' + JSON.stringify(o);
  it('parses andum, bridge and nep171 events', () => {
    const e = parseEventLogs([
      ev({ standard: 'andum', version: '1.0.0', event: 'package_created', data: [{ package_id: '7' }] }),
      ev({ standard: 'nep171', version: '1.2.0', event: 'nft_mint', data: [{ owner_id: 'a', token_ids: ['7'] }] }),
      ev({ standard: 'andum-bridge', version: '1.0.0', event: 'bridge_out', data: [{ nonce: '1' }] }),
    ]);
    expect(e.map((x) => x.event)).toEqual(['package_created', 'nft_mint', 'bridge_out']);
    expect(packageIdsFromEvents(e)).toEqual(['7']);
  });
  it('ignores noise: foreign standards, malformed JSON, plain logs, bad shapes', () => {
    expect(parseEventLogs(['hello', 'EVENT_JSON:{', ev({ standard: 'evil', event: 'x', data: [{}] }), ev({ standard: 'andum', event: 5, data: [] }), ev({ standard: 'andum', event: 'x', data: 'no' }), ev({ standard: 'andum', event: 'x', data: [1, null, 'a'] })])).toEqual([]);
  });
  it('multiple data items get distinct log indexes and non numeric package ids are dropped', () => {
    const e = parseEventLogs([ev({ standard: 'andum', event: 'x', data: [{ package_id: '1' }, { package_id: 'abc' }, { package_id: '2' }] })]);
    expect(new Set(e.map((x) => x.logIndex)).size).toBe(3);
    expect(packageIdsFromEvents(e).sort()).toEqual(['1', '2']);
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 1);
  it('encrypt/decrypt round trip and tamper detection', () => {
    const c = encrypt(key, Buffer.from('secret'));
    expect(decrypt(key, c).toString()).toBe('secret');
    const bad = Buffer.from(c); bad[bad.length - 1] ^= 1;
    expect(() => decrypt(key, bad)).toThrow();
    expect(() => decrypt(Buffer.alloc(32, 2), c)).toThrow();
    expect(() => decrypt(key, Buffer.alloc(5))).toThrow();
    expect(() => encrypt(Buffer.alloc(16), Buffer.from('x'))).toThrow();
  });
  it('ciphertexts differ for the same plaintext (random iv)', () => {
    expect(encrypt(key, Buffer.from('a')).equals(encrypt(key, Buffer.from('a')))).toBe(false);
  });
  it('otp has 6 digits, preserves leading zeros, is bound to the invite', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(hashOtp('a', '123456').equals(hashOtp('b', '123456'))).toBe(false);
    expect(safeEqual(hashOtp('a', '1'), hashOtp('a', '1'))).toBe(true);
    expect(safeEqual(Buffer.from([1]), Buffer.from([1, 2]))).toBe(false);
  });
  it('random ids are url safe and unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
    for (const i of ids) expect(i).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(sha256('a')).toHaveLength(32);
  });
});

describe('copy and assets', () => {
  it('maps reason codes', () => {
    expect(reasonCopy('TIME_NOT_REACHED', { unlockDate: '12 Dec' })).toBe('Not yet: this part opens on 12 Dec.');
    expect(reasonCopy('APPROVAL_MISSING', { approvers: ['boss.near'] })).toBe('boss.near still has to approve this part.');
    expect(reasonCopy('APPROVAL_MISSING', { approvers: ['a', 'b', 'c'], approvals: ['a'], threshold: 3 })).toBe('2 more approvals needed.');
    expect(reasonCopy('APPROVAL_MISSING', { approvers: ['a', 'b'], approvals: ['a'], threshold: 2 })).toBe('1 more approval needed.');
    expect(reasonCopy('PACKAGE_NOT_ACTIVE')).toBe('Accept the package first.');
    expect(reasonCopy('TRANSFER_PENDING')).toBe('Already on its way.');
    expect(reasonCopy('ALREADY_TAKEN')).toBe('Already in your account.');
    expect(reasonCopy('NOT_PASS_OWNER')).toBe('This package belongs to another account.');
    expect(reasonCopy('???')).toMatch(/try again/);
  });
  it('asset registry', () => {
    expect(ASSETS).toHaveLength(12);
    expect(ASSETS.every((a) => a.decimals === 6)).toBe(true);
    expect(ASSETS.filter((a) => a.bridgeable)).toHaveLength(7);
    expect(getAsset('xau')?.bridgeable).toBe(false);
    expect(getAsset('nope')).toBeUndefined();
    expect(getAsset('usdc')?.faucet.perCall).toBe('10000000000');
    expect(nearTokenAccount('usdc', 'r.testnet')).toBe('usdc.r.testnet');
    expect(assetIdFromTokenAccount('usdc.r.testnet', 'r.testnet')).toBe('usdc');
    expect(assetIdFromTokenAccount('usdc.other.testnet', 'r.testnet')).toBeNull();
  });
});

describe('chain helpers', () => {
  it('outcomeFromRpc collects logs and finds failures', () => {
    const ok = outcomeFromRpc('h', { receipts_outcome: [{ outcome: { logs: ['a'], status: { SuccessValue: '' } } }, { outcome: { logs: ['b'], status: { SuccessValue: '' } } }] });
    expect(ok).toEqual({ txHash: 'h', success: true, failure: undefined, logs: ['a', 'b'] });
    const bad = outcomeFromRpc('h', { receipts_outcome: [{ outcome: { logs: [], status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: ANDUM_ERR:ALREADY_TAKEN' } } } } } } }] });
    expect(bad.success).toBe(false);
    expect(outcomeErrorCode(bad)).toBe('ALREADY_TAKEN');
    expect(outcomeFromRpc('h', { status: { Failure: 'x' }, receipts_outcome: [] }).success).toBe(false);
    expect(outcomeFromRpc('h', {}).success).toBe(true);
  });
  it('FakeChain records submissions, tracks nonces and balances, simulates transport failure', async () => {
    const c = new FakeChain();
    await c.transferNear('a.testnet', 5n);
    expect(await c.getBalanceYocto('a.testnet')).toBe(5n);
    expect(await c.getBalanceYocto('nobody')).toBe(0n);
    c.transportFailures = 1;
    await expect(c.getBlockHeight()).rejects.toThrow(/transport/);
    expect(await c.getBlockHeight()).toBe(1000n);
    c.setView('x', 'm', () => 42);
    expect(await c.viewFunction('x', 'm')).toBe(42);
    await expect(c.viewFunction('x', 'zzz')).rejects.toThrow();
  });
});

describe('config', () => {
  it('has safe defaults for local dev', () => {
    const e = loadEnv({});
    expect(e.PORT).toBe(8080);
    expect(e.USE_FAKE_CHAIN).toBe(false);
    expect(loadEnv({ USE_FAKE_CHAIN: 'true' }).USE_FAKE_CHAIN).toBe(true);
  });
  it('rejects invalid values', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Invalid environment/);
    expect(() => loadEnv({ SESSION_SECRET: 'x' })).toThrow();
  });
  it('converts NEAR to yocto', () => {
    expect(nearToYocto(0.02)).toBe(20_000_000_000_000_000_000_000n);
    expect(nearToYocto(1)).toBe(10n ** 24n);
  });
  it('capture mailer', async () => {
    const m = new CaptureMailer();
    await m.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(m.last('a@b.c')?.subject).toBe('s');
    m.failNext = 1;
    await expect(m.send({ to: 'x', subject: '', text: '' })).rejects.toThrow();
  });
});
