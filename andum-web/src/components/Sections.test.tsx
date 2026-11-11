import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ROUTER_FUTURE } from '@/routerFuture'
import { describe, expect, it } from 'vitest'
import { Chains, routeStyle } from './Chains'
import { HOW_STEPS, How, stepIndex } from './How'
import { PHONE_TIMING, Receiving, phoneRows } from './Receiving'
import { Roles } from './Roles'
import { Uses } from './Uses'
import { Ways } from './Ways'
import { AssetsMarquee } from './AssetsMarquee'
import { WalletProvider } from './WalletContext'

const wrap = (ui: React.ReactNode) => render(<MemoryRouter future={ROUTER_FUTURE}><WalletProvider>{ui}</WalletProvider></MemoryRouter>)

describe('<AssetsMarquee>', () => {
  it('shows all eleven assets, repeated once for the loop but announced once', () => {
    wrap(<AssetsMarquee />)
    const items = screen.getAllByRole('listitem', { hidden: true })
    expect(items).toHaveLength(22)
    expect(screen.getAllByRole('listitem')).toHaveLength(11)
    expect(screen.getAllByText('Tokenized gold', { exact: false }).length).toBeGreaterThan(0)
  })
})

describe('<Ways>', () => {
  it('explains the three ways and lists a lane for each', () => {
    wrap(<Ways />)
    expect(screen.getByRole('heading', { name: 'Each part opens its own way' })).toBeInTheDocument()
    for (const t of ['Right away', 'On a date', 'On a date and your approval']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    }
  })
  it('plays each card’s own lane on touch layouts (instantly with reduced motion)', () => {
    wrap(<Ways />)
    // with reduced motion the mini lanes jump to the end: every part is open
    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(3)
  })
})

describe('<How>', () => {
  it('maps scroll progress to one of four steps', () => {
    expect([0, 0.24, 0.25, 0.5, 0.75, 1].map(stepIndex)).toEqual([0, 0, 1, 2, 3, 3])
  })
  it('renders every step with its own card', () => {
    wrap(<How />)
    for (const [title] of HOW_STEPS) expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    expect(screen.getAllByText('1,000 USDC').length).toBeGreaterThan(0)
  })
})

describe('<Receiving>', () => {
  it('phase rows tell the story: waiting, then open', () => {
    expect(phoneRows('waiting')[1]).toMatchObject({ open: false, chip: 'Waiting for approval' })
    expect(phoneRows('notified')[1].open).toBe(false)
    expect(phoneRows('open')[1]).toMatchObject({ open: true, chip: 'Open' })
    expect(phoneRows('done')[1].open).toBe(true)
    expect(phoneRows('waiting')[0].taken).toBe(true)
    expect(PHONE_TIMING.map(([p]) => p)).toEqual(['waiting', 'notified', 'open', 'done'])
  })
  it('lets you take the part once it is open (reduced motion shows the end state)', () => {
    wrap(<Receiving />)
    expect(screen.getByRole('button', { name: 'Take 800 USDC' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('link', { name: /Open an example package/ })).toHaveAttribute('target', '_blank')
  })
})

describe('<Chains>', () => {
  it('lands on Base and funds a package', () => {
    wrap(<Chains />)
    expect(screen.getByRole('button', { name: /Base/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Your wallet on Base')).toBeInTheDocument()
    expect(screen.getByTestId('xc-amt')).toHaveTextContent('1,000 USDC')
  })
  it('switching direction and chain rewrites the route', async () => {
    const user = userEvent.setup()
    wrap(<Chains />)
    await user.click(screen.getByRole('button', { name: 'Send to another chain' }))
    expect(screen.getByText("Rina's package on NEAR")).toBeInTheDocument()
    expect(screen.getByTestId('xc-amt')).toHaveTextContent('800 USDC')
    await user.click(screen.getByRole('button', { name: /Solana/ }))
    expect(screen.getByText("Rina's wallet on Solana")).toBeInTheDocument()
    expect(screen.getByText('800 USDC arrives on Solana')).toBeInTheDocument()
  })
  it('the dot and the lit line move with the phase', () => {
    expect(routeStyle(0)).toMatchObject({ dotOpacity: 0, litWidth: '0%', dotLeft: '16.6%' })
    expect(routeStyle(2)).toMatchObject({ dotOpacity: 1, litWidth: '33.4%', dotLeft: '50%' })
    expect(routeStyle(4)).toMatchObject({ litWidth: '66.8%', dotLeft: '83.4%' })
    expect(routeStyle(5).dotOpacity).toBe(0)
  })
})

describe('<Uses>', () => {
  it('shows the first situation and lets you pick another', async () => {
    const user = userEvent.setup()
    wrap(<Uses />)
    expect(screen.getByRole('tab', { name: /Gift/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('RM 5,000 in two parts')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Freelance work/ }))
    expect(screen.getByRole('tab', { name: /Freelance work/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('A logo job paid in three steps')).toBeInTheDocument()
  })
  it('the slider opens parts and totals them', () => {
    wrap(<Uses />)
    fireEvent.change(screen.getByLabelText('Move along the timeline'), { target: { value: '60' } })
    expect(screen.getByText('Opened so far').nextElementSibling).toHaveTextContent('5,000 MYR')
  })
  it('uses the touch wording below the desktop breakpoint', () => {
    wrap(<Uses />)
    expect(screen.getByText(/Pick one and press play/)).toBeInTheDocument()
  })
})

describe('<Roles>', () => {
  it('starts as the sender, who may fund but not open', () => {
    wrap(<Roles />)
    expect(screen.getByRole('button', { name: /Sender/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Fund the package/ })).toHaveTextContent('✓ Allowed')
    expect(screen.getByRole('button', { name: /Open a part/ })).toHaveTextContent('✕ Refused')
  })
  it('switching role changes what is allowed', async () => {
    const user = userEvent.setup()
    wrap(<Roles />)
    await user.click(screen.getByRole('button', { name: /Receiver/ }))
    expect(screen.getByRole('button', { name: /Open a part/ })).toHaveTextContent('✓ Allowed')
    expect(screen.getByRole('button', { name: /Fund the package/ })).toHaveTextContent('✕ Refused')
  })
  it('trying an action explains the answer', async () => {
    const user = userEvent.setup()
    wrap(<Roles />)
    await user.click(screen.getByRole('button', { name: /Change amounts/ }))
    const msg = document.querySelector('.pr-msg')!
    expect(msg).toHaveTextContent('Refused')
    expect(msg).toHaveTextContent('Terms are fixed once the package is funded.')
    await user.click(screen.getByRole('button', { name: /Pay the network fee/ }))
    expect(msg).toHaveTextContent('Covered')
  })
  it('going back to a role clears the last answer', async () => {
    const user = userEvent.setup()
    wrap(<Roles />)
    await user.click(screen.getByRole('button', { name: /Change amounts/ }))
    await user.click(screen.getByRole('button', { name: /Approver/ }))
    expect(document.querySelector('.pr-msg')).toHaveTextContent('Press an action to try it.')
  })
})

// keep the import so unused-act lint does not complain in future edits
void act
