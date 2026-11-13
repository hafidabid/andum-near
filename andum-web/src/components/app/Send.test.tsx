import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/polyfills'
import { decodeSignedDelegate, keypairFromSecret } from '@shared/near-tx'
import { decide, type PolicyConfig, type PolicyState } from '@shared/policy'
import { AppRoutes } from '@/App'
import { ROUTER_FUTURE } from '@/routerFuture'
import { err, installFakeApi, user, type FakeApi, type Handler } from '@/test/fakeApi'

const USDC = 'usdc.hafidbuild.testnet', CORE = 'core.hafidbuild.testnet'
const cfg: PolicyConfig = { core: CORE, bridge: 'bridge.hafidbuild.testnet', tokens: [USDC], maxHeightWindow: 200, perMinute: 100, perDay: 1000, mintsPerMinute: 5 }

let api: FakeApi
const sk = new Uint8Array(32).fill(9)
const kp = keypairFromSecret(sk)

function fake(over: Record<string, Handler> = {}, packages: Array<{ id: string }> = []) {
  let created = false
  api = installFakeApi({
    'GET /v1/auth/me': () => [200, user({ email: 'sender@example.com', near_account_id: kp.accountId, public_key: kp.publicKey, key_required: false })],
    'GET /v1/packages': () => [200, { items: created ? [{ id: '9' }, ...packages] : packages, next: null }],
    'POST /v1/invites': () => [201, { invite_id: 'inv9', invite_hash_b64: 'aGFzaA==' }],
    'POST /v1/relay/submit': ({ body }) => { const d = decodeSignedDelegate(body.signed_delegate_b64); if ((d.actions[0] as { methodName: string }).methodName === 'create_package') created = true; return [202, { relay_id: 'r' + api.count('POST /v1/relay/submit'), status: 'QUEUED' }] },
    'POST /v1/invites/inv9/attach': () => [200, { status: 'ATTACHED' }],
    'PATCH /v1/invites/inv9/link': () => [200, { slug: 'my-link', url: 'http://localhost:3000/p/my-link', title: 'T' }],
    ...Object.fromEntries(['r1', 'r2', 'r3', 'r4'].map((id) => [`GET /v1/relay/${id}`, (): [number, unknown] => [200, { status: 'SUCCEEDED', tx_hash: 'TX' + id }]])),
    ...over,
  })
}

/** Fake chain: every token balance is 10,000 so the balance check passes. */
beforeEach(() => {
  localStorage.setItem('andum.key.sender@example.com', Array.from(sk, (b) => b.toString(16).padStart(2, '0')).join(''))
})
afterEach(() => vi.unstubAllGlobals())

const state = (d: ReturnType<typeof decodeSignedDelegate>): PolicyState => ({
  sessionAccountId: d.senderId, currentBlockHeight: 1000n, keyNonce: 7n, registeredPublicKey: kp.publicKey, submissionsLastMinute: 0, submissionsToday: 0,
  mintsLastMinute: 0, dailyBudgetExceeded: false, payloadAlreadySeen: false, relayerPaused: false,
})

vi.setConfig({ testTimeout: 20_000 })

describe('Send: the calls the browser signs are the calls the relayer and contract accept', () => {
  it('create_package, funding and attach, in order, each passing the relayer policy', async () => {
    fake()
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await u.type(await screen.findByLabelText('Recipient email'), 'rina@example.com')
    await u.type(screen.getByLabelText('Part 1 amount'), '200')
    await u.type(screen.getByLabelText('Title'), 'T')
    await u.click(screen.getByRole('button', { name: /Create and send/ }))
    await waitFor(() => expect(document.querySelector('[data-done=true]')).not.toBeNull(), { timeout: 15_000 })

    const sent = api.calls.filter((c) => c.key === 'POST /v1/relay/submit').map((c) => decodeSignedDelegate(c.body.signed_delegate_b64))
    expect(sent).toHaveLength(2)
    for (const d of sent) expect(decide(d, state(d), cfg)).toEqual({ allow: true })

    const [create, fund] = sent
    const call = (d: typeof create) => d.actions[0] as { methodName: string; args: Buffer; deposit: bigint }
    expect(create.receiverId).toBe(CORE)
    expect(call(create).methodName).toBe('create_package')
    const body = JSON.parse(call(create).args.toString())
    expect(Object.keys(body)).toEqual(['args']) // the contract parameter is called `args`
    expect(body.args.parts).toEqual([{ token: USDC, amount: '200000000' }])
    expect(body.args.invite_hash).toBe('aGFzaA==')
    expect(body.args.theme).toBe('confetti')
    expect(fund.receiverId).toBe(USDC)
    expect(call(fund).methodName).toBe('ft_transfer_call'); expect(call(fund).deposit).toBe(1n)
    expect(JSON.parse(JSON.parse(call(fund).args.toString()).msg)).toEqual({ package_id: '9', part_id: 0 })
    expect(api.calls.find((c) => c.key === 'POST /v1/invites/inv9/attach')!.body).toEqual({ package_id: '9', tx_hash: 'TXr1' })
    expect(api.calls.find((c) => c.key === 'PATCH /v1/invites/inv9/link')!.body).toEqual({ title: 'T' })
    expect(await screen.findByLabelText('Package link')).toHaveValue('http://localhost:3000/p/my-link')
    expect(screen.queryByRole('link', { name: /Open as the recipient/i })).not.toBeInTheDocument()
  })

  it('a refused create shows the reason, keeps the form data and "Try again" resumes without a second invite', async () => {
    let n = 0
    fake({ 'POST /v1/relay/submit': () => (n++ === 0 ? err(403, 'RELAY_POLICY_DENIED', 'no') : [202, { relay_id: 'r1', status: 'QUEUED' }]) })
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await u.type(await screen.findByLabelText('Recipient email'), 'rina@example.com')
    await u.type(screen.getByLabelText('Part 1 amount'), '5')
    await u.click(screen.getByRole('button', { name: /Create and send/ }))
    expect(await screen.findByText('The network helper refused this action.')).toBeInTheDocument()
    expect(api.count('POST /v1/invites')).toBe(1)
    await u.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.count('POST /v1/relay/submit')).toBeGreaterThan(1))
    expect(api.count('POST /v1/invites')).toBe(1) // the invite was reused
  })

  it('a contract refusal while creating is explained', async () => {
    fake({ 'GET /v1/relay/r1': () => [200, { status: 'FAILED', error_code: 'TOKEN_NOT_ALLOWED', error_message: 'token is not allowed' }] })
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await u.type(await screen.findByLabelText('Recipient email'), 'rina@example.com')
    await u.type(screen.getByLabelText('Part 1 amount'), '5')
    await u.click(screen.getByRole('button', { name: /Create and send/ }))
    expect(await screen.findByText('token is not allowed')).toBeInTheDocument()
  })

  it('a taken link name sends the user back to the form with a suggestion', async () => {
    fake({ 'PATCH /v1/invites/inv9/link': () => err(409, 'SLUG_TAKEN', 'taken', { suggestion: 'rina-bonus-2' }) })
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await u.type(await screen.findByLabelText('Recipient email'), 'rina@example.com')
    await u.type(screen.getByLabelText('Part 1 amount'), '5')
    await u.type(screen.getByLabelText('Link name'), 'rina-bonus')
    await u.click(screen.getByRole('button', { name: /Create and send/ }))
    expect(await screen.findByText('That link name is taken.')).toBeInTheDocument()
  })
})
