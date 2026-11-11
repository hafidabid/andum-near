import { describe, expect, it } from 'vitest'
import { SCENARIOS, USES_AXIS, usesAt } from './scenarios'
import { lOpen } from './lanes'

describe('SCENARIOS', () => {
  it('has five everyday situations', () => {
    expect(SCENARIOS.map((s) => s.n)).toEqual(['Gift', 'Freelance work', 'Project', 'Company bonus', 'Team grants'])
  })
  it('every part opens inside the 60-day axis, and approval never comes before the date it waits for', () => {
    for (const s of SCENARIOS) {
      for (const p of s.parts) {
        expect(lOpen(p)).toBeLessThanOrEqual(USES_AXIS)
        if (p.rule === 'both') expect(p.gate).toBeGreaterThanOrEqual(p.date)
      }
    }
  })
  it('every scenario has some story to tell', () => {
    for (const s of SCENARIOS) {
      expect(s.story.length).toBeGreaterThan(40)
      expect(s.parts.length).toBeGreaterThan(0)
    }
  })
})

describe('usesAt', () => {
  it('picks the scenario and the day from scroll progress', () => {
    expect(usesAt(0)).toEqual({ index: 0, day: 0 })
    expect(usesAt(0.19).index).toBe(0)
    expect(usesAt(0.2).index).toBe(1)
    expect(usesAt(1).index).toBe(4)
  })
  it('holds the day at the start and the end of each scenario so people can read it', () => {
    expect(usesAt(0.01).day).toBe(0)
    expect(usesAt(0.2 - 0.001).day).toBe(USES_AXIS)
    const mid = usesAt(0.1).day
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(USES_AXIS)
  })
  it('clamps out-of-range progress', () => {
    expect(usesAt(-3).index).toBe(0)
    expect(usesAt(9).index).toBe(4)
  })
})
