import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import '@/polyfills'
import { keypairFromSecret } from '@shared/near-tx'
import { AppRoutes } from '@/App'
import { emptyDraft, emptyPart, type Draft } from '@/lib/draft'
import { ROUTER_FUTURE } from '@/routerFuture'
import { installFakeApi, user } from '@/test/fakeApi'
import { Summary } from './Send'

const draft = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft(), ...over })
const ready = draft({ email: 'rina@example.com', parts: [{ ...emptyPart('usdc'), amount: '200' }] })

describe('<Summary>: the package as it is being built', () => {
  it('lists what is missing and does not pretend the package is ready', () => {
    render(<Summary d={draft()} balances={{}} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 things left before you can send')
    expect(screen.getByText('Add the recipient’s email')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount for every part')).toBeInTheDocument()
    expect(screen.queryByText(/^Total/)).not.toBeInTheDocument()
  })

  it('is ready once the email, the amounts and the balance are in place, and totals what it holds', () => {
    render(<Summary d={ready} balances={{ usdc: '1000000000' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Ready to send')
    expect(screen.getByText('Your balance covers it')).toBeInTheDocument()
    expect(screen.getByText('200 USDC', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText('Opens at once')).toBeInTheDocument()
  })

  it('says how much is missing when the balance is too small, in the negative state', () => {
    render(<Summary d={ready} balances={{ usdc: '50000000' }} />)
    const line = screen.getByText(/You need 200 USDC and have 50/)
    expect(line).toHaveAttribute('data-bad', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('1 thing left')
  })

  it('shows each part with its own rule and asks for a date and approvers where the rule needs them', () => {
    const d = draft({ email: 'rina@example.com', parts: [
      { ...emptyPart('myr'), amount: '500' },
      { ...emptyPart('xau'), amount: '2', dated: true, approvalRequired: true },
    ] })
    render(<Summary d={d} balances={{}} />)
    expect(screen.getByText('500 MYR')).toBeInTheDocument()
    expect(screen.getByText('2 g gold')).toBeInTheDocument()
    expect(screen.getByText('When they accept')).toBeInTheDocument()
    expect(screen.getByText(/On a date \(not set yet\) · after approval/)).toBeInTheDocument()
    expect(screen.getByText('Pick a date for every dated part')).toBeInTheDocument()
    expect(screen.getByText('Add approvers where approval is required')).toBeInTheDocument()
  })
})

describe('Send form: starting points set how parts open, never the money', () => {
  const sk = new Uint8Array(32).fill(5)
  const kp = keypairFromSecret(sk)
  beforeEach(() => {
    localStorage.setItem('andum.key.sender@example.com', Array.from(sk, (b) => b.toString(16).padStart(2, '0')).join(''))
    installFakeApi({
      'GET /v1/auth/me': () => [200, user({ email: 'sender@example.com', near_account_id: kp.accountId, public_key: kp.publicKey, key_required: false })],
      'GET /v1/packages': () => [200, { items: [], next: null }],
    })
  })
  const open = async () => {
    const u = userEvent.setup()
    render(<MemoryRouter initialEntries={['/app']} future={ROUTER_FUTURE}><AppRoutes /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1, name: 'Send a package' })
    return u
  }

  it('Milestones makes part 2 a dated, approved part and leaves every amount empty', async () => {
    const u = await open()
    await u.click(screen.getByRole('button', { name: 'Milestones' }))
    expect(screen.getByRole('button', { name: 'Milestones' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('')
    expect(screen.getByLabelText('Part 2 amount')).toHaveValue('')
    expect(screen.getByLabelText('Part 1 opens on a date')).not.toBeChecked()
    expect(screen.getByLabelText('Part 2 opens on a date')).toBeChecked()
    expect(screen.getByLabelText('Part 2 requires approval')).toBeChecked()
  })

  it('keeps the asset and amount you already chose when you switch starting point', async () => {
    const u = await open()
    await u.selectOptions(screen.getByLabelText('Part 1 asset'), 'myr')
    await u.type(screen.getByLabelText('Part 1 amount'), '25')
    await u.click(screen.getByRole('button', { name: 'Now and later' }))
    expect(screen.getByLabelText('Part 1 asset')).toHaveValue('myr')
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('25')
    expect(screen.getByLabelText('Part 2 amount')).toHaveValue('')
    await u.click(screen.getByRole('button', { name: 'One part' }))
    expect(screen.queryByLabelText('Part 2 amount')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Part 1 amount')).toHaveValue('25')
  })

  it('stops claiming a starting point once you change the rules by hand', async () => {
    const u = await open()
    await u.click(screen.getByRole('button', { name: 'Milestones' }))
    await u.click(screen.getByLabelText('Part 2 opens on a date'))
    expect(screen.getByRole('button', { name: 'Milestones' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the summary follows what you type', async () => {
    const u = await open()
    await u.type(screen.getByLabelText('Recipient email'), 'rina@example.com')
    await u.type(screen.getByLabelText('Part 1 amount'), '200')
    await waitFor(() => expect(screen.getByLabelText('Package summary')).toHaveTextContent('rina@example.com'))
    expect(screen.getByLabelText('Package summary')).toHaveTextContent('200 USDC')
  })

  it('shows every deployed asset with its symbol in the balances', async () => {
    await open()
    const bal = await screen.findByLabelText('Your balances')
    for (const sym of ['USDC', 'IDRX', 'MYR', 'Gold g', 'AAPL', 'NVDA', 'PLTR']) expect(bal).toHaveTextContent(sym)
    expect(screen.getByRole('button', { name: 'Get test PLTR' })).toBeInTheDocument()
  })
})
