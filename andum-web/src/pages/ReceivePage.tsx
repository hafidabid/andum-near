import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError, type PackageView, type PublicInvite } from '@/lib/api'
import { NEAR_CORE, TGAS } from '@/lib/chain'
import { errorText } from '@/lib/errors'
import { fromBase, assetOf } from '@/lib/money'
import { AS, AssetIcon } from '@/lib/assets'
import { fmtDate, ruleText } from '@/lib/parts'
import { checkSlug } from '@/lib/slug'
import { THEME_TINT, type ThemeId } from '@/lib/themes'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ThemeArt } from '@/components/ThemeArt'
import { Btn, Card, Field, Notice, OtpInput, Spinner, TxLink, useCountdown } from '@/components/app/ui'
import { PartsList } from '@/components/app/PartsList'
import { SignIn } from '@/components/app/SignIn'
import { useSession } from '@/components/app/Session'

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' | 'invalid' | 'unreachable' | 'busy'; msg?: string }
  | { kind: 'ok'; inviteId: string; pub: PublicInvite }

function Unavailable({ kind, msg }: { kind: 'missing' | 'invalid' | 'unreachable' | 'busy'; msg?: string }) {
  useDocumentTitle('Link not found · Andum')
  const text = {
    invalid: ['That does not look like a package link', 'Link names use letters, numbers and single hyphens. Check the link you were sent.'],
    missing: ['This link is not active', 'It may have expired, or the sender changed the name. Ask them to send it again.'],
    unreachable: ['We cannot reach Andum right now', msg ?? 'Check your connection and try again in a moment.'],
    busy: ['Too many tries', 'Wait a minute, then open the link again.'],
  }[kind]
  return (
    <section className="grid min-h-[70vh] place-items-center !pt-[120px] text-center" aria-labelledby="pl-title">
      <div className="grid max-w-[460px] justify-items-center gap-4">
        <div className="mono">Package link</div>
        <h1 id="pl-title" className="text-balance text-[clamp(34px,7vw,56px)]">{text[0]}</h1>
        <p className="lede">{text[1]}</p>
        <Link className="btn mt-2" to="/">Back to home</Link>
      </div>
    </section>
  )
}

/** What a receiver sees when they open a link (`/p/<name>` or `/i/<id>`), wired to the API. */
export function ReceivePage({ by }: { by: 'slug' | 'id' }) {
  const { slug, id } = useParams()
  const nav = useNavigate()
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const key = by === 'slug' ? slug : id

  useEffect(() => {
    const ctl = new AbortController()
    setState({ kind: 'loading' })
    ;(async () => {
      try {
        let inviteId = id ?? ''
        if (by === 'slug') {
          if (!checkSlug(slug ?? '').ok) { setState({ kind: 'invalid' }); return }
          const r = await apiClient.resolveLink(slug!)
          if (r.redirect_to) { nav(`/p/${r.redirect_to}`, { replace: true }); return }
          inviteId = r.invite_id
        }
        const pub = await apiClient.publicInvite(inviteId)
        if (!ctl.signal.aborted) setState({ kind: 'ok', inviteId, pub })
      } catch (e) {
        if (ctl.signal.aborted) return
        if (e instanceof ApiError && e.status === 404) setState({ kind: 'missing' })
        else if (e instanceof ApiError && e.status === 429) setState({ kind: 'busy' })
        else setState({ kind: 'unreachable', msg: errorText(e) })
      }
    })()
    return () => ctl.abort()
  }, [key, by]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'loading') return <section className="grid min-h-[60vh] place-items-center !pt-[120px]" aria-busy="true"><Spinner /></section>
  if (state.kind !== 'ok') return <Unavailable kind={state.kind} msg={state.msg} />
  return <Found inviteId={state.inviteId} pub={state.pub} />
}

function Found({ inviteId, pub: initial }: { inviteId: string; pub: PublicInvite }) {
  const s = useSession()
  const [pub, setPub] = useState(initial)
  const [owned, setOwned] = useState<PackageView | null>(null)
  const pkg = pub.package
  const theme = ((pkg?.theme ?? 'none') as ThemeId) in THEME_TINT ? ((pkg?.theme ?? 'none') as ThemeId) : 'none'
  const title = pub.title || 'A package for you'
  useDocumentTitle(`${title} · Andum`)

  const refreshOwned = useCallback(async () => {
    if (!pkg || s.status !== 'authed') return
    try {
      const v = await apiClient.package(pkg.id)
      setOwned(v.owner === s.accountId ? v : null)
    } catch { setOwned(null) }
  }, [pkg, s.status, s.accountId])
  useEffect(() => { void refreshOwned() }, [refreshOwned])

  const onAccepted = async () => {
    try { setPub(await apiClient.publicInvite(inviteId)) } catch { /* keep the old preview */ }
    await refreshOwned()
  }

  if (!pkg) {
    return <Unavailable kind="missing" />
  }
  const total = Object.entries(pkg.total_by_token)
  const expired = pub.accept_by_ms != null && pub.accept_by_ms < Date.now()
  const accepted = pkg.status === 'ACCEPTED'
  const reclaimed = pkg.status === 'RECLAIMED'

  return (
    <section className="!pt-[110px]" aria-labelledby="pl-title">
      <div className="mx-auto grid max-w-[560px] gap-6">
        <div className="relative grid justify-items-center gap-3 py-2 text-center" style={{ ['--tint' as string]: THEME_TINT[theme] }}>
          <div className="absolute h-[190px] w-[190px] rounded-full" style={{ background: 'radial-gradient(closest-side, var(--tint), transparent)' }} aria-hidden="true" />
          <ThemeArt theme={theme} className="relative h-[84px] w-[84px]" />
          <div className="mono relative">Package #{pkg.id} · Andum</div>
        </div>
        <div className="text-center">
          <h1 id="pl-title" className="text-balance text-[clamp(34px,8vw,54px)]">{title}</h1>
          <p className="lede mx-auto mt-3.5">Someone sent you a package. The money is already in it. Each part opens on its own terms.</p>
        </div>

        {owned ? (
          <Owned pkg={owned} onChange={refreshOwned} />
        ) : (
          <>
            <div className="rounded-2xl border border-line bg-card px-4 py-1" role="list" aria-label="Parts">
              {pkg.parts.map((p, i) => (
                <div key={i} role="listitem" className="flex items-center justify-between gap-3 border-b border-line py-3.5 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <AssetIcon a={assetOf(p.token)} size={30} />
                    <div>
                      <div className="font-display text-[21px] tracking-[-.02em]">{fromBase(p.amount)} <small className="text-sm text-muted">{AS[assetOf(p.token)].u}</small></div>
                      <div className="text-[13px] text-muted">{ruleText(p)}</div>
                    </div>
                  </div>
                  <span className="chip wait">Locked</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm text-muted">
              <span>Inside</span>
              <b className="num font-medium text-fg">{total.map(([t, n]) => `${fromBase(n)} ${AS[assetOf(t)].u}`).join(' + ')}</b>
            </div>
            {pkg.has_note && <span className="chip info mx-auto">A note is waiting for you inside</span>}

            {reclaimed ? (
              <Notice kind="info">The sender took this package back because it was not accepted in time.</Notice>
            ) : accepted ? (
              <Notice kind="info">This package was already accepted. {s.status === 'authed' ? 'It is held by another account.' : 'If it is yours, sign in with the email it was sent to.'}</Notice>
            ) : expired ? (
              <Notice>This invite has expired. Ask the sender to send a new package.</Notice>
            ) : (
              <AcceptPanel inviteId={inviteId} emailHint={pub.email_hint} acceptBy={pub.accept_by_ms} onAccepted={onAccepted} />
            )}
            {accepted && s.status !== 'authed' && <Card><SignIn cta="Sign in to see my package" /></Card>}
          </>
        )}
        <p className="text-center text-[13px] text-faint">Andum pays the network fee. Everything here runs on NEAR testnet with test money.</p>
      </div>
    </section>
  )
}

type Phase = 'idle' | 'signin' | 'otp' | 'accepting'

function AcceptPanel({ inviteId, emailHint, acceptBy, onAccepted }: { inviteId: string; emailHint: string; acceptBy: number | null; onAccepted: () => Promise<void> }) {
  const s = useSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useCountdown(0)
  const [tx, setTx] = useState<string | undefined>()

  async function sendInviteCode() {
    setErr(null); setBusy(true)
    try { const r = await apiClient.verifyStart(inviteId); setWait(r.resend_after_s); setPhase('otp') }
    catch (e) {
      if (e instanceof ApiError && typeof e.details.resend_after_s === 'number') { setWait(e.details.resend_after_s); setPhase('otp') }
      setErr(errorText(e))
    } finally { setBusy(false) }
  }

  const start = () => (s.status === 'authed' ? sendInviteCode() : setPhase('signin'))

  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setErr(null)
    const c = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(c)) { setErr('The code has 6 digits.'); return }
    setBusy(true)
    try {
      const secret = await apiClient.verifyConfirm(inviteId, c)
      setPhase('accepting')
      const r = await s.call({ receiver: NEAR_CORE, method: 'accept_package', args: { package_id: secret.package_id, invite_secret: secret.invite_secret }, gas: 150n * TGAS, purpose: 'accept' })
      setTx(r.tx_hash)
      await onAccepted()
    } catch (x) {
      setErr(errorText(x)); setPhase('otp')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3" data-phase={phase}>
      {phase === 'idle' && (
        <>
          <Btn className="w-full justify-center" onClick={start} busy={busy} busyLabel="Opening…">Accept package <span className="arr">→</span></Btn>
          {err && <Notice>{err}</Notice>}
          <Link className="btn ghost w-full justify-center" to="/">What is Andum?</Link>
          <p className="text-center text-[13px] text-faint">You will confirm with a code sent to {emailHint}.{acceptBy ? ` Accept by ${fmtDate(new Date(acceptBy))}.` : ''}</p>
        </>
      )}
      {phase === 'signin' && (
        <Card>
          <h2 className="mb-1 font-display text-[22px]">First, sign in</h2>
          <p className="mb-4 text-[14px] text-muted">Use the email this package was sent to ({emailHint}). Your account is created in this browser.</p>
          <SignIn cta="Send me a sign-in code" onDone={sendInviteCode} />
        </Card>
      )}
      {(phase === 'otp' || phase === 'accepting') && (
        <Card>
          <form onSubmit={confirm} className="grid gap-3.5" noValidate>
            <h2 className="font-display text-[22px]">Confirm the invite</h2>
            <p className="text-[14px] text-muted">We sent a second code to {emailHint}. It releases the key that opens this package.</p>
            <Field group label="Invite code" hint="Six digits, sent to your email.">
              <OtpInput label="Invite code" value={code} onChange={(v) => { setCode(v); setErr(null) }} disabled={busy} invalid={!!err} />
            </Field>
            {err && <Notice>{err}</Notice>}
            <Btn className="justify-center" busy={busy} busyLabel={phase === 'accepting' ? 'Accepting on NEAR…' : 'Checking…'}>Accept package</Btn>
            <button type="button" className="text-[13px] text-muted underline-offset-2 hover:underline disabled:opacity-50" disabled={wait > 0 || busy} onClick={sendInviteCode}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button>
            <TxLink hash={tx} />
          </form>
        </Card>
      )}
    </div>
  )
}

function Owned({ pkg, onChange }: { pkg: PackageView; onChange: () => Promise<void> }) {
  const s = useSession()
  const [busy, setBusy] = useState<number | null>(null)
  const [errs, setErrs] = useState<Record<number, string | undefined>>({})
  const [txs, setTxs] = useState<Record<number, string | undefined>>({})

  // Parts open by the clock and by approvals: keep the view fresh.
  useEffect(() => {
    const t = setInterval(() => { void onChange() }, 6000)
    return () => clearInterval(t)
  }, [onChange])

  async function take(partId: number) {
    setBusy(partId); setErrs((e) => ({ ...e, [partId]: undefined }))
    try {
      const r = await s.call({ receiver: NEAR_CORE, method: 'claim', args: { package_id: pkg.id, part_id: partId }, purpose: 'claim' })
      setTxs((t) => ({ ...t, [partId]: r.tx_hash }))
      await onChange()
    } catch (x) { setErrs((e) => ({ ...e, [partId]: errorText(x) })) }
    finally { setBusy(null) }
  }

  const taken = pkg.parts.filter((p) => p.state === 'TAKEN').length
  return (
    <div className="grid gap-4" data-owned="true">
      <Notice kind="ok">This package is yours. {taken} of {pkg.parts.length} parts taken.</Notice>
      {pkg.note && <Card><div className="mono mb-1">A note for you</div><p className="text-[17px]">{pkg.note}</p></Card>}
      <PartsList parts={pkg.parts} error={errs} action={(p) => (
        p.state === 'TAKEN' ? <TxLink hash={txs[p.part_id]} /> :
        <Btn className="sm" disabled={busy !== null} busy={busy === p.part_id} busyLabel="Taking…" onClick={() => take(p.part_id)} aria-label={`Take part ${p.part_id + 1}`}>
          Take
        </Btn>
      )} />
      <p className="text-center text-[13px] text-faint">Taking a part that is not open yet is refused by the contract. Try it.</p>
    </div>
  )
}
