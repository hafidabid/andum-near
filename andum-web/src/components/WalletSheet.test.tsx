import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FinalCta } from './FinalCta'
import { CONNECT_MS, WalletProvider } from './WalletContext'
import { WalletSheet } from './WalletSheet'

function Page() {
  return (
    <WalletProvider>
      <FinalCta />
      <WalletSheet />
    </WalletProvider>
  )
}

afterEach(() => vi.useRealTimers())

describe('wallet sheet', () => {
  it('is hidden until a call to action is pressed', () => {
    render(<Page />)
    const dialog = screen.getByRole('dialog', { hidden: true })
    expect(dialog).not.toHaveClass('show')
  })

  it('opens from a call to action and closes with the X, Escape or a click outside', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const dialog = screen.getByRole('dialog', { hidden: true })

    await user.click(screen.getByRole('button', { name: /send a package/i }))
    expect(dialog).toHaveClass('show')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(dialog).not.toHaveClass('show')

    await user.click(screen.getByRole('button', { name: /send a package/i }))
    await user.keyboard('{Escape}')
    expect(dialog).not.toHaveClass('show')

    await user.click(screen.getByRole('button', { name: /send a package/i }))
    await user.click(dialog) // the backdrop
    expect(dialog).not.toHaveClass('show')
  })

  it('connects after a short wait and only then shows the network', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Page />)
    const dialog = screen.getByRole('dialog', { hidden: true })
    await user.click(screen.getByRole('button', { name: /send a package/i }))
    expect(dialog.querySelector('.sheet')).toHaveClass('s1')

    await user.click(screen.getByRole('button', { name: /MyNearWallet/ }))
    expect(dialog.querySelector('.sheet')).toHaveClass('s2')
    expect(screen.getByText(/Connecting to MyNearWallet/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(CONNECT_MS + 10)
    })
    expect(dialog.querySelector('.sheet')).toHaveClass('s3')
    expect(screen.getByText('Wallet connected')).toBeInTheDocument()
    expect(screen.getByText('NEAR testnet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create a package/i })).toHaveAttribute('href', expect.stringContaining('#send'))
  })

  it('starts again from the wallet list when reopened', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const dialog = screen.getByRole('dialog', { hidden: true })
    await user.click(screen.getByRole('button', { name: /send a package/i }))
    await user.click(screen.getByRole('button', { name: /MyNearWallet/ }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /send a package/i }))
    expect(dialog.querySelector('.sheet')).toHaveClass('s1')
  })
})
