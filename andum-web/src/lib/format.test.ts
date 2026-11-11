import { describe, expect, it } from 'vitest'
import { clamp, cx, dlab, easeInOut, easeOutCubic, fm, money } from './format'

describe('clamp', () => {
  it('limits a value to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('dlab', () => {
  it('counts days from 10 Nov 2026', () => {
    expect(dlab(0)).toBe('10 Nov')
    expect(dlab(5)).toBe('15 Nov')
    expect(dlab(20)).toBe('30 Nov')
  })
  it('rolls over months and years', () => {
    expect(dlab(21)).toBe('1 Dec')
    expect(dlab(52)).toBe('1 Jan')
  })
  it('floors fractions so a part never opens early', () => {
    expect(dlab(4.99)).toBe('14 Nov')
    expect(dlab(5.0000001)).toBe('15 Nov')
  })
})

describe('money', () => {
  it('uses each asset’s own decimals', () => {
    expect(fm('USDC', 1200.5)).toBe('1,200.5')
    expect(fm('USDC', 1200.555)).toBe('1,200.56')
    expect(fm('IDRX', 12000000)).toBe('12,000,000')
    expect(fm('JPY', 1000.6)).toBe('1,001')
  })
  it('adds the unit', () => {
    expect(money('USDC', 800)).toBe('800 USDC')
    expect(money('GOLD', 1.5)).toBe('1.5 g gold')
  })
})

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
    expect(cx()).toBe('')
  })
})

describe('easing', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
  })
  it('eases out faster at the start', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})
