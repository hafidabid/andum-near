/**
 * Relayer policy engine (ANDUM-PLAN 7.5). Pure: decide(delegate, state, config) -> allow | deny(rule).
 * Used by the API (fast 4xx) and re-run by the relayer worker before submission.
 */
import { DecodedDelegate, FunctionCallAction, verifyDelegateSignature } from './near-tx';

export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11';
export type Decision = { allow: true } | { allow: false; rule: Rule; message: string };

export interface PolicyConfig {
  core: string;
  bridge: string;
  /** NEAR account ids of mock tokens */
  tokens: string[];
  maxHeightWindow: number; // 200
  perMinute: number; // 30
  perDay: number; // 600
  mintsPerMinute: number; // 3
}
export interface PolicyState {
  sessionAccountId: string;
  currentBlockHeight: bigint;
  /** current nonce of the signer key on chain, null when the account does not have that key */
  keyNonce: bigint | null;
  /** the public key registered for this user (fallback when the chain key lookup is unavailable) */
  registeredPublicKey: string | null;
  submissionsLastMinute: number;
  submissionsToday: number;
  mintsLastMinute: number;
  dailyBudgetExceeded: boolean;
  payloadAlreadySeen: boolean;
  relayerPaused: boolean;
}

export const TGAS = 10n ** 12n;
export const CORE_METHODS: Record<string, bigint> = {
  create_package: 30n * TGAS, accept_package: 150n * TGAS, approve_part: 30n * TGAS, claim: 120n * TGAS, reclaim_unaccepted: 150n * TGAS,
};
export const TOKEN_METHODS: Record<string, bigint> = { ft_mint: 30n * TGAS, ft_transfer_call: 80n * TGAS, ft_transfer: 30n * TGAS, storage_deposit: 30n * TGAS };
/** NEP-145 minimum to register one account with a token, paid by the sender from their own NEAR. */
export const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
/** A NEAR account id: named (a.b.testnet) or implicit (64 hex). */
export const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isNearAccountId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 64 && NEAR_ACCOUNT_ID.test(v);

const DIGITS = /^\d+$/;
const deny = (rule: Rule, message: string): Decision => ({ allow: false, rule, message });

function parseArgs(a: FunctionCallAction): Record<string, unknown> | null {
  try {
    const v = JSON.parse(a.args.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function checkArgs(d: DecodedDelegate, a: FunctionCallAction, cfg: PolicyConfig): string | null {
  const args = parseArgs(a);
  if (!args) return 'arguments are not a JSON object';
  const isCore = d.receiverId === cfg.core;
  if (isCore) {
    switch (a.methodName) {
      case 'create_package': {
        const inner = args['args'] as Record<string, unknown> | undefined;
        if (!inner || typeof inner !== 'object' || !Array.isArray(inner['parts'])) return 'create_package needs args.parts';
        return null;
      }
      case 'accept_package': case 'reclaim_unaccepted':
        return typeof args['package_id'] === 'string' && DIGITS.test(args['package_id'] as string) ? null : 'package_id must be a decimal string';
      case 'approve_part': case 'claim': {
        if (typeof args['package_id'] !== 'string' || !DIGITS.test(args['package_id'] as string)) return 'package_id must be a decimal string';
        const p = args['part_id'];
        return Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 7 ? null : 'part_id must be an integer 0..7';
      }
    }
    return 'unknown core method';
  }
  // token methods
  if (a.methodName === 'ft_mint') {
    if (args['account_id'] !== d.senderId) return 'ft_mint account_id must equal the sender';
    return typeof args['amount'] === 'string' && DIGITS.test(args['amount'] as string) ? null : 'amount must be a decimal string';
  }
  if (a.methodName === 'ft_transfer_call') {
    const rcv = args['receiver_id'];
    if (rcv !== cfg.core && rcv !== cfg.bridge) return 'receiver_id must be core or bridge';
    if (typeof args['amount'] !== 'string' || !DIGITS.test(args['amount'] as string) || BigInt(args['amount'] as string) === 0n) return 'amount must be a positive decimal string';
    if (typeof args['msg'] !== 'string') return 'msg must be a string';
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(args['msg'] as string); } catch { return 'msg must be JSON'; }
    if (!msg || typeof msg !== 'object') return 'msg must be a JSON object';
    if (rcv === cfg.core) {
      if (typeof msg['package_id'] !== 'string' || !DIGITS.test(msg['package_id'] as string) || !Number.isInteger(msg['part_id'])) return 'funding msg needs package_id (string) and part_id (integer)';
    } else if (typeof msg['dest_chain'] !== 'string' || typeof msg['dest_address'] !== 'string') return 'bridge msg needs dest_chain and dest_address';
    return null;
  }
  if (a.methodName === 'ft_transfer') {
    // a withdrawal to another wallet. Never to Andum's own contracts or a token contract (those would swallow the tokens), never to yourself.
    if (Object.keys(args).some((k) => !['receiver_id', 'amount', 'memo'].includes(k))) return 'ft_transfer takes receiver_id, amount and an optional memo';
    const rcv = args['receiver_id'];
    if (!isNearAccountId(rcv)) return 'receiver_id must be a NEAR account id';
    if (rcv === d.senderId) return 'receiver_id must not be the sender';
    if (rcv === cfg.core || rcv === cfg.bridge || cfg.tokens.includes(rcv)) return 'receiver_id must not be an Andum contract';
    if (typeof args['amount'] !== 'string' || !DIGITS.test(args['amount'] as string) || BigInt(args['amount'] as string) === 0n) return 'amount must be a positive decimal string';
    if (args['memo'] !== undefined && (typeof args['memo'] !== 'string' || (args['memo'] as string).length > 100)) return 'memo must be text of 100 characters or fewer';
    return null;
  }
  if (a.methodName === 'storage_deposit') {
    // registering a receiving address with this token, nothing else
    if (Object.keys(args).some((k) => !['account_id', 'registration_only'].includes(k))) return 'storage_deposit takes account_id and registration_only';
    if (!isNearAccountId(args['account_id'])) return 'account_id must be a NEAR account id';
    if (args['registration_only'] !== true) return 'registration_only must be true';
    return null;
  }
  return 'unknown token method';
}

export function decide(d: DecodedDelegate, s: PolicyState, cfg: PolicyConfig): Decision {
  // R11 first: kill switch beats everything
  if (s.relayerPaused) return deny('R11', 'relayer is paused');
  // R1 identity
  if (d.senderId !== s.sessionAccountId) return deny('R1', 'delegate sender does not match the session account');
  // R5 shape (checked early so later rules can assume one FunctionCall)
  if (d.actions.length !== 1 || d.actions[0].type !== 'FunctionCall') return deny('R5', 'exactly one FunctionCall action is required');
  const a = d.actions[0] as FunctionCallAction;
  // R2 signature and key
  if (!verifyDelegateSignature(d)) return deny('R2', 'signature does not verify');
  if (s.keyNonce === null && s.registeredPublicKey !== d.publicKey) return deny('R2', 'public key is not a key of the account');
  // R3 expiry
  if (d.maxBlockHeight <= s.currentBlockHeight) return deny('R3', 'delegate action has expired');
  if (d.maxBlockHeight > s.currentBlockHeight + BigInt(cfg.maxHeightWindow)) return deny('R3', 'max_block_height is too far in the future');
  // R4 nonce
  if (s.keyNonce !== null && d.nonce <= s.keyNonce) return deny('R4', 'nonce is not greater than the key nonce');
  // R5 receiver and method
  const isCore = d.receiverId === cfg.core;
  const isToken = cfg.tokens.includes(d.receiverId);
  const gasCap = isCore ? CORE_METHODS[a.methodName] : isToken ? TOKEN_METHODS[a.methodName] : undefined;
  if (!isCore && !isToken) return deny('R5', 'receiver is not allowlisted');
  if (gasCap === undefined) return deny('R5', 'method is not allowlisted for this receiver');
  // R6 deposit
  const wantDeposit = isToken ? (a.methodName === 'ft_transfer_call' || a.methodName === 'ft_transfer' ? 1n : a.methodName === 'storage_deposit' ? STORAGE_DEPOSIT_YOCTO : 0n) : 0n;
  if (a.deposit !== wantDeposit) return deny('R6', `deposit must be ${wantDeposit} yoctoNEAR`);
  // R7 gas
  if (a.gas > gasCap) return deny('R7', 'attached gas exceeds the cap for this method');
  if (a.gas === 0n) return deny('R7', 'attached gas must be positive');
  // R8 arguments
  const bad = checkArgs(d, a, cfg);
  if (bad) return deny('R8', bad);
  // R9 quota
  if (s.dailyBudgetExceeded) return deny('R9', 'relayer daily budget is used up');
  if (s.submissionsLastMinute >= cfg.perMinute) return deny('R9', 'too many submissions this minute');
  if (s.submissionsToday >= cfg.perDay) return deny('R9', 'too many submissions today');
  if (a.methodName === 'ft_mint' && s.mintsLastMinute >= cfg.mintsPerMinute) return deny('R9', 'too many faucet mints this minute');
  // R10 duplicate
  if (s.payloadAlreadySeen) return deny('R10', 'this exact payload was already submitted');
  return { allow: true };
}
