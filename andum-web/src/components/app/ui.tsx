import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ClipboardEvent, type KeyboardEvent as ReactKeyEvent, type ReactNode } from 'react'
import { cx } from '@/lib/format'
import { txUrl } from '@/lib/chain'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[14px] border border-line bg-card p-5', className)}>{children}</div>
}

export const inputCls = 'w-full rounded-lg border border-line2 bg-bg2 px-3 py-2.5 text-[15px] text-fg placeholder:text-faint outline-none transition-colors focus:border-open disabled:opacity-60'

/** A labelled field. `help` adds a small "?" that opens a plain-language note in a floating popover. */
export function Field({ label, hint, help, error, group, children }: { group?: boolean; label: string; hint?: string; help?: ReactNode; error?: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  // A field with a help button is a plain container: a button inside a <label> would also be "labelled" by it.
  // Every input in the app carries its own aria-label, so nothing loses its name.
  const Wrap = help || group ? 'div' : 'label'
  return (
    <Wrap className="grid gap-1.5 text-left">
      <span className="flex items-center gap-2 text-[13px] font-medium leading-5 text-muted">
        {label}
        {help && <span ref={box} className="ws-hint-wrap"><button type="button" className="ws-hint-btn" aria-label="What does this do?" data-help={label} aria-expanded={open} aria-controls={id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}>?</button>{open && <span id={id} role="note" className="ws-hint">{help}</span>}</span>}
      </span>
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

/** Small inline spinner for buttons. Sized in em so it follows the button's text. */
export function Dots() {
  return <span className="sp" aria-hidden="true" />
}

/**
 * Button label that keeps its size while busy. The idle label and the busy label share one grid cell, so the
 * button is as wide as the longer of the two and never jumps. The busy view shows a spinner and, if given, its own text.
 */
export function BusyLabel({ busy, busyLabel, children }: { busy: boolean; busyLabel?: ReactNode; children: ReactNode }) {
  return (
    <span className="bl">
      <span className="bl-idle" data-off={busy || undefined}>{children}</span>
      <span className="bl-busy" data-on={busy || undefined} aria-hidden={!busy}><Dots />{busyLabel}</span>
    </span>
  )
}

/** The app's standard button: one look idle and busy, disabled while busy, announced as busy. */
export function Btn({ busy = false, busyLabel, disabled, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: ReactNode }) {
  return (
    <button {...rest} className={cx('btn', className)} disabled={disabled || busy} aria-busy={busy || undefined}>
      <BusyLabel busy={busy} busyLabel={busyLabel}>{children}</BusyLabel>
    </button>
  )
}

/** Six boxes for a numeric code. Types, pastes (also from SMS autofill), backspaces and arrows like one field. */
export function OtpInput({ value, onChange, onComplete, disabled, label, length = 6, invalid }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; label: string; length?: number; invalid?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  const focus = (i: number) => { const el = refs.current[Math.max(0, Math.min(length - 1, i))]; el?.focus(); el?.select() }
  const commit = (v: string, at: number) => {
    onChange(v)
    if (v.length === length) onComplete?.(v)
    focus(Math.min(at, length - 1))
  }
  // Writes `incoming` digits starting at box `i`, keeping what comes before.
  const put = (i: number, incoming: string) => {
    const d = incoming.replace(/\D/g, '')
    if (!d) return
    const next = (value.slice(0, i).padEnd(i, ' ') + d + value.slice(i + d.length)).replace(/ /g, '').slice(0, length)
    commit(next, i + d.length)
  }
  const key = (i: number, e: ReactKeyEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) onChange(value.slice(0, i) + value.slice(i + 1))
      else if (i > 0) { onChange(value.slice(0, i - 1) + value.slice(i)); focus(i - 1) }
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1) }
  }
  const paste = (i: number, e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); put(i, e.clipboardData.getData('text')) }
  return (
    <div role="group" aria-label={label} className="otp" data-invalid={invalid || undefined}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className="otp-box"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={i === 0}
          maxLength={length}
          value={d}
          disabled={disabled}
          aria-label={`${label}, digit ${i + 1}`}
          onChange={(e) => put(Math.min(i, value.length), e.target.value)}
          onKeyDown={(e) => key(i, e)}
          onPaste={(e) => paste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
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
