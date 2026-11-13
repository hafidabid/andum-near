import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { ChainError, errorText } from './errors'
import { err, installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('returns parsed json and sends cookies and json bodies', async () => {
    const f = installFakeApi({ 'POST /v1/x': ({ body }) => [200, { echo: body }] })
    expect(await api('POST', '/v1/x', { a: 1 })).toEqual({ echo: { a: 1 } })
    const init = vi.mocked(fetch).mock.calls[0][1]!
    expect(init.credentials).toBe('include'); expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(f.calls).toHaveLength(1)
  })
  it('maps the server error body to ApiError with code, message and details', async () => {
    installFakeApi({ 'GET /v1/x': () => err(400, 'OTP_INVALID', 'nope', { attempts_left: 3 }) })
    const e = await api('GET', '/v1/x').catch((x) => x)
    expect(e).toBeInstanceOf(ApiError); expect(e).toMatchObject({ status: 400, code: 'OTP_INVALID', message: 'nope', details: { attempts_left: 3 } })
  })
  it('survives a non-json error page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })))
    expect(await api('GET', '/v1/x').catch((x) => x)).toMatchObject({ status: 502, code: 'HTTP_502' })
  })
  it('an empty 200 body is fine', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    expect(await api('POST', '/v1/x')).toBeUndefined()
  })
  it('a network failure becomes NETWORK', async () => {
    installFakeApi({ 'GET /v1/x': () => 'network' })
    expect(await api('GET', '/v1/x').catch((x) => x)).toMatchObject({ status: 0, code: 'NETWORK' })
  })
  it('a slow server times out as NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: unknown, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))))
    expect(await api('GET', '/v1/x', undefined, { timeoutMs: 10 }).catch((x) => x)).toMatchObject({ code: 'NETWORK', message: expect.stringContaining('too long') })
  })
})

describe('error text', () => {
  it.each([
    ['ALREADY_TAKEN', /only be taken once/], ['TIME_NOT_REACHED', /not open yet/], ['APPROVAL_MISSING', /waiting for approval/], ['NOT_PASS_OWNER', /holder of the pass/],
    ['INVITE_SECRET_INVALID', /does not match/], ['OTP_EXPIRED', /expired/], ['OTP_LOCKED', /Too many wrong codes/], ['RATE_LIMITED', /Too many tries/], ['NETWORK', /Cannot reach/],
  ])('%s is explained in plain words', (code, re) => expect(errorText(new ChainError(code, 'raw'))).toMatch(re))
  it('shows attempts left on a wrong code', () => expect(errorText(new ApiError(400, 'OTP_INVALID', 'x', { attempts_left: 2 }))).toBe('That code is not right. 2 tries left.'))
  it('an unknown code falls back to the server message, then to a generic one', () => {
    expect(errorText(new ApiError(500, 'WEIRD', 'Server said so'))).toBe('Server said so')
    expect(errorText('???')).toBe('Something went wrong')
  })
})
