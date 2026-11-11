import { describe, expect, it } from 'vitest'
import { dockVisible } from './Dock'

describe('dockVisible', () => {
  it('stays hidden until the hero has mostly scrolled away', () => {
    expect(dockVisible(0, 1000, 3000, 800, false)).toBe(false)
    expect(dockVisible(700, 1000, 3000, 800, false)).toBe(false)
    expect(dockVisible(721, 1000, 3000, 800, false)).toBe(true)
  })
  it('hides when the closing call to action is on screen', () => {
    expect(dockVisible(5000, 1000, 600, 800, false)).toBe(false)
    expect(dockVisible(5000, 1000, 900, 800, false)).toBe(true)
  })
  it('hides while the wallet sheet is open', () => {
    expect(dockVisible(5000, 1000, null, 800, true)).toBe(false)
  })
  it('works on pages with no final call to action', () => {
    expect(dockVisible(5000, 1000, null, 800, false)).toBe(true)
  })
})
