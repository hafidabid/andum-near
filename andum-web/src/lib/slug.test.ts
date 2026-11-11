import { describe, expect, it } from 'vitest'
import { checkSlug, slugify } from './slug'

describe('slugify', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(slugify('Rina Audit Bonus!')).toBe('rina-audit-bonus')
    expect(slugify('  --Hello___World--  ')).toBe('hello-world')
  })
  it('cuts at 32 characters', () => {
    expect(slugify('a'.repeat(50))).toHaveLength(32)
  })
  it('copes with empty input', () => {
    expect(slugify('')).toBe('')
  })
})

describe('checkSlug', () => {
  it('accepts a good name', () => {
    expect(checkSlug('rina-audit-bonus')).toEqual({ ok: true })
    expect(checkSlug('abc')).toEqual({ ok: true })
    expect(checkSlug('a'.repeat(32))).toEqual({ ok: true })
  })
  it.each([['ab'], ['a'.repeat(33)], ['Rina'], ['rina bonus'], ['rina--bonus'], ['-rina'], ['rina-'], ['rína'], ['rina_bonus']])('rejects %s', (s) => {
    const r = checkSlug(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('SLUG_INVALID')
  })
  it.each([['admin'], ['api'], ['new'], ['andum-team'], ['andum']])('reserves %s', (s) => {
    const r = checkSlug(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('SLUG_RESERVED')
  })
})
