/** Contract error codes (ANDUM-PLAN 3.5) and API error codes (7.4). */
export const CONTRACT_ERROR_CODES = [
  'PAUSED','NOT_ADMIN','TOKEN_NOT_ALLOWED','INVALID_PARTS','INVALID_AMOUNT','INVALID_RULE','UNLOCK_IN_PAST','INVALID_EXPIRY',
  'NOTE_TOO_LONG','INVALID_THEME','INVALID_APPROVERS','RECEIVER_IS_APPROVER','LIMIT_EXCEEDED','PACKAGE_NOT_FOUND','PART_NOT_FOUND',
  'NOT_SENDER','NOT_APPROVER','NOT_PASS_OWNER','WRONG_TOKEN','WRONG_SENDER','BAD_MSG','PACKAGE_NOT_ACTIVE','ALREADY_ACCEPTED',
  'INVITE_EXPIRED','INVITE_SECRET_INVALID','NOT_INVITED_ACCOUNT','TIME_NOT_REACHED','APPROVAL_MISSING','ALREADY_TAKEN',
  'TRANSFER_PENDING','NOT_RECLAIMABLE','ALREADY_RECLAIMED','PASS_NOT_TRANSFERABLE','STORAGE_RESERVE_LOW',
  // token / bridge
  'FAUCET_CAP_PER_CALL','FAUCET_CAP_DAILY','NOT_MINTER','BRIDGE_NOT_RELAYER','BRIDGE_BAD_CHAIN','BRIDGE_ASSET_DISABLED','BRIDGE_BAD_ADDRESS',
] as const;
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

export const API_ERROR_CODES = [
  'UNAUTHENTICATED','FORBIDDEN','VALIDATION_FAILED','NOT_FOUND','RATE_LIMITED','IDEMPOTENCY_CONFLICT','RELAY_POLICY_DENIED',
  'RELAY_EXPIRED','RELAY_DUPLICATE','RELAY_CHAIN_FAILURE','INVITE_NOT_FOUND','SLUG_TAKEN','SLUG_INVALID','SLUG_RESERVED','LINK_LOCKED',
  'INVITE_EXPIRED','INVITE_NOT_ATTACHED','OTP_INVALID','OTP_EXPIRED','OTP_LOCKED','FAUCET_CAP','BOOTSTRAP_LIMIT','UPSTREAM_UNAVAILABLE','KEY_REQUIRED',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Extract `ANDUM_ERR:<CODE>` from any chain failure text. Returns null when absent or unknown. */
export function parseChainError(text: string | undefined | null): ContractErrorCode | null {
  if (!text) return null;
  const m = /ANDUM_ERR:([A-Z_]+)/.exec(text);
  if (!m) return null;
  return (CONTRACT_ERROR_CODES as readonly string[]).includes(m[1]) ? (m[1] as ContractErrorCode) : null;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
  toBody() { return { error: { code: this.code, message: this.message, details: this.details } }; }
}
