import { describe, expect, it } from 'vitest'
import { buildDraft, emptyDraft, emptyPart, splitApprovers, totalsByAsset, type Draft } from './draft'

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0)
/** What a datetime-local input holds: local wall-clock time, no zone. */
const iso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const good = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft(), email: 'rina@example.com', parts: [{ ...emptyPart(), amount: '200' }], ...over })
const problems = (d: Draft) => { const r = buildDraft(d, NOW); if (r.ok) throw new Error('expected problems'); return r.problems }

describe('buildDraft: positive', () => {
  it('builds the contract arguments', () => {
    const r = buildDraft(good({ title: ' Bonus ', note: ' Thanks ', slug: 'rina-bonus' }), NOW)
    if (!r.ok) throw new Error(JSON.stringify(r.problems))
    expect(r.built.recipient_email).toBe('rina@example.com')
    expect(r.built.title).toBe('Bonus')
    expect(r.built.slug).toBe('rina-bonus')
    expect(r.built.args.parts).toEqual([{ token_asset: 'usdc', amount: '200000000' }])
    expect(r.built.args.note).toBe('Thanks')
    expect(r.built.args.accept_by_ns).toBe(((BigInt(NOW) + 24n * 3_600_000n) * 1_000_000n).toString())
  })
  it('a dated part with approvers carries date, approvers and threshold', () => {
    const when = NOW + 2 * 864e5
    const d = good({ parts: [{ ...emptyPart('myr'), amount: '10.5', dated: true, date: iso(when), approvers: 'a.testnet, b.testnet', threshold: '2' }] })
    const r = buildDraft(d, NOW)
    if (!r.ok) throw new Error(JSON.stringify(r.problems))
    const p = r.built.args.parts[0]
    expect(p.approvers).toEqual(['a.testnet', 'b.testnet']); expect(p.approval_threshold).toBe(2); expect(p.unlock_ns).toBe((BigInt(Date.parse(iso(when))) * 1_000_000n).toString())
  })
  it('accepts eight parts', () => { expect(buildDraft(good({ parts: Array.from({ length: 8 }, () => ({ ...emptyPart(), amount: '1' })) }), NOW).ok).toBe(true) })
  it('accepts a 64-hex implicit approver', () => {
    const d = good({ parts: [{ ...emptyPart(), amount: '1', dated: true, date: iso(NOW + 864e5), approvers: 'ab'.repeat(32), threshold: '1' }] })
    expect(buildDraft(d, NOW).ok).toBe(true)
  })
})

describe('buildDraft: negative', () => {
  it.each(['', 'rina', 'rina@', '@example.com', 'a b@example.com'])('rejects email %j', (email) => expect(problems(good({ email })).form.email).toBeTruthy())
  it.each(['', '0', '-1', 'abc', '1.0000001'])('rejects amount %j', (amount) => expect(problems(good({ parts: [{ ...emptyPart(), amount }] })).parts[0].amount).toBeTruthy())
  it('rejects zero parts and nine parts', () => {
    expect(problems(good({ parts: [] })).form.parts).toBeTruthy()
    expect(problems(good({ parts: Array.from({ length: 9 }, () => ({ ...emptyPart(), amount: '1' })) })).form.parts).toMatch(/at most 8/)
  })
  it('rejects a title over 60 and a note over 200', () => {
    expect(problems(good({ title: 'x'.repeat(61) })).form.title).toBeTruthy()
    expect(problems(good({ note: 'x'.repeat(201) })).form.note).toBeTruthy()
  })
  it.each(['ab', 'Admin', 'admin', 'a--b', '-ab', 'andum-x', 'x'.repeat(33)])('rejects link name %j', (slug) => expect(problems(good({ slug })).form.slug).toBeTruthy())
  it.each(['0', '-1', '1.5', '721', 'abc', ''])('rejects accept window %j', (acceptHours) => expect(problems(good({ acceptHours })).form.acceptHours).toBeTruthy())
  it('rejects a missing, past and far-future date', () => {
    const dated = (date: string) => good({ parts: [{ ...emptyPart(), amount: '1', dated: true, date }] })
    expect(problems(dated('')).parts[0].date).toBeTruthy()
    expect(problems(dated(iso(NOW - 864e5))).parts[0].date).toMatch(/future/)
    expect(problems(dated(iso(NOW + 5 * 366 * 864e5))).parts[0].date).toMatch(/far/)
  })
  it('approvers without a date are refused (the contract needs both)', () => {
    expect(problems(good({ parts: [{ ...emptyPart(), amount: '1', approvers: 'a.testnet' }] })).parts[0].approvers).toMatch(/need a date/)
  })
  it('rejects 6 approvers, duplicates, bad names and a threshold out of range', () => {
    const base = { ...emptyPart(), amount: '1', dated: true, date: iso(NOW + 864e5) }
    const ap = (approvers: string, threshold = '1') => problems(good({ parts: [{ ...base, approvers, threshold }] })).parts[0]
    expect(ap('a1,a2,a3,a4,a5,a6').approvers).toMatch(/At most 5/)
    expect(ap('a.testnet, a.testnet').approvers).toMatch(/once/)
    expect(ap('UPPER.testnet').approvers).toMatch(/NEAR account/)
    expect(ap('a.testnet', '2').threshold).toBeTruthy()
    expect(ap('a.testnet', '0').threshold).toBeTruthy()
  })
  it('reports every problem at once', () => {
    const p = problems({ ...emptyDraft(), parts: [{ ...emptyPart() }, { ...emptyPart(), amount: 'x' }] })
    expect(p.form.email).toBeTruthy(); expect(p.parts[0].amount).toBeTruthy(); expect(p.parts[1].amount).toBeTruthy()
  })
})

describe('edge cases', () => {
  it('a date just under a minute away is too soon, just over is fine', () => {
    const at = (ms: number) => buildDraft(good({ parts: [{ ...emptyPart(), amount: '1', dated: true, date: iso(ms) }] }), NOW)
    expect(at(NOW + 30_000).ok).toBe(false)
    expect(at(NOW + 3 * 60_000).ok).toBe(true)
  })
  it('splits approvers on commas, spaces and semicolons', () => expect(splitApprovers('a, b;c  d,,')).toEqual(['a', 'b', 'c', 'd']))
  it('totals per asset add up large amounts exactly', () => {
    expect(totalsByAsset([{ token_asset: 'usdc', amount: '9007199254740993' }, { token_asset: 'usdc', amount: '1' }, { token_asset: 'xau', amount: '5' }])).toEqual({ usdc: 9007199254740994n, xau: 5n })
  })
  it('an unchanged part list is not mutated', () => { const d = good(); const copy = JSON.stringify(d); buildDraft(d, NOW); expect(JSON.stringify(d)).toBe(copy) })
})
