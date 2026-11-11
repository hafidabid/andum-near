export type ChainId = 'eth' | 'sol' | 'base' | 'bsc' | 'arb' | 'btc'
export type XMode = 'in' | 'out'

export interface Chain {
  id: ChainId
  n: string
  c: string
  t: string
}

export const CHAINS: Chain[] = [
  { id: 'eth', n: 'Ethereum', c: '#8FA4F0', t: 'ETH' },
  { id: 'sol', n: 'Solana', c: '#7BE7B7', t: 'SOL' },
  { id: 'base', n: 'Base', c: '#6E9BFF', t: 'BASE' },
  { id: 'bsc', n: 'BNB Chain', c: '#F3C85A', t: 'BNB' },
  { id: 'arb', n: 'Arbitrum', c: '#6BC0F2', t: 'ARB' },
  { id: 'btc', n: 'Bitcoin', c: '#F7A04A', t: 'BTC' },
]

export function xSteps(mode: XMode, chain: Chain): [string, string, string] {
  return mode === 'in'
    ? [`Deposit 1,000 USDC on ${chain.n}`, 'NEAR Intents converts and bridges', 'The package is funded on NEAR']
    : ['Rina takes Part 2', 'NEAR Intents converts and bridges', `800 USDC arrives on ${chain.n}`]
}

export function xNote(mode: XMode): string {
  return mode === 'in'
    ? 'Moves stablecoins such as USDC and USDT between the chains NEAR Intents supports.'
    : 'Part of the money can stay on NEAR. Send only what you want to move.'
}

export const X_AMOUNT: Record<XMode, number> = { in: 1000, out: 800 }

/** Milliseconds at which each phase (1..5) of the route animation starts. */
export const X_PHASE_AT = [80, 700, 1800, 2300, 3400] as const
