import { describe, expect, it } from 'vitest';
import { decide, PolicyConfig, PolicyState } from './policy';
import { DelegateActionInput, decodeSignedDelegate, keypairFromSecret, signDelegate, DecodedDelegate } from './near-tx';
import { BorshWriter } from './borsh';

const sk = new Uint8Array(32).fill(9);
const kp = keypairFromSecret(sk);
const cfg: PolicyConfig = { core: 'core.r.testnet', bridge: 'bridge.r.testnet', tokens: ['usdc.r.testnet', 'xau.r.testnet'], maxHeightWindow: 200, perMinute: 30, perDay: 600, mintsPerMinute: 3 };
const state = (o: Partial<PolicyState> = {}): PolicyState => ({
  sessionAccountId: kp.accountId, currentBlockHeight: 1000n, keyNonce: 4n, registeredPublicKey: kp.publicKey, submissionsLastMinute: 0, submissionsToday: 0,
  mintsLastMinute: 0, dailyBudgetExceeded: false, payloadAlreadySeen: false, relayerPaused: false, ...o,
});
const T = 10n ** 12n;
function mk(o: { receiver?: string; method?: string; args?: unknown; gas?: bigint; deposit?: bigint; nonce?: bigint; height?: bigint; sender?: string; key?: Uint8Array } = {}): DecodedDelegate {
  const a: DelegateActionInput = {
    senderId: o.sender ?? kp.accountId, receiverId: o.receiver ?? cfg.core,
    actions: [{ type: 'FunctionCall', methodName: o.method ?? 'claim', args: Buffer.from(JSON.stringify(o.args ?? { package_id: '1', part_id: 0 })), gas: o.gas ?? 100n * T, deposit: o.deposit ?? 0n }],
    nonce: o.nonce ?? 5n, maxBlockHeight: o.height ?? 1100n, publicKey: kp.publicKey,
  };
  return decodeSignedDelegate(signDelegate(a, o.key ?? sk));
}
const denied = (d: DecodedDelegate, s: PolicyState, rule: string) => { const r = decide(d, s, cfg); expect(r.allow).toBe(false); expect((r as any).rule).toBe(rule); };
const funding = (receiver = cfg.core, msg: unknown = { package_id: '1', part_id: 0 }) => mk({ receiver: 'usdc.r.testnet', method: 'ft_transfer_call', deposit: 1n, gas: 80n * T, args: { receiver_id: receiver, amount: '100', msg: JSON.stringify(msg) } });

describe('relayer policy: allowed calls', () => {
  it('claim / approve / accept / reclaim / create', () => {
    expect(decide(mk(), state(), cfg).allow).toBe(true);
    expect(decide(mk({ method: 'approve_part', gas: 30n * T }), state(), cfg).allow).toBe(true);
    expect(decide(mk({ method: 'accept_package', args: { package_id: '9', invite_secret: 'abc' }, gas: 150n * T }), state(), cfg).allow).toBe(true);
    expect(decide(mk({ method: 'reclaim_unaccepted', args: { package_id: '9' }, gas: 150n * T }), state(), cfg).allow).toBe(true);
    expect(decide(mk({ method: 'create_package', args: { args: { parts: [] } }, gas: 30n * T }), state(), cfg).allow).toBe(true);
  });
  it('funding into core and outbound bridge', () => {
    expect(decide(funding(), state(), cfg).allow).toBe(true);
    expect(decide(funding(cfg.bridge, { dest_chain: 'sepolia', dest_address: '0xabc' }), state(), cfg).allow).toBe(true);
  });
  it('faucet mint for self', () => {
    expect(decide(mk({ receiver: 'usdc.r.testnet', method: 'ft_mint', gas: 30n * T, args: { account_id: kp.accountId, amount: '5' } }), state(), cfg).allow).toBe(true);
  });
  it('exact boundary values pass: gas cap, height window, nonce key+1', () => {
    expect(decide(mk({ gas: 120n * T }), state(), cfg).allow).toBe(true);
    expect(decide(mk({ height: 1200n }), state(), cfg).allow).toBe(true);
    expect(decide(mk({ nonce: 5n }), state({ keyNonce: 4n }), cfg).allow).toBe(true);
  });
  it('unknown key on chain is ok when it equals the registered key', () => {
    expect(decide(mk(), state({ keyNonce: null }), cfg).allow).toBe(true);
  });
});

describe('relayer policy: denials', () => {
  it('R1 identity', () => denied(mk(), state({ sessionAccountId: 'someone-else' }), 'R1'));
  it('R2 bad signature', () => {
    const d = mk(); d.signature = Buffer.alloc(64, 1); denied(d, state(), 'R2');
  });
  it('R2 key not on account and not registered', () => denied(mk(), state({ keyNonce: null, registeredPublicKey: 'ed25519:other' }), 'R2'));
  it('R2 signed by a different key than declared', () => denied(mk({ key: new Uint8Array(32).fill(1) }), state(), 'R2'));
  it('R3 expired and too far', () => {
    denied(mk({ height: 1000n }), state(), 'R3');
    denied(mk({ height: 900n }), state(), 'R3');
    denied(mk({ height: 1201n }), state(), 'R3');
  });
  it('R4 stale nonce', () => {
    denied(mk({ nonce: 4n }), state({ keyNonce: 4n }), 'R4');
    denied(mk({ nonce: 1n }), state({ keyNonce: 4n }), 'R4');
  });
  it('R5 receiver/method/action shape', () => {
    denied(mk({ receiver: 'evil.testnet' }), state(), 'R5');
    denied(mk({ method: 'new' }), state(), 'R5');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_burn_privileged' }), state(), 'R5');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'claim' }), state(), 'R5');
    denied(mk({ receiver: cfg.core, method: 'ft_mint' }), state(), 'R5');
    denied(mk({ receiver: cfg.bridge, method: 'bridge_in' }), state(), 'R5');
    const transfer = decodeSignedDelegate(new BorshWriter().string(kp.accountId).string('x').u32(1).u8(3).u128(1).toBuffer().toString('base64'));
    denied(transfer, state(), 'R5');
    const two = mk(); two.actions.push(two.actions[0]); denied(two, state(), 'R5');
    const none = mk(); none.actions = []; denied(none, state(), 'R5');
  });
  it('R6 deposit', () => {
    denied(mk({ deposit: 1n }), state(), 'R6');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_mint', gas: 30n * T, deposit: 1n, args: { account_id: kp.accountId, amount: '1' } }), state(), 'R6');
    const f = mk({ receiver: 'usdc.r.testnet', method: 'ft_transfer_call', deposit: 0n, gas: 80n * T, args: { receiver_id: cfg.core, amount: '1', msg: '{"package_id":"1","part_id":0}' } });
    denied(f, state(), 'R6');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_transfer_call', deposit: 2n, gas: 80n * T, args: { receiver_id: cfg.core, amount: '1', msg: '{}' } }), state(), 'R6');
  });
  it('R7 gas', () => {
    denied(mk({ gas: 121n * T }), state(), 'R7');
    denied(mk({ gas: 0n }), state(), 'R7');
    denied(mk({ method: 'approve_part', gas: 31n * T }), state(), 'R7');
  });
  it('R8 arguments', () => {
    denied(mk({ args: { package_id: 1, part_id: 0 } }), state(), 'R8'); // number not string
    denied(mk({ args: { package_id: '1a', part_id: 0 } }), state(), 'R8');
    denied(mk({ args: { package_id: '1', part_id: 8 } }), state(), 'R8');
    denied(mk({ args: { package_id: '1', part_id: -1 } }), state(), 'R8');
    denied(mk({ args: { package_id: '1', part_id: 1.5 } }), state(), 'R8');
    denied(mk({ args: [1] }), state(), 'R8');
    denied(mk({ method: 'accept_package', args: { package_id: '' }, gas: 150n * T }), state(), 'R8');
    denied(mk({ method: 'create_package', args: { parts: [] }, gas: 30n * T }), state(), 'R8');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_mint', gas: 30n * T, args: { account_id: 'victim.testnet', amount: '5' } }), state(), 'R8');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_mint', gas: 30n * T, args: { account_id: kp.accountId, amount: '-5' } }), state(), 'R8');
    denied(funding('attacker.testnet'), state(), 'R8');
    denied(funding(cfg.core, { package_id: 1, part_id: 0 }), state(), 'R8');
    denied(funding(cfg.bridge, { dest_chain: 'sepolia' }), state(), 'R8');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_transfer_call', deposit: 1n, gas: 80n * T, args: { receiver_id: cfg.core, amount: '0', msg: '{"package_id":"1","part_id":0}' } }), state(), 'R8');
    denied(mk({ receiver: 'usdc.r.testnet', method: 'ft_transfer_call', deposit: 1n, gas: 80n * T, args: { receiver_id: cfg.core, amount: '5', msg: 'not json' } }), state(), 'R8');
  });
  it('args that are not JSON', () => {
    const d = mk(); (d.actions[0] as any).args = Buffer.from('{{{'); denied(d, state(), 'R8');
  });
  it('R9 quota', () => {
    denied(mk(), state({ submissionsLastMinute: 30 }), 'R9');
    expect(decide(mk(), state({ submissionsLastMinute: 29 }), cfg).allow).toBe(true);
    denied(mk(), state({ submissionsToday: 600 }), 'R9');
    denied(mk(), state({ dailyBudgetExceeded: true }), 'R9');
    const mint = mk({ receiver: 'usdc.r.testnet', method: 'ft_mint', gas: 30n * T, args: { account_id: kp.accountId, amount: '5' } });
    denied(mint, state({ mintsLastMinute: 3 }), 'R9');
    expect(decide(mk(), state({ mintsLastMinute: 3 }), cfg).allow).toBe(true); // mint quota only affects ft_mint
  });
  it('R10 duplicate', () => denied(mk(), state({ payloadAlreadySeen: true }), 'R10'));
  it('R11 kill switch wins over everything', () => {
    denied(mk(), state({ relayerPaused: true }), 'R11');
    denied(mk({ receiver: 'evil' }), state({ relayerPaused: true }), 'R11');
  });
  it('is deterministic and pure', () => {
    const d = mk(); const s = state();
    const snapshot = JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(decide(d, s, cfg)).toEqual(decide(d, s, cfg));
    expect(JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
  });
});
