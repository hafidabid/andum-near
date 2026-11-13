import { useRef, useState } from 'react'
import { apiClient, ApiError } from '@/lib/api'
import { NEAR_CORE, TGAS, tokenAccount } from '@/lib/chain'
import { buildDraft, emptyDraft, emptyPart, MAX_NOTE, MAX_PARTS, totalsByAsset, type Draft, type PartDraft, type Problems } from '@/lib/draft'
import { errorText } from '@/lib/errors'
import { THEMES, type ThemeId } from '@/lib/themes'
import { Card, Field, Notice, StepList, TxLink, inputCls, type StepState } from './ui'
import { useSession } from './Session'
import { assetFromKey, fromBase } from '@/lib/money'
import { AssetIcon } from '@/lib/assets'

/** What a sender can put in a part, grouped so money, gold and stocks are easy to tell apart. */
const ASSET_GROUPS: Array<[string, Array<[string, string]>]> = [
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

export function Send({ balances, onDone }: { balances: Record<string, string>; onDone: () => void }) {
  const s = useSession()
  const [d, setD] = useState<Draft>(emptyDraft)
  const [problems, setProblems] = useState<Problems | null>(null)
  const [step, setStep] = useState(-1)
  const [failed, setFailed] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<number, string>>({})
  const [link, setLink] = useState<string | null>(null)
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

  function reset() { setD(emptyDraft()); setStep(-1); setFailed(null); setErr(null); setLink(null); setDetail({}); run.current = { funded: new Set() } }

  if (step >= 0) {
    const states: StepState[] = STEPS.map((_, i) => (failed === i ? 'fail' : i < step || step === STEPS.length ? 'done' : i === step && failed === null ? 'doing' : 'todo'))
    return (
      <Card className="grid gap-5" >
        <div className="grid gap-1 border-b border-line pb-4">
          <span className="mono text-[11px]">Dispatch status</span>
          <h2 className="font-display text-[24px]">{link ? 'Package sent' : 'Sending your package'}</h2>
        </div>
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
            <Field label="Recipient link"><input className={inputCls + ' font-mono text-[14px] normal-case tracking-normal'} readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Package link" /></Field>
            <p className="text-[13px] text-muted">Keep this link if you need to send it again. The recipient opens it from their email.</p>
            <div className="flex flex-wrap gap-3">
              <button className="btn" onClick={() => void navigator.clipboard?.writeText(link)}>Copy link</button>
              <button className="btn ghost" onClick={reset}>Send another</button>
            </div>
          </div>
        )}
        {busy && <p className="text-[13px] text-faint">Signing in your browser. Andum pays the network fee. Keep this tab open.</p>}
      </Card>
    )
  }

  const pe = (i: number, k: string) => problems?.parts[i]?.[k]
  return (
    <form onSubmit={submit} className="grid gap-5" noValidate aria-label="New package">
      <Card className="grid gap-5">
        <div className="border-b border-line pb-4"><span className="mono text-[11px]">01 · Recipient</span><h2 className="mt-1 font-display text-[22px]">Who is it for?</h2></div>
        <Field label="Recipient email" error={problems?.form.email}><input className={inputCls} type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} aria-label="Recipient email" /></Field>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Title (optional)" error={problems?.form.title}><input className={inputCls} placeholder="Your audit bonus" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Title" /></Field>
          <Field label="Link name (optional)" error={problems?.form.slug} hint="andum link: /p/your-name"><input className={inputCls} placeholder="rina-audit-bonus" value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })} aria-label="Link name" /></Field>
        </div>
        <Field label="Note (shown after they accept)" error={problems?.form.note} hint={`${d.note.length}/${MAX_NOTE}`}><textarea className={inputCls} rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} aria-label="Note" /></Field>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Opening moment"><select className={inputCls} value={d.theme} onChange={(e) => setD({ ...d, theme: e.target.value as ThemeId })} aria-label="Theme">{THEMES.map((t) => <option key={t.id} value={t.id}>{t.n}</option>)}</select></Field>
          <Field label="Recipient must accept within (hours)" error={problems?.form.acceptHours}><input className={inputCls} inputMode="numeric" value={d.acceptHours} onChange={(e) => setD({ ...d, acceptHours: e.target.value })} aria-label="Accept within hours" /></Field>
        </div>
      </Card>

      <Card className="grid gap-5">
        <div className="flex items-end justify-between border-b border-line pb-4"><div><span className="mono text-[11px]">02 · Contents</span><h2 className="mt-1 font-display text-[22px]">Parts</h2></div><span className="text-[13px] text-muted">{d.parts.length} of {MAX_PARTS}</span></div>
        {d.parts.map((p, i) => (
          <fieldset key={i} className="part-form grid gap-4 rounded-xl border border-line p-4" aria-label={`Part ${i + 1}`}>
            <legend className="mono px-1 text-[11px]">Part {i + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asset"><div className="asel"><AssetIcon a={assetFromKey(p.asset)} size={22} /><select className={inputCls + ' appearance-none pl-11'} value={p.asset} onChange={(e) => setPart(i, { asset: e.target.value })} aria-label={`Part ${i + 1} asset`}>{ASSET_GROUPS.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</optgroup>)}</select></div></Field>
              <Field label="Amount" error={pe(i, 'amount')}><input className={inputCls} inputMode="decimal" placeholder="200" value={p.amount} onChange={(e) => setPart(i, { amount: e.target.value })} aria-label={`Part ${i + 1} amount`} /></Field>
            </div>
            <label className="dispatch-check"><input type="checkbox" checked={p.dated} onChange={(e) => setPart(i, { dated: e.target.checked, approvalRequired: e.target.checked ? p.approvalRequired : false, approvers: e.target.checked ? p.approvers : '' })} aria-label={`Part ${i + 1} opens on a date`} /><span><b>Release on a date</b><small>Otherwise it is available as soon as they accept.</small></span></label>
            {p.dated && (
              <>
                <Field label="Opens at" error={pe(i, 'date')}><input className={inputCls} type="datetime-local" value={p.date} onChange={(e) => setPart(i, { date: e.target.value })} aria-label={`Part ${i + 1} date`} /></Field>
                <label className="dispatch-check"><input type="checkbox" checked={p.approvalRequired} onChange={(e) => setPart(i, { approvalRequired: e.target.checked, approvers: e.target.checked ? p.approvers : '' })} aria-label={`Part ${i + 1} requires approval`} /><span><b>Require approval before release</b><small>Approvers confirm after the date arrives.</small></span></label>
                {p.approvalRequired && <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
                  <Field label="Approvers" error={pe(i, 'approvers')} hint="NEAR accounts, separated by commas"><input className={inputCls} placeholder="account1, account2" value={p.approvers} onChange={(e) => setPart(i, { approvers: e.target.value })} aria-label={`Part ${i + 1} approvers`} /></Field>
                  <Field label="Approvals needed" error={pe(i, 'threshold')}><input className={inputCls} inputMode="numeric" value={p.threshold} onChange={(e) => setPart(i, { threshold: e.target.value })} aria-label={`Part ${i + 1} approvals needed`} /></Field>
                </div>}
              </>
            )}
            {pe(i, 'approvers') && !p.dated && <Notice>{pe(i, 'approvers')}</Notice>}
            {d.parts.length > 1 && <button type="button" className="justify-self-end text-[13px] text-muted underline-offset-2 hover:underline" onClick={() => setD({ ...d, parts: d.parts.filter((_, j) => j !== i) })}>Remove part</button>}
          </fieldset>
        ))}
        {problems?.form.parts && <Notice>{problems.form.parts}</Notice>}
        <button type="button" className="btn ghost justify-self-start" disabled={d.parts.length >= MAX_PARTS} onClick={() => setD({ ...d, parts: [...d.parts, emptyPart()] })}>+ Add a part</button>
      </Card>

      {problems?.form.balance && <Notice>{problems.form.balance}</Notice>}
      <button className="btn justify-center">Create and send <span className="arr">→</span></button>
    </form>
  )
}

