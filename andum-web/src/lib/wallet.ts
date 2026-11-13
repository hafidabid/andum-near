import '@/polyfills'
import { ed25519 } from '@noble/curves/ed25519'
import { keypairFromSecret, signDelegate } from '@shared/near-tx'
import { apiClient, ApiError, type RelayStatus } from './api'
import { accessKeyNonce, blockHeight, TGAS } from './chain'
import { ChainError } from './errors'

/**
 * Non-custodial keys. The browser makes the NEAR key and keeps it; the server only ever sees the public key and signatures.
 * One key per email address, so one browser can hold a sender and a recipient at the same time.
 */
const keyName = (email: string) => `andum.key.${email.trim().toLowerCase()}`

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))

export interface Key { sk: Uint8Array; publicKey: string; accountId: string }

export function keyFrom(sk: Uint8Array): Key {
  const kp = keypairFromSecret(sk)
  return { sk, publicKey: kp.publicKey, accountId: kp.accountId }
}

export function loadKey(email: string): Key | null {
  try {
    const h = localStorage.getItem(keyName(email))
    return h && /^[0-9a-f]{64}$/.test(h) ? keyFrom(fromHex(h)) : null
  } catch { return null }
}

export function saveKey(email: string, k: Key): void {
  try { localStorage.setItem(keyName(email), toHex(k.sk)) } catch { /* private mode: the key lives for this tab only */ }
}

export function newKey(): Key {
  return keyFrom(crypto.getRandomValues(new Uint8Array(32)))
}

/** Prove we hold the key (signature over a fresh server nonce) so the server can bind it to the signed-in email. */
export async function bindKey(k: Key) {
  const { nonce } = await apiClient.nonce()
  const signature = btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(`andum-bind:${nonce}:${k.accountId}`), k.sk)))
  return apiClient.bindKey({ public_key: k.publicKey, signature, nonce })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join('')

export interface Call { receiver: string; method: string; args: unknown; deposit?: bigint; gas?: bigint; purpose?: string }

/**
 * Sign one contract call as a NEP-366 delegate action, hand it to the relayer (which pays the gas) and wait for the chain.
 * Resolves with the final status when it succeeded; throws ApiError if the relayer refused it, ChainError if the contract did.
 */
export async function signAndRelay(k: Key, c: Call, onStatus?: (s: string) => void): Promise<RelayStatus> {
  const [nonce, height] = await Promise.all([accessKeyNonce(k.accountId, k.publicKey), blockHeight()])
  const b64 = signDelegate({
    senderId: k.accountId, receiverId: c.receiver,
    actions: [{ type: 'FunctionCall', methodName: c.method, args: Buffer.from(JSON.stringify(c.args)), gas: c.gas ?? 100n * TGAS, deposit: c.deposit ?? 0n }],
    nonce: nonce + 1n, maxBlockHeight: height + 120n, publicKey: k.publicKey,
  }, k.sk)
  const sub = await apiClient.relaySubmit(b64, rid(), c.purpose)
  onStatus?.('QUEUED')
  for (let i = 0; i < 80; i++) {
    const s = await apiClient.relayStatus(sub.relay_id)
    if (s.status === 'SUCCEEDED') return s
    if (s.status === 'FAILED' || s.status === 'REFUSED') throw new ChainError(s.error_code ?? 'RELAY_CHAIN_FAILURE', s.error_message ?? 'The transaction failed', s.tx_hash)
    onStatus?.(s.status)
    await sleep(1500)
  }
  throw new ApiError(0, 'NETWORK', 'The network is slow. Check again in a minute.')
}
