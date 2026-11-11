import { describe, expect, it } from 'vitest'
import { DEMO_LINKS, lookupLink } from './links'

describe('lookupLink', () => {
  it('finds a known link, ignoring case', () => {
    const r = lookupLink('Rina-Audit-Bonus')
    expect(r.kind).toBe('found')
    if (r.kind === 'found') expect(r.link.title).toBe('Your audit bonus')
  })
  it('knows a well-formed name that has no package', () => {
    expect(lookupLink('nobody-here')).toEqual({ kind: 'unknown' })
  })
  it('rejects names that can never be a link', () => {
    expect(lookupLink('A')).toEqual({ kind: 'invalid' })
    expect(lookupLink('bad name')).toEqual({ kind: 'invalid' })
    expect(lookupLink(undefined)).toEqual({ kind: 'invalid' })
    expect(lookupLink('admin')).toEqual({ kind: 'invalid' })
  })
  it('every demo link is itself a valid name and has parts', () => {
    for (const l of DEMO_LINKS) {
      expect(lookupLink(l.slug).kind).toBe('found')
      expect(l.parts.length).toBeGreaterThan(0)
    }
  })
})
