import { describe, expect, it } from 'vitest'
import { CHAINS, X_AMOUNT, X_PHASE_AT, xNote, xSteps } from './chains'
import { waysIndex, WAYS } from './ways'
import { FAQ } from './faq'
import { THEMES, THEME_TINT } from './themes'
import { AS, ASSET_IDS, assetLabel } from './assets'

describe('chains', () => {
  const base = CHAINS.find((c) => c.id === 'base')!
  it('describes both directions with the chosen chain', () => {
    expect(xSteps('in', base)).toEqual(['Deposit 1,000 USDC on Base', 'NEAR Intents converts and bridges', 'The package is funded on NEAR'])
    expect(xSteps('out', base)[2]).toBe('800 USDC arrives on Base')
    expect(xNote('in')).toMatch(/stablecoins/)
    expect(xNote('out')).toMatch(/stay on NEAR/)
  })
  it('animates five phases in time order', () => {
    expect(X_PHASE_AT).toHaveLength(5)
    expect([...X_PHASE_AT]).toEqual([...X_PHASE_AT].sort((a, b) => a - b))
    expect(X_AMOUNT).toEqual({ in: 1000, out: 800 })
  })
  it('has unique chain ids', () => {
    expect(new Set(CHAINS.map((c) => c.id)).size).toBe(CHAINS.length)
  })
})

describe('ways', () => {
  it('maps scroll progress to the highlighted way', () => {
    expect([0, 0.29, 0.3, 0.62, 0.63, 1].map(waysIndex)).toEqual([0, 0, 1, 1, 2, 2])
    expect(WAYS).toHaveLength(3)
  })
})

describe('content tables', () => {
  it('FAQ has unique, answered questions', () => {
    expect(new Set(FAQ.map(([q]) => q)).size).toBe(FAQ.length)
    for (const [q, a] of FAQ) {
      expect(q.endsWith('?')).toBe(true)
      expect(a.length).toBeGreaterThan(20)
    }
  })
  it('themes all have a tint', () => {
    for (const t of THEMES) expect(THEME_TINT[t.id]).toBeTruthy()
  })
  it('assets are all named', () => {
    expect(ASSET_IDS).toHaveLength(11)
    for (const a of ASSET_IDS) expect(AS[a].n.length).toBeGreaterThan(3)
    expect(assetLabel('GOLD')).toBe('Gold')
    expect(assetLabel('USDC')).toBe('USDC')
  })
})
