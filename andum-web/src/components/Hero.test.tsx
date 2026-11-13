import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ROUTER_FUTURE } from '@/routerFuture'
import { describe, expect, it, vi } from 'vitest'
import { HEADLINE_WORDS, Hero } from './Hero'
import { WalletProvider } from './WalletContext'

const setup = () =>
  render(
    <MemoryRouter future={ROUTER_FUTURE}>
      <WalletProvider>
        <Hero />
      </WalletProvider>
    </MemoryRouter>,
  )

describe('<Hero>', () => {
  it('has one h1 with the promise', () => {
    setup()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Programmable gifts.')
  })

  it('rotates through the four words, and holds still with reduced motion', () => {
    expect(HEADLINE_WORDS).toEqual(['gifts', 'payments', 'rewards', 'surprises'])
    const real = window.matchMedia
    vi.useFakeTimers()
    try {
      // reduced motion (the test default): the first word never changes
      const still = setup()
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Programmable gifts.')
      still.unmount()
      // motion allowed: one word every 2.6 s, then back to the first
      window.matchMedia = ((q: string) => ({ ...real(q), matches: false })) as typeof window.matchMedia
      setup()
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1).toHaveTextContent('Programmable gifts.')
      for (const w of ['payments', 'rewards', 'surprises', 'gifts']) {
        act(() => { vi.advanceTimersByTime(2600) })
        expect(h1).toHaveTextContent(`Programmable ${w}.`)
      }
    } finally {
      window.matchMedia = real
      vi.useRealTimers()
    }
  })

  it('shows the three parts, only the first one open at the start', () => {
    setup()
    expect(screen.getAllByText('Open')).toHaveLength(1)
    expect(screen.getByText('Waiting for date and approval')).toBeInTheDocument()
    expect(screen.getByText('Waiting for date')).toBeInTheDocument()
    expect(screen.getByText(/Rina can take/)).toHaveTextContent('Rina can take 200 USDC now')
  })

  it('moving the timeline changes statuses, the date and the caption', () => {
    setup()
    const slider = screen.getByLabelText('Move along the timeline')

    fireEvent.change(slider, { target: { value: '5' } })
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('15 Nov', { selector: '#st-date' })).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '8' } })
    expect(screen.getAllByText('Open')).toHaveLength(2)
    expect(screen.getByText(/Rina can take/)).toHaveTextContent('Rina can take 1,000 USDC now')

    fireEvent.change(slider, { target: { value: '22' } })
    expect(screen.getAllByText('Open')).toHaveLength(3)
    expect(screen.getByText(/Rina can take/)).toHaveTextContent('1,000 USDC and 1.5 g gold now')
  })

  it('scrubbing pauses playback and the play button resumes it', async () => {
    const user = userEvent.setup()
    setup()
    // reduced motion is on in tests, so playback starts paused
    const play = screen.getByRole('button', { name: 'Play' })
    await user.click(play)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Move along the timeline'), { target: { value: '3' } })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('links to the sections and the app', () => {
    setup()
    expect(screen.getByRole('link', { name: 'See how a package opens' })).toHaveAttribute('href', '/#ways')
    expect(screen.getByRole('link', { name: 'Already sent one? Sign in' })).toHaveAttribute('href', '/app')
  })
})
