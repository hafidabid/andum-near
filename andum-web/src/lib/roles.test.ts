import { describe, expect, it } from 'vitest'
import { ACTIONS, MATRIX, ROLES, verdictLabel, verdictPasses, verdictText, verdictTone } from './roles'

describe('permission matrix', () => {
  it('answers every action for every role', () => {
    for (const r of ROLES) {
      for (const [id] of ACTIONS) {
        const cell = MATRIX[r.id][id]
        expect(cell, `${r.id}/${id}`).toBeDefined()
        expect(cell[1].length).toBeGreaterThan(5)
      }
    }
  })
  it('only the sender can fund, only the receiver can open, only an approver can approve', () => {
    const allowed = (action: Parameters<typeof Object.keys>[0] & string) => ROLES.filter((r) => MATRIX[r.id][action as never][0] === 'yes').map((r) => r.id)
    expect(allowed('fund')).toEqual(['sender'])
    expect(allowed('open')).toEqual(['receiver'])
    expect(allowed('approve')).toEqual(['approver'])
  })
  it('nobody can change the terms once funded', () => {
    for (const r of ROLES) expect(MATRIX[r.id].change[0]).toBe('no')
  })
  it('Andum can pay the fee and move nothing else', () => {
    expect(MATRIX.andum.fee[0]).toBe('yes')
    for (const id of ['fund', 'change', 'open', 'approve', 'back'] as const) expect(MATRIX.andum[id][0]).toBe('no')
  })
  it('the sender can take money back only sometimes', () => {
    expect(MATRIX.sender.back[0]).toBe('if')
  })
})

describe('verdict helpers', () => {
  it('maps a verdict to a label, a tone and whether the call gets through', () => {
    expect(verdictLabel('yes')).toBe('Allowed')
    expect(verdictLabel('no')).toBe('Refused')
    expect(verdictLabel('if')).toBe('Sometimes')
    expect(verdictLabel('na')).toBe('Covered')
    expect(verdictTone('yes')).toBe('open')
    expect(verdictTone('if')).toBe('wait')
    expect(verdictTone('na')).toBe('info')
    expect(verdictTone('no')).toBe('bad')
    expect(verdictPasses('yes') && verdictPasses('if')).toBe(true)
    expect(verdictPasses('no') || verdictPasses('na')).toBe(false)
  })
  it('keeps the sentence start tidy', () => {
    expect(verdictText('Refused. Only the sender can fund a package.')).toBe('Refused. Only the sender can fund a package.')
    expect(verdictText('Refused Only the sender')).toBe('Refused. Only the sender')
  })
})
