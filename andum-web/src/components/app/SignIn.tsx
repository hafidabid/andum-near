import { useState, type FormEvent } from 'react'
import { errorText } from '@/lib/errors'
import { ApiError } from '@/lib/api'
import { Field, Notice, Spinner, inputCls, useCountdown } from './ui'
import { useSession } from './Session'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Email code sign-in. The code proves the address; the browser then makes (or loads) the NEAR key. */
export function SignIn({ defaultEmail = '', cta = 'Send me a code', onDone }: { defaultEmail?: string; cta?: string; onDone?: () => void }) {
  const s = useSession()
  const [email, setEmail] = useState(defaultEmail)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wait, setWait] = useCountdown(0)

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setErr(null)
    if (!EMAIL.test(email.trim())) { setErr('Enter a valid email address.'); return }
    setBusy(true)
    try { const r = await s.requestCode(email.trim()); setSent(true); setWait(r.resend_after_s) }
    catch (x) {
      if (x instanceof ApiError && typeof x.details.resend_after_s === 'number') { setSent(true); setWait(x.details.resend_after_s) }
      setErr(errorText(x))
    } finally { setBusy(false) }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    const c = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(c)) { setErr('The code has 6 digits.'); return }
    setBusy(true)
    try { await s.verifyCode(email.trim(), c); onDone?.() }
    catch (x) { setErr(errorText(x)) }
    finally { setBusy(false) }
  }

  if (!sent) {
    return (
      <form onSubmit={send} className="grid gap-3.5" noValidate>
        <Field label="Your email" hint="We email you a 6-digit code. No password.">
          <input className={inputCls} type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} aria-label="Your email" />
        </Field>
        {err && <Notice>{err}</Notice>}
        <button className="btn justify-center" disabled={busy}>{busy ? <Spinner /> : cta}</button>
      </form>
    )
  }
  return (
    <form onSubmit={verify} className="grid gap-3.5" noValidate>
      <Field label={`Code sent to ${email.trim()}`} hint="It can take a few seconds. It is valid for 10 minutes.">
        <input className={inputCls + ' mono tracking-[.3em]'} inputMode="numeric" autoComplete="one-time-code" maxLength={9} placeholder="000000" autoFocus value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} aria-label="Sign-in code" />
      </Field>
      {err && <Notice>{err}</Notice>}
      <button className="btn justify-center" disabled={busy}>{busy ? <Spinner /> : 'Continue'}</button>
      <div className="flex justify-between text-[13px] text-muted">
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => { setSent(false); setCode(''); setErr(null) }}>Use another email</button>
        <button type="button" className="underline-offset-2 hover:underline disabled:opacity-50" disabled={wait > 0 || busy} onClick={() => send()}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button>
      </div>
    </form>
  )
}
