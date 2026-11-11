import type { LanePart } from './lanes'

export interface Way extends LanePart {
  t: string
  d: string
}

export const WAYS_AXIS = 30

export const WAYS: Way[] = [
  { a: 'USDC', amt: 200, rule: 'now', date: 1, gate: 0, t: 'Right away', d: "The part is the receiver's the moment they accept the package. Use it for an advance, a deposit or a welcome payment." },
  { a: 'GOLD', amt: 1.5, rule: 'date', date: 12, gate: 0, t: 'On a date', d: 'The part opens at the time you pick. Use it for a vesting step, a payday or a birthday.' },
  { a: 'USDC', amt: 800, rule: 'both', date: 20, gate: 25, who: 'Dewi', t: 'On a date and your approval', d: 'The part opens once the date has passed and someone you name has approved it. Use it for a milestone, a delivery or the end of a warranty period.' },
]

/** Which way is highlighted for a scroll position (0..1). */
export function waysIndex(p: number): 0 | 1 | 2 {
  return p < 0.3 ? 0 : p < 0.63 ? 1 : 2
}
