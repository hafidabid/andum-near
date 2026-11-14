import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/App'
import { ROUTER_FUTURE } from '@/routerFuture'
import { clearCode, err, installFakeApi, typeCode, publicInvite, user, type FakeApi, type Handler } from '@/test/fakeApi'

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}><AppRoutes /><Where /></MemoryRouter>)

const base: Record<string, Handler> = {
  'GET /v1/auth/me': () => err(401, 'UNAUTHENTICATED'),
  'GET /v1/links/rina-bonus': () => [200, { invite_id: 'inv1' }],
  'GET /v1/invites/inv1/public': () => [200, publicInvite()],
}
let api: FakeApi
const mock = (over: Record<string, Handler> = {}) => (api = installFakeApi({ ...base, ...over }))

beforeEach(() => { localStorage.clear() })
afterEach(() => vi.unstubAllGlobals())

describe('receiver link: positive', () => {
  it('resolves the slug and shows the funds before accepting', async () => {
    mock(); renderAt('/p/rina-bonus')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your audit bonus' })).toBeInTheDocument()
    const parts = within(screen.getByRole('list', { name: 'Parts' })).getAllByRole('listitem')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveTextContent('200'); expect(parts[0]).toHaveTextContent('Opens when you accept')
    expect(parts[1]).toHaveTextContent('800'); expect(parts[1]).toHaveTextContent('2 of 2 approvers must approve')
    expect(screen.getByText(/1,000 USDC/)).toBeInTheDocument()
    expect(screen.getByText('A note is waiting for you inside')).toBeInTheDocument()
    expect(screen.getByText(/r\*\*\*@example.com/)).toBeInTheDocument()
    expect(document.title).toBe('Your audit bonus · Andum')
  })
  it('the invite id route works without a slug lookup', async () => {
    mock(); renderAt('/i/inv1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your audit bonus' })).toBeInTheDocument()
    expect(api.count('GET /v1/links/')).toBe(0)
  })
  it('follows an old link name to the new one', async () => {
    mock({ 'GET /v1/links/old-name': () => [200, { invite_id: 'inv1', redirect_to: 'rina-bonus' }] })
    renderAt('/p/old-name')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/p/rina-bonus'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Your audit bonus' })).toBeInTheDocument()
  })
  it('falls back to a neutral title and never shows the note text', async () => {
    mock({ 'GET /v1/invites/inv1/public': () => [200, publicInvite({ title: null })] }); renderAt('/p/rina-bonus')
    expect(await screen.findByRole('heading', { level: 1, name: 'A package for you' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Thanks')
  })
})

describe('receiver link: negative', () => {
  it('a malformed slug is rejected without calling the API', async () => {
    mock(); renderAt('/p/AB')
    expect(await screen.findByRole('heading', { level: 1, name: /does not look like a package link/ })).toBeInTheDocument()
    expect(api.count('GET /v1/links/')).toBe(0)
  })
  it.each([['/p/AB'], ['/p/-bad-'], ['/p/a--b'], ['/p/' + 'x'.repeat(40)]])('%s is not a link name', async (path) => {
    mock(); renderAt(path)
    expect(await screen.findByText(/does not look like a package link/)).toBeInTheDocument()
  })
  it('an unknown link is "not active"', async () => {
    mock({ 'GET /v1/links/nobody-here': () => err(404, 'NOT_FOUND') }); renderAt('/p/nobody-here')
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is not active' })).toBeInTheDocument()
    expect(document.title).toBe('Link not found · Andum')
  })
  it('rate limiting is explained', async () => {
    mock({ 'GET /v1/links/rina-bonus': () => err(429, 'RATE_LIMITED') }); renderAt('/p/rina-bonus')
    expect(await screen.findByRole('heading', { level: 1, name: 'Too many tries' })).toBeInTheDocument()
  })
  it('an unreachable server is explained, not blank', async () => {
    mock({ 'GET /v1/links/rina-bonus': () => 'network' }); renderAt('/p/rina-bonus')
    expect(await screen.findByRole('heading', { level: 1, name: 'We cannot reach Andum right now' })).toBeInTheDocument()
  })
  it('an invite without a package (not attached yet) is "not active"', async () => {
    mock({ 'GET /v1/invites/inv1/public': () => [200, publicInvite({ package: null })] }); renderAt('/p/rina-bonus')
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is not active' })).toBeInTheDocument()
  })
  it('an expired invite cannot be accepted', async () => {
    mock({ 'GET /v1/invites/inv1/public': () => [200, publicInvite({ accept_by_ms: Date.now() - 1000 })] }); renderAt('/p/rina-bonus')
    expect(await screen.findByText(/invite has expired/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept package/ })).not.toBeInTheDocument()
  })
  it('an already accepted package offers no accept button', async () => {
    const p = publicInvite(); p.package.status = 'ACCEPTED'
    mock({ 'GET /v1/invites/inv1/public': () => [200, p] }); renderAt('/p/rina-bonus')
    expect(await screen.findByText(/already accepted/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept package/ })).not.toBeInTheDocument()
  })
  it('a reclaimed package says so', async () => {
    const p = publicInvite(); p.package.status = 'RECLAIMED'
    mock({ 'GET /v1/invites/inv1/public': () => [200, p] }); renderAt('/p/rina-bonus')
    expect(await screen.findByText(/took this package back/)).toBeInTheDocument()
  })
})

describe('accept flow', () => {
  const flow = (over: Record<string, Handler> = {}) => mock({
    'POST /v1/auth/email/start': () => [200, { sent: true, resend_after_s: 60 }],
    'POST /v1/auth/email/verify': () => [200, user()],
    'GET /v1/auth/nonce': () => [200, { nonce: 'n1' }],
    'POST /v1/auth/key': ({ body }) => [200, user({ near_account_id: 'acct', public_key: body.public_key, key_required: false })],
    'POST /v1/accounts/bootstrap': () => [200, { account_id: 'acct', created: true, near_balance_yocto: '1' }],
    'POST /v1/invites/inv1/verify/start': () => [200, { sent: true, resend_after_s: 60 }],
    'POST /v1/invites/inv1/verify/confirm': () => [200, { package_id: '7', invite_secret: 'c2VjcmV0' }],
    'POST /v1/relay/submit': () => [202, { relay_id: 'r1', status: 'QUEUED' }],
    'GET /v1/relay/r1': () => [200, { status: 'SUCCEEDED', tx_hash: 'TXHASH123456' }],
    ...over,
  })
  async function toInviteCode(u: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('heading', { level: 1, name: 'Your audit bonus' })
    await u.click(screen.getByRole('button', { name: /Accept package/ }))
    await u.type(screen.getByLabelText('Your email'), 'rina@example.com')
    await u.click(screen.getByRole('button', { name: 'Send me a sign-in code' }))
    await typeCode(u, await screen.findByLabelText('Sign-in code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Continue' }))
    return screen.findByLabelText('Invite code')
  }

  it('signs in, verifies the invite, signs accept_package and relays it', async () => {
    flow(); const u = userEvent.setup(); renderAt('/p/rina-bonus')
    const code = await toInviteCode(u)
    await typeCode(u, code, '654321')
    await u.click(screen.getByRole('button', { name: 'Accept package' }))
    await waitFor(() => expect(api.count('POST /v1/relay/submit')).toBe(1))
    expect(api.calls.find((c) => c.key === 'POST /v1/invites/inv1/verify/confirm')!.body).toEqual({ code: '654321' })
    const signed = api.calls.find((c) => c.key === 'POST /v1/relay/submit')!.body
    expect(signed.signed_delegate_b64).toMatch(/^[A-Za-z0-9+/=]+$/); expect(signed.client_request_id).toMatch(/^[0-9a-f]{16}$/)
    expect(localStorage.getItem('andum.key.rina@example.com')).toMatch(/^[0-9a-f]{64}$/) // the key stays in the browser
    expect(JSON.stringify(api.calls)).not.toContain(localStorage.getItem('andum.key.rina@example.com')!) // and is never sent anywhere
  })
  it('the bind request carries a public key and signature, never the secret', async () => {
    flow(); const u = userEvent.setup(); renderAt('/p/rina-bonus'); await toInviteCode(u)
    const bind = api.calls.find((c) => c.key === 'POST /v1/auth/key')!.body
    expect(Object.keys(bind).sort()).toEqual(['nonce', 'public_key', 'signature']); expect(bind.public_key).toMatch(/^ed25519:/)
  })
  it('a wrong invite code shows the tries left and lets the user retry', async () => {
    let n = 0
    flow({ 'POST /v1/invites/inv1/verify/confirm': () => (n++ === 0 ? err(400, 'OTP_INVALID', 'x', { attempts_left: 4 }) : [200, { package_id: '7', invite_secret: 'c2VjcmV0' }]) })
    const u = userEvent.setup(); renderAt('/p/rina-bonus')
    const code = await toInviteCode(u)
    await typeCode(u, code, '000000'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    expect(await screen.findByText('That code is not right. 4 tries left.')).toBeInTheDocument()
    expect(api.count('POST /v1/relay/submit')).toBe(0)
    await clearCode(u, code); await typeCode(u, code, '654321'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    await waitFor(() => expect(api.count('POST /v1/relay/submit')).toBe(1))
  })
  it.each([
    ['OTP_EXPIRED', 400, /expired/], ['OTP_LOCKED', 429, /Too many wrong codes/], ['INVITE_EXPIRED', 410, /invite has expired/], ['LINK_LOCKED', 409, /already accepted/],
  ])('invite code error %s is explained', async (code, status, re) => {
    flow({ 'POST /v1/invites/inv1/verify/confirm': () => err(status, code) })
    const u = userEvent.setup(); renderAt('/p/rina-bonus'); const input = await toInviteCode(u)
    await typeCode(u, input, '111111'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    expect(await screen.findByText(re)).toBeInTheDocument()
  })
  it('the contract refusing the secret is shown and nothing is claimed as accepted', async () => {
    flow({ 'GET /v1/relay/r1': () => [200, { status: 'FAILED', error_code: 'INVITE_SECRET_INVALID', tx_hash: 'T' }] })
    const u = userEvent.setup(); renderAt('/p/rina-bonus'); const input = await toInviteCode(u)
    await typeCode(u, input, '111111'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    expect(await screen.findByText(/does not match this package/)).toBeInTheDocument()
    expect(screen.queryByText(/This package is yours/)).not.toBeInTheDocument()
  })
  it('the relayer refusing the call is shown', async () => {
    flow({ 'POST /v1/relay/submit': () => err(403, 'RELAY_POLICY_DENIED', 'no') })
    const u = userEvent.setup(); renderAt('/p/rina-bonus'); const input = await toInviteCode(u)
    await typeCode(u, input, '111111'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    expect(await screen.findByText('The network helper refused this action.')).toBeInTheDocument()
  })
  it('a short invite code is caught in the form without a request', async () => {
    flow(); const u = userEvent.setup(); renderAt('/p/rina-bonus'); const input = await toInviteCode(u)
    await typeCode(u, input, '12'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    expect(await screen.findByText('The code has 6 digits.')).toBeInTheDocument()
    expect(api.count('POST /v1/invites/inv1/verify/confirm')).toBe(0)
  })
  it('a code pasted with spaces is cleaned', async () => {
    flow(); const u = userEvent.setup(); renderAt('/p/rina-bonus'); const input = await toInviteCode(u)
    await typeCode(u, input, '654 321'); await u.click(screen.getByRole('button', { name: 'Accept package' }))
    await waitFor(() => expect(api.calls.find((c) => c.key === 'POST /v1/invites/inv1/verify/confirm')!.body).toEqual({ code: '654321' }))
  })
  it('sign-in refusing a wrong code does not move on', async () => {
    flow({ 'POST /v1/auth/email/verify': () => err(400, 'OTP_INVALID', 'x', { attempts_left: 2 }) })
    const u = userEvent.setup(); renderAt('/p/rina-bonus')
    await screen.findByRole('heading', { level: 1 }); await u.click(screen.getByRole('button', { name: /Accept package/ }))
    await u.type(screen.getByLabelText('Your email'), 'rina@example.com'); await u.click(screen.getByRole('button', { name: 'Send me a sign-in code' }))
    await typeCode(u, await screen.findByLabelText('Sign-in code'), '000000'); await u.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('That code is not right. 2 tries left.')).toBeInTheDocument()
    expect(api.count('POST /v1/invites/inv1/verify/start')).toBe(0)
  })
  it('a resend inside the cooldown shows the countdown instead of failing', async () => {
    flow({ 'POST /v1/auth/email/start': () => err(429, 'RATE_LIMITED', 'wait', { resend_after_s: 42 }) })
    const u = userEvent.setup(); renderAt('/p/rina-bonus')
    await screen.findByRole('heading', { level: 1 }); await u.click(screen.getByRole('button', { name: /Accept package/ }))
    await u.type(screen.getByLabelText('Your email'), 'rina@example.com'); await u.click(screen.getByRole('button', { name: 'Send me a sign-in code' }))
    expect(await screen.findByRole('button', { name: /Resend in 4\ds/ })).toBeDisabled()
  })
  it('an invalid email is stopped before the request', async () => {
    flow(); const u = userEvent.setup(); renderAt('/p/rina-bonus')
    await screen.findByRole('heading', { level: 1 }); await u.click(screen.getByRole('button', { name: /Accept package/ }))
    await u.type(screen.getByLabelText('Your email'), 'nope'); await u.click(screen.getByRole('button', { name: 'Send me a sign-in code' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(api.count('POST /v1/auth/email/start')).toBe(0)
  })
  it('a returning user with their key skips sign-in', async () => {
    flow()
    // first visit creates the key
    const u = userEvent.setup(); const first = renderAt('/p/rina-bonus'); await toInviteCode(u)
    const pub = api.calls.find((c) => c.key === 'POST /v1/auth/key')!.body.public_key
    first.unmount()
    flow({ 'GET /v1/auth/me': () => [200, user({ near_account_id: 'acct', public_key: pub, key_required: false })] })
    renderAt('/p/rina-bonus')
    await screen.findByRole('heading', { level: 1 }); await u.click(screen.getByRole('button', { name: /Accept package/ }))
    expect(await screen.findByLabelText('Invite code')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument()
  })
})
