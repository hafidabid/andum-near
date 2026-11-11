import type { AssetId } from './assets'
import type { LanePart } from './lanes'

export interface Scenario {
  n: string
  d: string
  who: string
  title: string
  story: string
  parts: LanePart[]
}

type P = { a: AssetId; amt: number; rule: LanePart['rule']; date: number; gate?: number; who?: string }
const part = (p: P): LanePart => ({ gate: 0, ...p })

export const SCENARIOS: Scenario[] = [
  {
    n: 'Gift',
    d: 'A birthday now, graduation later.',
    who: "Aina's parents to Aina",
    title: 'RM 5,000 in two parts',
    story:
      "Aina's parents want to give her RM 5,000. RM 500 arrives on her birthday. The other RM 4,500 opens once her guardian confirms she has graduated.",
    parts: [part({ a: 'MYR', amt: 500, rule: 'date', date: 7 }), part({ a: 'MYR', amt: 4500, rule: 'both', date: 30, gate: 38, who: 'Guardian' })],
  },
  {
    n: 'Freelance work',
    d: 'A deposit, then the rest on delivery.',
    who: 'Studio Kala to Bima',
    title: 'A logo job paid in three steps',
    story:
      'Studio Kala hires Bima for a brand. 30% opens when he accepts. 70% opens after the final files are delivered and the studio approves.',
    parts: [part({ a: 'USDC', amt: 900, rule: 'now', date: 1 }), part({ a: 'USDC', amt: 2100, rule: 'both', date: 14, gate: 19, who: 'Studio Kala' })],
  },
  {
    n: 'Project',
    d: 'Milestones for a home renovation.',
    who: 'Ibu Sari to Hartono Builders',
    title: 'A renovation in three stages',
    story:
      'Ibu Sari pays for a renovation in rupiah. The first part opens at the start. The next two open as the builder reaches each milestone and she approves.',
    parts: [
      part({ a: 'IDRX', amt: 30000000, rule: 'now', date: 1 }),
      part({ a: 'IDRX', amt: 40000000, rule: 'both', date: 21, gate: 26, who: 'Ibu Sari' }),
      part({ a: 'IDRX', amt: 30000000, rule: 'both', date: 50, gate: 55, who: 'Ibu Sari' }),
    ],
  },
  {
    n: 'Company bonus',
    d: 'Cash on payday, shares at vesting.',
    who: 'Acme to Bayu',
    title: 'A bonus that vests',
    story: 'Acme gives Bayu a bonus. The cash part arrives on payday. The 10 tokenized Apple shares open on the vesting date.',
    parts: [part({ a: 'IDRX', amt: 12000000, rule: 'date', date: 21 }), part({ a: 'AAPL', amt: 10, rule: 'date', date: 52 })],
  },
  {
    n: 'Team grants',
    d: 'Each stage signed off by a treasury.',
    who: 'Acme DAO to Nusa Labs',
    title: 'Three stages, three approvals',
    story: 'A DAO funds a team in stages. Each stage opens after its date and once the treasury signs it off.',
    parts: [
      part({ a: 'USDC', amt: 5000, rule: 'both', date: 8, gate: 11, who: 'Treasury' }),
      part({ a: 'USDC', amt: 5000, rule: 'both', date: 26, gate: 31, who: 'Treasury' }),
      part({ a: 'USDC', amt: 5000, rule: 'both', date: 48, gate: 50, who: 'Treasury' }),
    ],
  },
]

export const USES_AXIS = 60

/** Which scenario and which day a scroll position (0..1) shows. */
export function usesAt(progress: number, count = SCENARIOS.length): { index: number; day: number } {
  const seg = Math.max(0, Math.min(1, progress)) * count
  const index = Math.min(count - 1, Math.floor(seg))
  const q = seg - index
  const day = Math.max(0, Math.min(1, (q - 0.1) / 0.78)) * USES_AXIS
  return { index, day }
}
