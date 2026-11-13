import { useRef, useState } from 'react'
import { apiClient, ApiError } from '@/lib/api'
import { NEAR_CORE, TGAS, tokenAccount } from '@/lib/chain'
import { buildDraft, emptyDraft, emptyPart, MAX_NOTE, MAX_PARTS, totalsByAsset, type Draft, type PartDraft, type Problems } from '@/lib/draft'
import { errorText } from '@/lib/errors'
import { THEMES, type ThemeId } from '@/lib/themes'
import type { ReactNode } from 'react'
import { Field, Notice, StepList, TxLink, inputCls, type StepState } from './ui'
import { useSession } from './Session'
import { assetFromKey, fromBase } from '@/lib/money'
import { AS, AssetIcon } from '@/lib/assets'

/** Starting points set only HOW each part opens. They never choose an asset or an amount. */
const STARTS: Array<{ id: string; name: string; rules: Array<{ dated: boolean; approvalRequired?: boolean }> }> = [
  { id: 'single', name: 'One part', rules: [{ dated: false }] },
  { id: 'now-later', name: 'Now and later', rules: [{ dated: false }, { dated: true }] },
  { id: 'milestones', name: 'Milestones', rules: [{ dated: false }, { dated: true, approvalRequired: true }] },
  { id: 'vesting', name: 'Vesting', rules: [{ dated: true }, { dated: true }] },
]

const DRAFT_KEY = 'andum.package-draft.v1'

/** What a sender can put in a part, grouped so money, gold and stocks are easy to tell apart. */
export const ASSET_GROUPS: Array<[string, Array<[string, string]>]> = [
  ['Money', [['usdc', 'USDC · US dollar'], ['idrx', 'IDRX · Indonesian rupiah'], ['myr', 'MYR · Malaysian ringgit']]],
  ['Gold', [['xau', 'Gold (g) · tokenized gold']]],
  ['Stocks', [['aapl', 'AAPL · Apple'], ['nvda', 'NVDA · Nvidia'], ['pltr', 'PLTR · Palantir']]],
]

interface Run {
  invite?: { invite_id: string; invite_hash_b64: string }
  createTx?: string
  pkgId?: string
  funded: Set<number>
  attached?: boolean
  link?: string
}

const STEPS = ['Reserve the invite', 'Create the package on NEAR', 'Fund every part', 'Email the recipient', 'Set the link'] as const

export function Send({ balances, onDone, rail }: { balances: Record<string, string>; onDone: () => void; rail?: ReactNode }) {
  const s = useSession()
  const [d, setD] = useState<Draft>(emptyDraft)
  const [problems, setProblems] = useState<Problems | null>(null)
  const [step, setStep] = useState(-1)
  const [failed, setFailed] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<number, string>>({})
  const [link, setLink] = useState<string | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<string | null>(null)
  const run = useRef<Run>({ funded: new Set() })
  const built = useRef<ReturnType<typeof buildDraft> & { ok: true } | null>(null)
  const busy = step >= 0 && step < STEPS.length && failed === null

  const setPart = (i: number, p: Partial<PartDraft>) => setD((x) => ({ ...x, parts: x.parts.map((q, j) => (j === i ? { ...q, ...p } : q)) }))

  async function execute() {
    const b = built.current!.built
    const r = run.current
    let at = 0
    try {
      setErr(null); setFailed(null)
      at = 0; setStep(0)
      r.invite ??= await apiClient.createInvite(b.recipient_email)

      at = 1; setStep(1)
      if (!r.pkgId) {
        const before = BigInt((await apiClient.packages('sender')).items[0]?.id ?? '0')
        const created = await s.call({
          receiver: NEAR_CORE, method: 'create_package', gas: 30n * TGAS, purpose: 'create',
          // the contract method takes one parameter called `args`
          args: { args: { parts: b.args.parts.map(({ token_asset, ...p }) => ({ token: tokenAccount(token_asset), ...p })), accept_by_ns: b.args.accept_by_ns, invite_hash: r.invite.invite_hash_b64, theme: b.args.theme, note: b.args.note } },
        }, (st) => setDetail((x) => ({ ...x, 1: st.toLowerCase() })))
        r.createTx = created.tx_hash
        for (let i = 0; i < 40 && !r.pkgId; i++) {
          const top = (await apiClient.packages('sender')).items[0]
          if (top && BigInt(top.id) > before) r.pkgId = top.id
          else await new Promise((res) => setTimeout(res, 1500))
        }
        if (!r.pkgId) throw new Error('The package was created but is not visible yet. Retry in a moment.')
      }

      at = 2; setStep(2)
      for (let i = 0; i < b.args.parts.length; i++) {
        if (r.funded.has(i)) continue
        setDetail((x) => ({ ...x, 2: `part ${i + 1} of ${b.args.parts.length}` }))
        await s.call({ receiver: tokenAccount(b.args.parts[i].token_asset), method: 'ft_transfer_call', deposit: 1n, gas: 80n * TGAS, purpose: 'fund',
          args: { receiver_id: NEAR_CORE, amount: b.args.parts[i].amount, msg: JSON.stringify({ package_id: r.pkgId, part_id: i }) } })
        r.funded.add(i)
      }

      at = 3; setStep(3)
      if (!r.attached) { await apiClient.attach(r.invite.invite_id, r.pkgId!, r.createTx ?? 'unknown'); r.attached = true }

      at = 4; setStep(4)
      if (!r.link) {
        const p = await apiClient.linkPatch(r.invite.invite_id, { ...(b.slug ? { slug: b.slug } : {}), ...(b.title ? { title: b.title } : {}) })
        r.link = p.url
      }
      setLink(r.link); setStep(STEPS.length); onDone()
    } catch (e) {
      setFailed(at); setErr(errorText(e))
      // a taken link name is the one failure the sender fixes in the form, not by retrying
      if (e instanceof ApiError && e.code === 'SLUG_TAKEN') setProblems({ form: { slug: errorText(e) + (e.details.suggestion ? ` Try “${e.details.suggestion}”.` : '') }, parts: [] })
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = buildDraft(d, Date.now())
    if (!r.ok) { setProblems(r.problems); return }
    const need = totalsByAsset(r.built.args.parts)
    const short = Object.entries(need).find(([a, n]) => BigInt(balances[a] ?? '0') < n)
    if (short) { setProblems({ form: { balance: `You have ${fromBase(balances[short[0]] ?? '0')} ${short[0].toUpperCase()} but this package needs ${fromBase(short[1].toString())}. Get test tokens above first.` }, parts: [] }); return }
    setProblems(null); built.current = r; run.current = { funded: new Set() }; void execute()
  }

  function reset() { setD(emptyDraft()); setTemplate(null); setStep(-1); setFailed(null); setErr(null); setLink(null); setDetail({}); run.current = { funded: new Set() } }

  /** Set how each part opens and keep whatever asset and amount the sender already chose. */
  function applyStart(id: string) {
    const start = STARTS.find((x) => x.id === id)
    if (!start) return
    setTemplate(id)
    setProblems(null)
    setD((cur) => ({
      ...cur,
      parts: start.rules.map((r, i) => {
        const was = cur.parts[i] ?? emptyPart(cur.parts[0]?.asset)
        return { ...was, dated: r.dated, date: r.dated ? was.date : '', approvalRequired: !!r.approvalRequired, approvers: r.approvalRequired ? was.approvers : '', threshold: '1' }
      }),
    }))
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ d, template, savedAt: Date.now() }))
      setDraftStatus('Draft saved on this device')
    } catch {
      setDraftStatus('This browser could not save the draft')
    }
  }

  function restoreDraft() {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (!saved) { setDraftStatus('No saved draft on this device'); return }
      const parsed = JSON.parse(saved) as { d?: Draft; template?: string | null }
      if (!parsed.d || !Array.isArray(parsed.d.parts)) throw new Error('invalid draft')
      setD(parsed.d); setTemplate(parsed.template ?? null); setDraftStatus('Saved draft restored')
    } catch {
      setDraftStatus('The saved draft could not be restored')
    }
  }

  if (step >= 0) {
    const states: StepState[] = STEPS.map((_, i) => (failed === i ? 'fail' : i < step || step === STEPS.length ? 'done' : i === step && failed === null ? 'doing' : 'todo'))
    return (
      <div className="ws-grid">
        <section className="ws-card grid gap-5" aria-label="Sending status">
          <h2 className="ws-h" style={{ margin: 0 }}>{link ? 'Package sent' : 'Sending your package'}</h2>
          <StepList steps={STEPS.map((label, i) => ({ label, state: states[i], extra: detail[i] && states[i] === 'doing' ? <span className="text-[13px] text-muted">{detail[i]}</span> : i === 1 && run.current.createTx && states[i] === 'done' ? <TxLink hash={run.current.createTx} /> : null }))} />
          {err && <Notice>{err}</Notice>}
          {failed !== null && (
            <div className="flex gap-3">
              <button className="btn" onClick={() => void execute()}>Try again</button>
              <button className="btn ghost" onClick={reset}>Start over</button>
            </div>
          )}
          {link && (
            <div className="grid gap-3" data-done="true">
              <Notice kind="ok">Package #{run.current.pkgId} is funded. The recipient has been emailed.</Notice>
              <Field label="Recipient link"><input className={inputCls + ' ws-in text-[14px] normal-case tracking-normal'} readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Package link" /></Field>
              <p className="text-[13px] text-muted">Keep this link if you need to send it again. The recipient opens it from their email.</p>
              <div className="flex flex-wrap gap-3">
                <button className="btn" onClick={() => void navigator.clipboard?.writeText(link)}>Copy link</button>
                <button className="btn ghost" onClick={reset}>Send another</button>
              </div>
            </div>
          )}
          {busy && <p className="text-[13px] text-faint">Signing in your browser. Andum pays the network fee. Keep this tab open.</p>}
        </section>
        <div className="ws-rail">{rail}</div>
      </div>
    )
  }

  const pe = (i: number, k: string) => problems?.parts[i]?.[k]
  const startNote = STARTS.find((x) => x.id === template)
  return (
    <form onSubmit={submit} className="ws-grid" noValidate aria-label="New package">
      <div className="ws-card">
        <section className="ws-section" aria-label="Recipient">
          <h2 className="ws-h">Who is it for?</h2>
          <div className="ws-fields">
            <Field label="Recipient email" error={problems?.form.email} help="Andum emails this person a link. They can see what is inside before they accept, and they do not need a crypto wallet."><input className={inputCls + ' ws-in'} type="email" autoComplete="off" placeholder="Their email address" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} aria-label="Recipient email" /></Field>
          </div>
        </section>

        <section className="ws-section" aria-label="Parts">
          <h2 className="ws-h">What opens, and when? <small>{d.parts.length} of {MAX_PARTS} parts</small></h2>
          <div className="ws-starts" role="group" aria-label="Starting points">
            <span>Start from</span>
            {STARTS.map((x) => <button type="button" key={x.id} className="ws-chip" aria-pressed={template === x.id} onClick={() => applyStart(x.id)}>{x.name}</button>)}
            {startNote && <span aria-live="polite">Sets how parts open. Assets and amounts stay yours.</span>}
          </div>
          {d.parts.map((p, i) => (
            <fieldset key={i} className="ws-part" aria-label={`Part ${i + 1}`}>
              <div className="ws-part-head"><span>Part {i + 1}</span>{d.parts.length > 1 && <button type="button" className="ws-link" onClick={() => { setTemplate(null); setD({ ...d, parts: d.parts.filter((_, j) => j !== i) }) }}>Remove</button>}</div>
              <div className="ws-two">
                <Field label="Asset"><div className="asel"><AssetIcon a={assetFromKey(p.asset)} size={22} /><select className={inputCls + ' ws-in appearance-none pl-11'} value={p.asset} onChange={(e) => setPart(i, { asset: e.target.value })} aria-label={`Part ${i + 1} asset`}>{ASSET_GROUPS.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</optgroup>)}</select></div></Field>
                <Field label="Amount" error={pe(i, 'amount')}><input className={inputCls + ' ws-in'} inputMode="decimal" placeholder="0" value={p.amount} onChange={(e) => setPart(i, { amount: e.target.value })} aria-label={`Part ${i + 1} amount`} /></Field>
              </div>
              <label className="ws-check"><input type="checkbox" checked={p.dated} onChange={(e) => { setTemplate(null); setPart(i, { dated: e.target.checked, approvalRequired: e.target.checked ? p.approvalRequired : false, approvers: e.target.checked ? p.approvers : '' }) }} aria-label={`Part ${i + 1} opens on a date`} /><span><b>Release on a date</b><small>Otherwise it opens as soon as they accept.</small></span></label>
              {p.dated && (
                <>
                  <Field label="Opens at" help="Until this date and time the part stays locked. The recipient can already see it, but cannot take it." error={pe(i, 'date')}><input className={inputCls + ' ws-in'} type="datetime-local" value={p.date} onChange={(e) => setPart(i, { date: e.target.value })} aria-label={`Part ${i + 1} date`} /></Field>
                  <label className="ws-check"><input type="checkbox" checked={p.approvalRequired} onChange={(e) => { setTemplate(null); setPart(i, { approvalRequired: e.target.checked, approvers: e.target.checked ? p.approvers : '' }) }} aria-label={`Part ${i + 1} requires approval`} /><span><b>Require approval before release</b><small>Approvers confirm after the date arrives.</small></span></label>
                  {p.approvalRequired && <div className="ws-two">
                    <Field label="Approvers" help="People who must say yes before the part opens. Add their NEAR account, which they can copy from the top of their own Andum app. Up to 5." error={pe(i, 'approvers')} hint="NEAR accounts, separated by commas"><input className={inputCls + ' ws-in'} placeholder="account1, account2" value={p.approvers} onChange={(e) => setPart(i, { approvers: e.target.value })} aria-label={`Part ${i + 1} approvers`} /></Field>
                    <Field label="Approvals needed" help="How many of the approvers must confirm. For example 1 means any one of them is enough." error={pe(i, 'threshold')}><input className={inputCls + ' ws-in'} inputMode="numeric" value={p.threshold} onChange={(e) => setPart(i, { threshold: e.target.value })} aria-label={`Part ${i + 1} approvals needed`} /></Field>
                  </div>}
                </>
              )}
              {pe(i, 'approvers') && !p.dated && <Notice>{pe(i, 'approvers')}</Notice>}
            </fieldset>
          ))}
          {problems?.form.parts && <div className="mt-3"><Notice>{problems.form.parts}</Notice></div>}
          <button type="button" className="ws-add" disabled={d.parts.length >= MAX_PARTS} onClick={() => { setTemplate(null); setD({ ...d, parts: [...d.parts, emptyPart(d.parts[d.parts.length - 1]?.asset)] }) }}>+ Add a part</button>
        </section>

        <section className="ws-section" aria-label="Make it theirs">
          <h2 className="ws-h">Make it theirs <small>Optional</small></h2>
          <div className="ws-fields">
            <div className="ws-two">
              <Field label="Title (optional)" error={problems?.form.title}><input className={inputCls + ' ws-in'} placeholder="Your audit bonus" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Title" /></Field>
              <Field label="Link name (optional)" error={problems?.form.slug} hint="andum link: /p/your-name" help="A short, readable name for the link you send, like /p/rina-audit-bonus. Leave it empty and Andum makes one."><input className={inputCls + ' ws-in'} placeholder="rina-audit-bonus" value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })} aria-label="Link name" /></Field>
            </div>
            <Field label="Note (shown after they accept)" help="A personal message. The recipient reads it after they accept the package." error={problems?.form.note} hint={`${d.note.length}/${MAX_NOTE}`}><textarea className={inputCls + ' ws-in'} rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} aria-label="Note" /></Field>
            <div className="ws-two">
              <Field label="Opening moment" help="The little animation the recipient sees when they open the package. It changes the look only, not the rules."><select className={inputCls + ' ws-in'} value={d.theme} onChange={(e) => setD({ ...d, theme: e.target.value as ThemeId })} aria-label="Theme">{THEMES.map((t) => <option key={t.id} value={t.id}>{t.n}</option>)}</select></Field>
              <Field label="They must accept within (hours)" help="If they have not accepted by then, you can take everything back from the Sent tab. Up to 720 hours (30 days)." error={problems?.form.acceptHours}><input className={inputCls + ' ws-in'} inputMode="numeric" value={d.acceptHours} onChange={(e) => setD({ ...d, acceptHours: e.target.value })} aria-label="Accept within hours" /></Field>
            </div>
          </div>
        </section>
      </div>

      <div className="ws-rail">
        <Summary d={d} balances={balances} balanceError={problems?.form.balance}>
          <button className="ws-send">Create and send <span aria-hidden="true">→</span></button>
          <div className="ws-draft">
            <button type="button" className="ws-link" onClick={saveDraft}>Save draft</button>
            <button type="button" className="ws-link" onClick={restoreDraft}>Restore draft</button>
            {draftStatus && <span role="status">{draftStatus}</span>}
          </div>
        </Summary>
        {rail}
      </div>
    </form>
  )
}

const SYMBOL = (key: string) => AS[assetFromKey(key)].u

function whenText(p: PartDraft): string {
  if (!p.dated) return 'When they accept'
  const t = Date.parse(p.date)
  const day = Number.isFinite(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'a date (not set yet)'
  return `On ${day}${p.approvalRequired ? ' · after approval' : ''}`
}

/** The package as it is being built, and what is still missing. Reads the same validation the contract call uses. */
export function Summary({ d, balances, balanceError, children }: { d: Draft; balances: Record<string, string>; balanceError?: string; children?: ReactNode }) {
  const r = buildDraft(d, Date.now())
  const filled = d.parts.filter((p) => Number(p.amount) > 0).length
  const datedNoDate = d.parts.some((p) => p.dated && !Number.isFinite(Date.parse(p.date)))
  const needsApprovers = d.parts.some((p) => p.approvalRequired && p.approvers.trim().length === 0)
  const hasEmail = /\S+@\S+\.\S+/.test(d.email.trim())
  const need = r.ok ? totalsByAsset(r.built.args.parts) : null
  const short = need ? Object.entries(need).find(([a, n]) => BigInt(balances[a] ?? '0') < n) : undefined
  const todo: Array<{ text: string; done: boolean; bad?: boolean }> = [
    { text: hasEmail ? 'Recipient set' : 'Add the recipient’s email', done: hasEmail },
    { text: filled === d.parts.length ? `${filled === 1 ? 'Amount' : 'Amounts'} set` : 'Enter an amount for every part', done: filled === d.parts.length },
    ...(d.parts.some((p) => p.dated) ? [{ text: datedNoDate ? 'Pick a date for every dated part' : 'Release dates set', done: !datedNoDate }] : []),
    ...(d.parts.some((p) => p.approvalRequired) ? [{ text: needsApprovers ? 'Add approvers where approval is required' : 'Approvers set', done: !needsApprovers }] : []),
    ...(short ? [{ text: `You need ${fromBase(short[1].toString())} ${SYMBOL(short[0])} and have ${fromBase(balances[short[0]] ?? '0')}. Use “+ Get” below.`, done: false, bad: true }] : need ? [{ text: 'Your balance covers it', done: true }] : []),
  ]
  const left = todo.filter((t) => !t.done).length
  const title = d.title.trim() || (hasEmail ? d.email.trim() : 'New package')
  return (
    <section className="ws-card ws-card--tight" aria-label="Package summary">
      <h2 className="ws-sum-title">{title}</h2>
      <p className="ws-sum-sub" role="status">{left === 0 ? 'Ready to send' : `${left} ${left === 1 ? 'thing' : 'things'} left before you can send`}</p>
      <ul className="ws-sum-parts" aria-label="Parts in this package">
        {d.parts.map((p, i) => (
          <li key={i} className="ws-sum-part">
            <AssetIcon a={assetFromKey(p.asset)} size={20} />
            <span className={`ws-sum-amt num${p.amount ? '' : ' is-empty'}`}>{p.amount || 'Amount'} {SYMBOL(p.asset)}</span>
            {!p.dated ? <span className="ws-sum-now">Opens at once</span> : <span />}
            <span className="ws-sum-rule">{whenText(p)}</span>
          </li>
        ))}
      </ul>
      {need && <div className="ws-total"><span>Total</span><b className="num">{Object.entries(need).map(([a, n]) => `${fromBase(n.toString())} ${SYMBOL(a)}`).join(' + ')}</b></div>}
      <ul className="ws-todo" aria-label="What is left">{todo.map((t) => <li key={t.text} data-done={t.done} data-bad={t.bad || undefined}>{t.text}</li>)}</ul>
      {balanceError && <div className="mb-3"><Notice>{balanceError}</Notice></div>}
      {children}
    </section>
  )
}
