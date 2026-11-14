import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Btn, OtpInput } from './ui'

function Harness({ onComplete }: { onComplete?: (v: string) => void }) {
  const [v, setV] = useState('')
  return <><OtpInput label="Code" value={v} onChange={setV} onComplete={onComplete} /><output data-testid="v">{v}</output></>
}
const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[]

describe('<OtpInput>', () => {
  it('shows six boxes and moves along as digits are typed', async () => {
    const u = userEvent.setup(); const done = vi.fn()
    render(<Harness onComplete={done} />)
    expect(boxes()).toHaveLength(6)
    await u.click(boxes()[0]); await u.keyboard('12a34')
    expect(screen.getByTestId('v')).toHaveTextContent('1234')
    expect(boxes()[4]).toHaveFocus()
    await u.keyboard('56')
    expect(done).toHaveBeenCalledWith('123456')
  })
  it('takes a pasted code in one go, ignoring spaces', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(boxes()[0]); await u.paste('654 321')
    expect(screen.getByTestId('v')).toHaveTextContent('654321')
  })
  it('backspace clears the box, then steps back', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(boxes()[0]); await u.keyboard('123')
    await u.keyboard('{Backspace}')
    expect(screen.getByTestId('v')).toHaveTextContent('12')
    await u.keyboard('{Backspace}{Backspace}')
    expect(screen.getByTestId('v')).toHaveTextContent('')
    expect(boxes()[0]).toHaveFocus()
  })
})

describe('<Btn>', () => {
  it('keeps its idle label in the layout while busy, disables itself and says it is busy', () => {
    render(<Btn busy busyLabel="Sending…">Send me a code</Btn>)
    const b = screen.getByRole('button')
    expect(b).toBeDisabled(); expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b).toHaveTextContent('Send me a code'); expect(b).toHaveTextContent('Sending…')
  })
  it('is a normal enabled button when idle', () => {
    render(<Btn>Go</Btn>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled()
  })
})
