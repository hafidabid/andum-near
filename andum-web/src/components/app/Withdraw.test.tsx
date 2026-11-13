import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/polyfills'
import { decodeSignedDelegate, keypairFromSecret } from '@shared/near-tx'
import { decide, STORAGE_DEPOSIT_YOCTO, type PolicyConfig, type PolicyState } from '@shared/policy'
import { AppRoutes } from '@/App'
import { ROUTER_FUTURE } from '@/routerFuture'
import { installFakeApi, user, type FakeApi } from '@/test/fakeApi'
import { checkWithdraw } from '@/lib/withdraw'
import { baseToInput } from '@/lib/money'

const ROOT = 'hafidbuild.testnet', USDC = `usdc.${ROOT}`
const cfg: PolicyConfig = { core: `core.${ROOT}`, bridge: `bridge.${ROOT}`, tokens: [USDC], maxHeightWindow: 200, perMinute: 100, perDay: 1000, mintsPerMinute: 5 }
const sk = new Uint8Array(32).fill(4)
const kp = keypairFromSecret(sk)
const FROM = kp.accountId
const bal = { usdc: '10000000000' } // 10,000 USDC

describe('checkWithdraw', () => {
  const ctx = { from: FROM, balances: bal }
  const ok = (to: string, amount = '25', asset = 'usdc') => checkWithdraw({ asset, amount, to }, ctx)
  it('accepts a named or an implicit address and turns the amount into base units', () => {
    expect(ok('alice.testnet')).toEqual({ ok: true, built: { asset: 'usdc', amountBase: '25000000', to: 'alice.testnet' } })
    expect(ok('  ' + 'b'.repeat(64) + ' ', '0.000001')).toMatchObject({ ok: true, built: { amountBase: '1' } })
  })
  it.each([
    ['nothing', '', 'Enter the address'],
    ['an Ethereum address', '0x' + 'a'.repeat(40), 'Ethereum'],
    ['capital letters', 'Alice.testnet', 'not a NEAR address'],
    ['a stray dot', 'alice..testnet', 'not a NEAR address'],
    ['your own account', FROM, 'your own'],
    ['the core contract', `core.${ROOT}`, 'Andum contract'],
    ['the bridge', `bridge.${ROOT}`, 'Andum contract'],
    ['a token contract', USDC, 'Andum contract'],
  ])('refuses %s as the destination', (_n, to, text) => {
    const r = ok(to); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.to).toContain(text)
  })
  it.each([['empty', ''], ['zero', '0'], ['negative', '-1'], ['text', 'abc'], ['too many decimals', '1.0000001']])('refuses an amount that is %s', (_n, a) => {
    const r = ok('alice.testnet', a); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.amount).toContain('above zero')
  })
  it('refuses more than the balance and says how much there is', () => {
    const r = ok('alice.testnet', '10000.01'); expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.amount).toBe('You only have 10,000 USDC.')
    expect(ok('alice.testnet', '10000').ok).toBe(true) // exactly the whole balance is fine
    expect(checkWithdraw({ asset: 'pltr', amount: '1', to: 'alice.testnet' }, ctx).ok).toBe(false) // nothing of that asset
  })
  it('reports both problems at once', () => {
    const r = checkWithdraw({ asset: 'usdc', amount: '', to: '' }, ctx)
    expect(r.ok).toBe(false); if (!r.ok) expect(Object.keys(r.problems).sort()).toEqual(['amount', 'to'])
  })
  it('baseToInput fills the Max button exactly', () => {
    expect(baseToInput('10000000000')).toBe('10000'); expect(baseToInput('1234500')).toBe('1.2345'); expect(baseToInput('1')).toBe('0.000001'); expect(baseToInput('0')).toBe('0')
  })
})

describe('Withdraw tab: what the browser signs is what the relayer accepts', () => {
  let api: FakeApi
  const state = (d: ReturnType<typeof decodeSignedDelegate>): PolicyState => ({
    sessionAccountId: d.senderId, currentBlockHeight: 1000n, keyNonce: 7n, registeredPublicKey: kp.publicKey, submissionsLastMinute: 0, submissionsToday: 0,
    mintsLastMinute: 0, dailyBudgetExceeded: false, payloadAlreadySeen: false, relayerPaused: false,
  })
  beforeEach(() => {
    localStorage.setItem('andum.key.sender@example.com', Array.from(sk, (b) => b.toString(16).padStart(2, '0')).join(''))
    api = installFakeApi({
      'GET /v1/auth/me': () => [200, user({ email: 'sender@example.com', near_account_id: FROM, public_key: kp.publicKey, key_required: false })],
      'GET /v1/packages': () => [200, { items: [], next: null }],
      'POST /v1/relay/submit': () => [202, { relay_id: 'r' + api.count('POST /v1/relay/submit'), status: 'QUEUED' }],
      ...Object.fromEntries(['r1', 'r2'].map((id) => [`GET /v1/relay/${id}`, (): [number, unknown] => [200, { status: 'SUCCEEDED', tx_hash: 'TX' + id }]])),
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  const open = async () => {
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await u.click(await screen.findByRole('tab', { name: 'Withdraw' }))
    await screen.findByRole('heading', { level: 1, name: 'Withdraw' })
    return u
  }
  const signed = () => api.calls.filter((c) => c.key === 'POST /v1/relay/submit').map((c) => decodeSignedDelegate(c.body.signed_delegate_b64))
  const act = (d: ReturnType<typeof decodeSignedDelegate>) => d.actions[0] as { methodName: string; args: Buffer; deposit: bigint; gas: bigint }

  it('sends one ft_transfer to an address that is already set up, and shows the transaction', async () => {
    const u = await open()
    await u.type(screen.getByLabelText('NEAR address'), 'alice.testnet')
    await u.type(screen.getByLabelText('Amount to withdraw'), '25')
    expect(screen.getByLabelText('Withdrawal summary')).toHaveTextContent('25 USDC')
    await u.click(screen.getByRole('button', { name: /Send to this address/ }))
    await waitFor(() => expect(document.querySelector('[data-done=true]')).not.toBeNull(), { timeout: 15_000 })
    const sent = signed()
    expect(sent).toHaveLength(1)
    expect(decide(sent[0], state(sent[0]), cfg)).toEqual({ allow: true })
    expect(sent[0].receiverId).toBe(USDC)
    expect(act(sent[0]).methodName).toBe('ft_transfer'); expect(act(sent[0]).deposit).toBe(1n)
    expect(JSON.parse(act(sent[0]).args.toString())).toEqual({ receiver_id: 'alice.testnet', amount: '25000000' })
    expect(screen.getByText(/25 USDC was sent to alice.testnet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /on NEAR/ })).toHaveAttribute('href', expect.stringContaining('TXr1'))
  })

  it('registers a new address first, with the deposit the relayer expects, then sends', async () => {
    const u = await open()
    await u.selectOptions(screen.getByLabelText('Asset to withdraw'), 'usdc')
    await u.type(screen.getByLabelText('NEAR address'), 'new.friend.testnet')
    await u.type(screen.getByLabelText('Amount to withdraw'), '1.5')
    await u.click(screen.getByRole('button', { name: /Send to this address/ }))
    await waitFor(() => expect(document.querySelector('[data-done=true]')).not.toBeNull(), { timeout: 15_000 })
    const sent = signed()
    expect(sent.map((d) => act(d).methodName)).toEqual(['storage_deposit', 'ft_transfer'])
    for (const d of sent) expect(decide(d, state(d), cfg)).toEqual({ allow: true })
    expect(act(sent[0]).deposit).toBe(STORAGE_DEPOSIT_YOCTO)
    expect(JSON.parse(act(sent[0]).args.toString())).toEqual({ account_id: 'new.friend.testnet', registration_only: true })
    expect(JSON.parse(act(sent[1]).args.toString())).toEqual({ receiver_id: 'new.friend.testnet', amount: '1500000' })
  })

  it('signs nothing when the address or the amount is wrong, and says why', async () => {
    const u = await open()
    await u.type(screen.getByLabelText('NEAR address'), 'Not An Address')
    await u.type(screen.getByLabelText('Amount to withdraw'), '999999')
    await u.click(screen.getByRole('button', { name: /Send to this address/ }))
    expect(await screen.findByText(/not a NEAR address/)).toBeInTheDocument()
    expect(screen.getByText('You only have 10,000 USDC.')).toBeInTheDocument()
    expect(api.count('POST /v1/relay/submit')).toBe(0)
  })

  it('Max fills in the whole balance', async () => {
    const u = await open()
    await u.click(screen.getByRole('button', { name: 'Max' }))
    expect(screen.getByLabelText('Amount to withdraw')).toHaveValue('10000')
  })

  it('shows a failed send in the steps, with Try again', async () => {
    api.routes['GET /v1/relay/r1'] = () => [200, { status: 'FAILED', error_code: 'X', error_message: 'The account bob.testnet is not registered' }]
    const u = await open()
    await u.type(screen.getByLabelText('NEAR address'), 'alice.testnet')
    await u.type(screen.getByLabelText('Amount to withdraw'), '1')
    await u.click(screen.getByRole('button', { name: /Send to this address/ }))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/not set up to receive|not registered/i)
  })
})

/** The "?" next to a field. Its accessible name is generic on purpose, so it never also matches the field's own label. */
const helpBtn = (field: string) => document.querySelector(`[data-help="${field}"]`) as HTMLElement

describe('help and guide', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('andum.key.sender@example.com', Array.from(sk, (b) => b.toString(16).padStart(2, '0')).join(''))
    installFakeApi({
      'GET /v1/auth/me': () => [200, user({ email: 'sender@example.com', near_account_id: FROM, public_key: kp.publicKey, key_required: false })],
      'GET /v1/packages': () => [200, { items: [], next: null }],
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  const open = async () => {
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1, name: 'Send a package' })
    return u
  }
  it('shows the guide on the first visit, and hides it for good once dismissed', async () => {
    const u = await open()
    expect(screen.getByRole('region', { name: 'How a package works' })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /Got it, hide this/ }))
    expect(screen.queryByRole('region', { name: 'How a package works' })).not.toBeInTheDocument()
    expect(localStorage.getItem('andum.guide.v1')).toBe('hidden')
    await u.click(screen.getByRole('button', { name: 'Guide' })) // the header brings it back
    expect(screen.getByRole('region', { name: 'How a package works' })).toBeInTheDocument()
  })
  it('stays hidden on the next visit', async () => {
    localStorage.setItem('andum.guide.v1', 'hidden')
    await open()
    expect(screen.queryByRole('region', { name: 'How a package works' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guide' })).toBeInTheDocument()
  })
  it('a ? beside a field opens a plain-language note and closes again', async () => {
    const u = await open()
    const btn = helpBtn('Recipient email')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await u.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note')).toHaveTextContent(/do not need a crypto wallet/)
    await u.click(btn)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
  it('a field label still finds exactly one control, so lookups by label stay unambiguous', async () => {
    await open()
    for (const l of ['Recipient email', 'Part 1 amount', 'Note', 'Link name']) expect(screen.getAllByLabelText(l)).toHaveLength(1)
  })
  it('clicking a ? does not focus or change the field it explains', async () => {
    const u = await open()
    await u.click(helpBtn('Recipient email'))
    expect(screen.getByLabelText('Recipient email')).not.toHaveFocus()
    expect(screen.getByLabelText('Recipient email')).toHaveValue('')
  })
})
