import { AS, ASSET_IDS, type AssetId } from './assets'

export const DECIMALS = 6
const ONE = 10n ** BigInt(DECIMALS)

/** "1,234.5" -> "1234500000". Returns null for anything that is not a positive amount with at most 6 decimals. */
export function toBase(input: string): string | null {
  const s = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null
  const [w, f = ''] = s.split('.')
  const v = BigInt(w) * ONE + BigInt(f.padEnd(DECIMALS, '0'))
  return v > 0n ? v.toString() : null
}

/** "1234500000" -> "1,234.5" */
export function fromBase(base: string, maxDp = 2): string {
  const v = BigInt(base)
  const w = v / ONE
  const f = (v % ONE).toString().padStart(DECIMALS, '0').slice(0, maxDp).replace(/0+$/, '')
  return w.toLocaleString('en-US') + (f ? '.' + f : '')
}

/** Token account `usdc.hafidbuild.testnet` -> AssetId 'USDC' (and `xau` -> 'GOLD'). */
export function assetOf(tokenAccount: string): AssetId {
  const id = tokenAccount.split('.')[0].toUpperCase()
  const a = id === 'XAU' ? 'GOLD' : id
  return (ASSET_IDS as string[]).includes(a) ? (a as AssetId) : 'USDC'
}

/** AssetId 'GOLD' -> faucet/contract id 'xau'. */
export const assetKey = (a: AssetId): string => (a === 'GOLD' ? 'xau' : a.toLowerCase())

export const unitOf = (tokenAccount: string): string => AS[assetOf(tokenAccount)].u

export const maskAccount = (a: string): string => (a.length > 22 && !a.includes('.') ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)
