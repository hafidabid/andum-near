import { describe, expect, it } from 'vitest'
import { assetKey, assetOf, fromBase, maskAccount, toBase } from './money'

describe('toBase', () => {
  it.each([['1', '1000000'], ['200', '200000000'], ['0.000001', '1'], ['1,234.5', '1234500000'], [' 5.25 ', '5250000'], ['1.', null], ['.5', null]])('%s', (i, o) => expect(toBase(i)).toBe(o))
  it.each(['', '0', '0.0', '-1', '1e3', 'abc', '1.1234567', '1 000', '--1'])('rejects %j', (i) => expect(toBase(i)).toBeNull())
  it('handles amounts beyond 2^53 without losing digits', () => expect(toBase('9007199254740993')).toBe('9007199254740993000000'))
})

describe('fromBase', () => {
  it('formats', () => { expect(fromBase('1000000000')).toBe('1,000'); expect(fromBase('1500000')).toBe('1.5'); expect(fromBase('0')).toBe('0'); expect(fromBase('1')).toBe('0') })
  it('round trips whole amounts', () => { for (const s of ['1', '12', '999999']) expect(fromBase(toBase(s)!)).toBe(Number(s).toLocaleString('en-US')) })
})

describe('assets', () => {
  it('maps token accounts to assets', () => { expect(assetOf('usdc.hafidbuild.testnet')).toBe('USDC'); expect(assetOf('xau.hafidbuild.testnet')).toBe('GOLD'); expect(assetOf('weird.testnet')).toBe('USDC') })
  it('maps assets to contract keys', () => { expect(assetKey('GOLD')).toBe('xau'); expect(assetKey('USDC')).toBe('usdc') })
  it('shortens long implicit accounts only', () => { expect(maskAccount('a'.repeat(64))).toBe('aaaaaaaa…aaaaaa'); expect(maskAccount('core.hafidbuild.testnet')).toBe('core.hafidbuild.testnet') })
})
