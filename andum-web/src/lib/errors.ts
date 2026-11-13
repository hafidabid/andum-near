import { ApiError } from './api'

/** Plain-language text for every error code the API and the contract can return. */
const TEXT: Record<string, string> = {
  // contract
  INVITE_SECRET_INVALID: 'That invite does not match this package.',
  ALREADY_TAKEN: 'This part was already taken. A part can only be taken once.',
  TIME_NOT_REACHED: 'This part is not open yet. It opens on its date.',
  APPROVAL_MISSING: 'This part is waiting for approval. Not enough approvers have said yes yet.',
  NOT_PASS_OWNER: 'Only the holder of the pass can take parts.',
  NOT_APPROVER: 'You are not an approver of this part.',
  ALREADY_APPROVED: 'You already approved this part.',
  PACKAGE_EXPIRED: 'This package was not accepted in time.',
  ALREADY_ACCEPTED: 'This package was already accepted.',
  // api
  OTP_INVALID: 'That code is not right.',
  OTP_EXPIRED: 'That code has expired. Ask for a new one.',
  OTP_LOCKED: 'Too many wrong codes. Ask for a new one.',
  INVITE_EXPIRED: 'This invite has expired. Ask the sender to send a new package.',
  INVITE_NOT_ATTACHED: 'This package is not ready yet. Try again in a minute.',
  LINK_LOCKED: 'This package was already accepted.',
  RATE_LIMITED: 'Too many tries. Wait a moment and try again.',
  UNAUTHENTICATED: 'Please sign in again.',
  NOT_FOUND: 'We could not find that.',
  FORBIDDEN: 'You do not have access to that.',
  RELAY_POLICY_DENIED: 'The network helper refused this action.',
  RELAY_EXPIRED: 'That took too long to sign. Try again.',
  UPSTREAM_UNAVAILABLE: 'The NEAR network is busy. Try again in a moment.',
  FAUCET_CAP: 'You reached the test-token limit for today.',
  BOOTSTRAP_LIMIT: 'Too many account top-ups today.',
  SLUG_TAKEN: 'That link name is taken.',
  SLUG_RESERVED: 'That link name is reserved.',
  VALIDATION_FAILED: 'Something in the form is not valid.',
  NETWORK: 'Cannot reach the Andum server. Check that it is running.',
}

export function errorText(e: unknown): string {
  if (e instanceof ChainError) return TEXT[e.code] ?? e.message
  if (e instanceof ApiError) {
    if (e.code === 'OTP_INVALID' && typeof e.details.attempts_left === 'number') return `That code is not right. ${e.details.attempts_left} tries left.`
    return TEXT[e.code] ?? e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong'
}

/** A transaction that the network ran and the contract refused (or the relayer policy refused before sending). */
export class ChainError extends Error {
  constructor(public readonly code: string, message: string, public readonly txHash?: string) {
    super(message)
    this.name = 'ChainError'
  }
}
