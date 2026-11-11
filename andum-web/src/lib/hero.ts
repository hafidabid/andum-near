import { dlab } from './format'
import type { AssetId } from './assets'
import type { Rule } from './lanes'

export interface HeroPart {
  a: AssetId
  amt: number
  rule: Rule
  at: number
  gate: number
}

export const HERO_MAX = 22

export const HERO_PARTS: HeroPart[] = [
  { a: 'USDC', amt: 200, rule: 'now', at: 0, gate: 0 },
  { a: 'USDC', amt: 800, rule: 'both', at: 5, gate: 8 },
  { a: 'GOLD', amt: 1.5, rule: 'date', at: 20, gate: 0 },
]

export const HERO_EVENTS = [
  { d: 0, t: 'Rina accepts the package. Part 1 opens right away.' },
  { d: 5, t: "15 Nov. The date for Part 2 arrives, but it still needs Dewi's approval." },
  { d: 8, t: '18 Nov. Dewi approves, so Part 2 opens.' },
  { d: 20, t: '30 Nov. The date for Part 3 arrives and it opens on its own.' },
]

export const HERO_MARKERS = [
  { at: 5, label: '15 Nov', gate: false, below: false },
  { at: 8, label: 'Dewi approves', gate: true, below: true },
  { at: 20, label: '30 Nov', gate: false, below: false },
]

export interface HeroStat {
  open: boolean
  label: string
  tone: 'open' | 'wait'
  why: string
}

export function heroOpenAt(p: HeroPart): number {
  if (p.rule === 'now') return 0
  if (p.rule === 'date') return p.at
  return Math.max(p.at, p.gate)
}

export function heroStat(p: HeroPart, d: number): HeroStat {
  if (p.rule === 'now') return { open: true, label: 'Open', tone: 'open', why: 'Opened when Rina accepted' }
  const dOk = d >= p.at
  const aOk = p.rule !== 'both' || d >= p.gate
  if (dOk && aOk) {
    return { open: true, label: 'Open', tone: 'open', why: p.rule === 'date' ? 'The date has passed' : 'Approved by Dewi' }
  }
  if (p.rule === 'date') return { open: false, label: 'Waiting for date', tone: 'wait', why: `Opens ${dlab(p.at)}` }
  if (dOk) {
    return { open: false, label: 'Waiting for approval', tone: 'wait', why: 'The date has passed. Waiting for Dewi to approve.' }
  }
  return { open: false, label: 'Waiting for date and approval', tone: 'wait', why: `Opens ${dlab(p.at)}, after Dewi approves` }
}

/** Index of the last caption whose day has been reached. */
export function heroEventIndex(d: number): number {
  let ei = 0
  HERO_EVENTS.forEach((e, i) => {
    if (d >= e.d - 0.001) ei = i
  })
  return ei
}

/** Advance the hero clock one frame. Plays forward slowly, then rewinds quickly. */
export function stepHero(day: number, dir: 1 | -1, dt: number): { day: number; dir: 1 | -1 } {
  if (dir > 0) {
    const next = day + dt * 1.7
    return next >= HERO_MAX ? { day: HERO_MAX, dir: -1 } : { day: next, dir: 1 }
  }
  const next = day - (dt * HERO_MAX) / 1.05
  return next <= 0 ? { day: 0, dir: 1 } : { day: next, dir: -1 }
}
