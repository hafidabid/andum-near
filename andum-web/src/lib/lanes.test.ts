import { describe, expect, it } from 'vitest'
import { agreementParts, agreementSentence, laneStatus, lCond, lOpen, openTotals, type LanePart } from './lanes'

const now: LanePart = { a: 'USDC', amt: 200, rule: 'now', date: 0, gate: 0 }
const date: LanePart = { a: 'GOLD', amt: 1.5, rule: 'date', date: 12, gate: 0 }
const both: LanePart = { a: 'USDC', amt: 800, rule: 'both', date: 20, gate: 25, who: 'Dewi' }

describe('lOpen', () => {
  it('is 0 for right away, the date for a date, the later of date and approval for both', () => {
    expect(lOpen(now)).toBe(0)
    expect(lOpen(date)).toBe(12)
    expect(lOpen(both)).toBe(25)
    expect(lOpen({ ...both, gate: 3 })).toBe(20)
  })
})

describe('lCond', () => {
  it('describes the rule in words', () => {
    expect(lCond(now)).toBe('Opens when accepted')
    expect(lCond(date)).toBe('Opens 22 Nov')
    expect(lCond(both)).toBe('Opens 30 Nov, after approval')
  })
})

describe('laneStatus', () => {
  it('right away is open from day 0', () => {
    expect(laneStatus(now, 0)).toEqual({ open: true, label: 'Open' })
  })
  it('a date part waits, then opens exactly on the date', () => {
    expect(laneStatus(date, 11.9)).toEqual({ open: false, label: 'Waiting for date' })
    expect(laneStatus(date, 12)).toEqual({ open: true, label: 'Open' })
  })
  it('date plus approval needs both', () => {
    expect(laneStatus(both, 0).label).toBe('Waiting for date and approval')
    expect(laneStatus(both, 22).label).toBe('Waiting for approval') // date passed, no approval yet
    expect(laneStatus(both, 25).open).toBe(true)
  })
  it('reports when approval arrives before the date', () => {
    const early = { ...both, date: 30, gate: 10 }
    expect(laneStatus(early, 12)).toEqual({ open: false, label: 'Waiting for date' })
    expect(laneStatus(early, 30).open).toBe(true)
  })
})

describe('openTotals', () => {
  it('adds up only the parts that are open', () => {
    expect(openTotals([now, date, both], 0)).toEqual({ USDC: 200 })
    expect(openTotals([now, date, both], 12)).toEqual({ USDC: 200, GOLD: 1.5 })
    expect(openTotals([now, date, both], 25)).toEqual({ USDC: 1000, GOLD: 1.5 })
  })
  it('ignores amounts that are not numbers', () => {
    expect(openTotals([{ ...now, amt: NaN }], 0)).toEqual({ USDC: 0 })
  })
})

describe('agreement sentences', () => {
  it('says what the receiver can do in plain words', () => {
    expect(agreementSentence(now, '200 USDC')).toBe('Rina can take 200 USDC as soon as she accepts.')
    expect(agreementSentence(date, '1.5 g gold')).toBe('1.5 g gold can be taken from 22 Nov.')
    expect(agreementSentence(both, '800 USDC')).toBe('800 USDC can be taken from 30 Nov, after Dewi approves.')
  })
  it('falls back when no approver is named', () => {
    expect(agreementSentence({ ...both, who: '' }, '800 USDC')).toContain('after the approver approves')
  })
  it('marks the money and the date as bold', () => {
    const bold = agreementParts(both, '800 USDC').filter((s) => s.b).map((s) => s.t)
    expect(bold).toEqual(['800 USDC', '30 Nov', 'Dewi'])
  })
})
