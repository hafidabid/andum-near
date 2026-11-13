import { useEffect, useId, useState, type ReactNode } from 'react'
import { cx } from '@/lib/format'
import { txUrl } from '@/lib/chain'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[14px] border border-line bg-card p-5', className)}>{children}</div>
}

export const inputCls = 'w-full rounded-lg border border-line2 bg-bg2 px-3 py-2.5 text-[15px] text-fg placeholder:text-faint outline-none transition-colors focus:border-open disabled:opacity-60'

/** A labelled field. `help` adds a small "?" that opens a plain-language note under the label. */
export function Field({ label, hint, help, error, children }: { label: string; hint?: string; help?: ReactNode; error?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  // A field with a help button is a plain container: a button inside a <label> would also be "labelled" by it.
  // Every input in the app carries its own aria-label, so nothing loses its name.
  const Wrap = help ? 'div' : 'label'
  return (
    <Wrap className="grid gap-1.5 text-left">
      <span className="flex items-center gap-2 text-[13px] font-medium leading-5 text-muted">
        {label}
        {help && <button type="button" className="ws-hint-btn" aria-label="What does this do?" data-help={label} aria-expanded={open} aria-controls={id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}>?</button>}
      </span>
      {help && open && <span id={id} role="note" className="ws-hint">{help}</span>}
      {children}
      {error ? <span role="alert" className="text-[13px] text-bad">{error}</span> : hint ? <span className="text-[12.5px] text-faint">{hint}</span> : null}
    </Wrap>
  )
}

export function Notice({ kind = 'bad', children }: { kind?: 'bad' | 'info' | 'ok'; children: ReactNode }) {
  const tone = kind === 'bad' ? 'border-bad/40 bg-bad/10 text-bad' : kind === 'ok' ? 'border-open/40 bg-open/10 text-open' : 'border-blue/40 bg-blue/10 text-blue'
  return <div role={kind === 'bad' ? 'alert' : 'status'} className={cx('rounded-xl border px-3.5 py-2.5 text-left text-[14px]', tone)}>{children}</div>
}

export function Spinner() {
  return <span className="spin inline-block h-4 w-4 rounded-full border-2 border-line2 border-t-open align-[-2px]" aria-hidden="true" />
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null
  return <a className="mono normal-case tracking-normal text-blue underline-offset-2 hover:underline" href={txUrl(hash)} target="_blank" rel="noreferrer">{hash.slice(0, 8)}… on NEAR</a>
}

/** Counts down a server-told resend delay. */
export function useCountdown(initial: number): [number, (n: number) => void] {
  const [n, setN] = useState(initial)
  useEffect(() => {
    if (n <= 0) return
    const t = setTimeout(() => setN(n - 1), 1000)
    return () => clearTimeout(t)
  }, [n])
  return [n, setN]
}

export type StepState = 'todo' | 'doing' | 'done' | 'fail'
export function StepList({ steps }: { steps: Array<{ label: string; state: StepState; extra?: ReactNode }> }) {
  return (
    <ol className="dispatch-steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-3 text-[15px]" data-state={s.state}>
          <span className={cx('grid h-6 w-6 place-items-center rounded-full border text-[12px]',
            s.state === 'done' && 'border-open bg-open/15 text-open', s.state === 'doing' && 'border-blue text-blue', s.state === 'fail' && 'border-bad text-bad', s.state === 'todo' && 'border-line2 text-faint')}>
            {s.state === 'done' ? 'OK' : s.state === 'fail' ? '!' : s.state === 'doing' ? <Spinner /> : i + 1}
          </span>
          <span className={cx(s.state === 'todo' ? 'text-faint' : 'text-fg')}>{s.label}</span>
          {s.extra}
        </li>
      ))}
    </ol>
  )
}
