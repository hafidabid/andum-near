import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Faq } from './Faq'
import { FAQ } from '@/lib/faq'

describe('<Faq>', () => {
  it('lists every question collapsed', () => {
    render(<Faq />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(FAQ.length)
    buttons.forEach((b) => expect(b).toHaveAttribute('aria-expanded', 'false'))
  })

  it('opens one answer at a time and can close it again', async () => {
    const user = userEvent.setup()
    render(<Faq />)
    const first = screen.getByRole('button', { name: FAQ[0][0] })
    const second = screen.getByRole('button', { name: FAQ[1][0] })

    await user.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'false')

    await user.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')

    await user.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'false')
  })

  it('links each button to its answer region', () => {
    render(<Faq />)
    const b = screen.getByRole('button', { name: FAQ[2][0] })
    expect(document.getElementById(b.getAttribute('aria-controls')!)).toHaveTextContent(FAQ[2][1].slice(0, 20))
  })
})
