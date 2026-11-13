import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { COMPOSER_AXIS, Composer, INITIAL_PARTS, parseAmount, withRule } from './Composer'
import { WalletProvider } from './WalletContext'
import { MemoryRouter, useLocation } from 'react-router-dom'

const setup = () =>
  render(
    <MemoryRouter>
      <WalletProvider>
        <Composer />
      </WalletProvider>
    </MemoryRouter>,
  )

describe('composer helpers', () => {
  it('parses what people type', () => {
    expect(parseAmount('1,200.5')).toBe(1200.5)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount('1.')).toBe(1)
  })

  it('changing a rule fills in sensible dates', () => {
    const now = INITIAL_PARTS[0]
    expect(withRule(now, 'date')).toMatchObject({ rule: 'date', date: 10 })
    expect(withRule(now, 'both')).toMatchObject({ rule: 'both', date: 10, gate: 16 })
    const both = INITIAL_PARTS[1]
    expect(withRule(both, 'date')).toMatchObject({ date: 14, gate: 22 }) // keeps what was set
  })
})

describe('<Composer>', () => {
  it('starts with the three example parts and the agreement written out', () => {
    setup()
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
    const agreement = screen.getByText('The agreement').parentElement!
    expect(agreement).toHaveTextContent('Rina can take 200 USDC as soon as she accepts.')
    expect(agreement).toHaveTextContent('800 USDC can be taken from 24 Nov, after Dewi approves.')
    expect(agreement).toHaveTextContent('1.5 g gold can be taken from 14 Dec.')
    expect(screen.getByText('Right now').parentElement).toHaveTextContent('Rina can take 200 USDC')
  })

  it('moving the timeline opens parts and updates the total', () => {
    setup()
    const slider = screen.getByLabelText('Move along the timeline')
    fireEvent.change(slider, { target: { value: String(COMPOSER_AXIS) } })
    const box = screen.getByText('Right now').parentElement!
    expect(box).toHaveTextContent('Rina can take 1,000 USDC + 1.5 g gold')
  })

  it('shows the approver field only for "date + approval"', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getAllByLabelText(/Who approves/)).toHaveLength(1)
    await user.click(screen.getAllByRole('button', { name: 'Date + approval' })[0])
    expect(screen.getAllByLabelText(/Who approves/)).toHaveLength(2)
  })

  it('rewrites the agreement when an amount changes', async () => {
    const user = userEvent.setup()
    setup()
    const amount = screen.getByLabelText('Amount for part 1')
    await user.clear(amount)
    await user.type(amount, '350')
    expect(screen.getByText('350 USDC')).toBeInTheDocument()
  })

  it('adds and removes parts, up to five', async () => {
    const user = userEvent.setup()
    setup()
    const add = () => screen.getByRole('button', { name: '+ Add a part' })
    await user.click(add())
    await user.click(add())
    expect(screen.getAllByLabelText(/Amount for part/)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: '+ Add a part' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove part 5' }))
    expect(screen.getAllByLabelText(/Amount for part/)).toHaveLength(4)
    expect(add()).toBeInTheDocument()
  })

  it('cannot remove the last part', async () => {
    const user = userEvent.setup()
    setup()
    for (const n of [3, 2]) await user.click(screen.getByRole('button', { name: `Remove part ${n}` }))
    expect(screen.queryByRole('button', { name: /Remove part/ })).not.toBeInTheDocument()
  })

  it('marks the step you are on', async () => {
    const user = userEvent.setup()
    setup()
    const steps = screen.getByText('Add parts and pick a rule').closest('.steps3')!
    expect(within(steps as HTMLElement).getByText('Add parts and pick a rule').closest('span')).toHaveClass('on')
    await user.click(screen.getAllByRole('button', { name: 'On a date' })[0])
    expect(within(steps as HTMLElement).getByText('Drag the dates').closest('span')).toHaveClass('on')
  })

  it('the call to action opens the app', async () => {
    const user = userEvent.setup()
    function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
    render(
      <MemoryRouter>
        <WalletProvider>
          <Composer />
        </WalletProvider>
        <Where />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/')
    await user.click(screen.getByRole('button', { name: /Send this package/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/app')
  })
})
