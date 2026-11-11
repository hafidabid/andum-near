import { describe, expect, it } from 'vitest'
import { HERO_EVENTS, HERO_MAX, HERO_PARTS, heroEventIndex, heroOpenAt, heroStat, stepHero } from './hero'

const [p1, p2, p3] = HERO_PARTS

describe('heroStat', () => {
  it('part 1 is open from the start', () => {
    expect(heroStat(p1, 0)).toMatchObject({ open: true, label: 'Open', tone: 'open' })
  })
  it('part 2 waits for date and approval, then approval, then opens', () => {
    expect(heroStat(p2, 0).label).toBe('Waiting for date and approval')
    expect(heroStat(p2, 5).label).toBe('Waiting for approval')
    expect(heroStat(p2, 8)).toMatchObject({ open: true, why: 'Approved by Dewi' })
  })
  it('part 3 opens on its date', () => {
    expect(heroStat(p3, 19.9).label).toBe('Waiting for date')
    expect(heroStat(p3, 20)).toMatchObject({ open: true, why: 'The date has passed' })
  })
  it('says when each part opens', () => {
    expect(heroStat(p3, 0).why).toBe('Opens 30 Nov')
    expect(heroStat(p2, 0).why).toBe('Opens 15 Nov, after Dewi approves')
  })
})

describe('heroOpenAt', () => {
  it('matches the day each part opens', () => {
    expect(HERO_PARTS.map(heroOpenAt)).toEqual([0, 8, 20])
  })
})

describe('heroEventIndex', () => {
  it('walks through the four captions', () => {
    expect([0, 4.9, 5, 7.9, 8, 19.9, 20, 22].map(heroEventIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(HERO_EVENTS).toHaveLength(4)
  })
})

describe('stepHero', () => {
  it('plays forward at 1.7 days a second', () => {
    expect(stepHero(0, 1, 1)).toEqual({ day: 1.7, dir: 1 })
  })
  it('turns around at the end', () => {
    expect(stepHero(21.5, 1, 1)).toEqual({ day: HERO_MAX, dir: -1 })
  })
  it('rewinds fast and turns around at zero', () => {
    const r = stepHero(10, -1, 0.1)
    expect(r.dir).toBe(-1)
    expect(r.day).toBeLessThan(10)
    expect(stepHero(0.1, -1, 0.5)).toEqual({ day: 0, dir: 1 })
  })
})
