import { dlab } from './format'
import type { AssetId } from './assets'

export type Rule = 'now' | 'date' | 'both'

/** One part of a package as the lane widgets draw it. Days are offsets from 10 Nov 2026. */
export interface LanePart {
  a: AssetId
  amt: number
  rule: Rule
  /** Day the part opens by date (ignored for "now"). */
  date: number
  /** Day the approver approves (only for "both"). */
  gate: number
  who?: string
}

export interface LaneStatus {
  open: boolean
  label: 'Open' | 'Waiting for date' | 'Waiting for approval' | 'Waiting for date and approval'
}

/** The day a part opens: right away, the date, or the later of date and approval. */
export function lOpen(p: LanePart): number {
  if (p.rule === 'now') return 0
  if (p.rule === 'date') return p.date
  return Math.max(p.date, p.gate)
}

export function lCond(p: LanePart): string {
  if (p.rule === 'now') return 'Opens when accepted'
  return `Opens ${dlab(p.date)}${p.rule === 'both' ? ', after approval' : ''}`
}

export function laneStatus(p: LanePart, day: number): LaneStatus {
  if (day >= lOpen(p) - 0.001) return { open: true, label: 'Open' }
  if (p.rule === 'both') {
    const dOk = day >= p.date
    const aOk = day >= p.gate
    if (dOk && !aOk) return { open: false, label: 'Waiting for approval' }
    if (aOk && !dOk) return { open: false, label: 'Waiting for date' }
    return { open: false, label: 'Waiting for date and approval' }
  }
  return { open: false, label: 'Waiting for date' }
}

/** Sum of the amounts that are open on `day`, per asset. */
export function openTotals(parts: LanePart[], day: number): Partial<Record<AssetId, number>> {
  const t: Partial<Record<AssetId, number>> = {}
  for (const p of parts) {
    if (laneStatus(p, day).open) t[p.a] = (t[p.a] ?? 0) + (Number(p.amt) || 0)
  }
  return t
}

export interface Segment {
  t: string
  b?: boolean
}

/** The sentence under a composer lane as text pieces; `b` pieces are shown bold. */
export function agreementParts(p: LanePart, moneyText: string, receiver = 'Rina'): Segment[] {
  if (p.rule === 'now') return [{ t: `${receiver} can take ` }, { t: moneyText, b: true }, { t: ' as soon as she accepts.' }]
  if (p.rule === 'date') return [{ t: moneyText, b: true }, { t: ' can be taken from ' }, { t: dlab(p.date), b: true }, { t: '.' }]
  return [
    { t: moneyText, b: true },
    { t: ' can be taken from ' },
    { t: dlab(p.date), b: true },
    { t: ', after ' },
    { t: p.who || 'the approver', b: true },
    { t: ' approves.' },
  ]
}

export function agreementSentence(p: LanePart, moneyText: string, receiver = 'Rina'): string {
  return agreementParts(p, moneyText, receiver).map((s) => s.t).join('')
}
