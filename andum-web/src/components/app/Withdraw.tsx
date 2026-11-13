import { useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api'
import { isRegistered, STORAGE_DEPOSIT, TGAS, tokenAccount } from '@/lib/chain'
import { AS, AssetIcon } from '@/lib/assets'
import { errorText } from '@/lib/errors'
import { assetFromKey, baseToInput, fromBase } from '@/lib/money'
import { checkWithdraw, type WithdrawDraft } from '@/lib/withdraw'
import { ASSET_GROUPS } from './Send'
import { LABEL } from './Wallet'
import { Field, Notice, StepList, TxLink, inputCls, type StepState } from './ui'
import { useSession } from './Session'

const SYMBOL = (k: string) => AS[assetFromKey(k)].u
const empty = (): WithdrawDraft => ({ asset: 'usdc', amount: '', to: '' })

/** Send an asset from your Andum account to any NEAR address: your own wallet, or someone else's. */
export function Withdraw({ balances, onDone, rail }: { balances: Record<string, string>; onDone: () => void; rail?: ReactNode }) {
  const s = useSession()
  const [d, setD] = useState<WithdrawDraft>(empty)
  const [problems, setProblems] = useState<{ to?: string; amount?: string } | null>(null)
  const [steps, setSteps] = useState<string[] | null>(null)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tx, setTx] = useState<string | null>(null)
  const [done, setDone] = useState<{ asset: string; amount: string; to: string } | null>(null)
  const last = useRef<{ asset: string; amountBase: string; to: string } | null>(null)
  const bal = BigInt(balances[d.asset] ?? '0')
  const live = checkWithdraw(d, { from: s.accountId ?? '', balances })

  async function run() {
    const w = last.current!
    setErr(null); setFailed(false)
    try {
      const needsRegister = !(await isRegistered(w.asset, w.to))
      const labels = needsRegister ? [`Set up the address to receive ${SYMBOL(w.asset)}`, `Send ${SYMBOL(w.asset)}`] : [`Send ${SYMBOL(w.asset)}`]
      setSteps(labels); setAt(0)
      if (needsRegister) {
        await s.call({ receiver: tokenAccount(w.asset), method: 'storage_deposit', args: { account_id: w.to, registration_only: true }, deposit: STORAGE_DEPOSIT, gas: 30n * TGAS, purpose: 'register' })
        setAt(1)
      }
      const out = await s.call({ receiver: tokenAccount(w.asset), method: 'ft_transfer', args: { receiver_id: w.to, amount: w.amountBase }, deposit: 1n, gas: 30n * TGAS, purpose: 'withdraw' })
      setTx(out.tx_hash ?? null); setAt(labels.length)
      setDone({ asset: w.asset, amount: fromBase(w.amountBase, 6), to: w.to }); onDone()
    } catch (e) {
      setFailed(true); setErr(e instanceof ApiError || e instanceof Error ? errorText(e) : 'Something went wrong')
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = checkWithdraw(d, { from: s.accountId ?? '', balances })
    if (!r.ok) { setProblems(r.problems); return }
    setProblems(null); last.current = r.built; void run()
  }
  function reset() { setD(empty()); setSteps(null); setFailed(false); setErr(null); setTx(null); setDone(null); setProblems(null) }

  if (steps) {
    const states: StepState[] = steps.map((_, i) => (failed && i === at ? 'fail' : i < at ? 'done' : i === at && !failed ? 'doing' : 'todo'))
    return (
      <div className="ws-grid">
        <section className="ws-card grid gap-5" aria-label="Withdrawal status">
          <h2 className="ws-h" style={{ margin: 0 }}>{done ? 'Sent' : 'Sending'}</h2>
          <StepList steps={steps.map((label, i) => ({ label, state: states[i] }))} />
          {err && <Notice>{err}</Notice>}
          {failed && <div className="flex gap-3"><button className="btn" onClick={() => void run()}>Try again</button><button className="btn ghost" onClick={reset}>Start over</button></div>}
          {done && (
            <div className="grid gap-3" data-done="true">
              <Notice kind="ok">{done.amount} {SYMBOL(done.asset)} was sent to {done.to}.</Notice>
              {tx && <p className="text-[14px] text-muted">Transaction: <TxLink hash={tx} /></p>}
              <div className="flex flex-wrap gap-3"><button className="btn" onClick={reset}>Send another</button></div>
            </div>
          )}
          {!done && !failed && <p className="text-[13px] text-faint">Signing in your browser. Andum pays the network fee. Keep this tab open.</p>}
        </section>
        <div className="ws-rail">{rail}</div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="ws-grid" noValidate aria-label="Withdraw">
      <div className="ws-card">
        <section className="ws-section" aria-label="What to send">
          <h2 className="ws-h">What do you want to send?</h2>
          <div className="ws-fields">
            <div className="ws-two">
              <Field label="Asset"><div className="asel"><AssetIcon a={assetFromKey(d.asset)} size={22} /><select className={inputCls + ' ws-in appearance-none pl-11'} value={d.asset} onChange={(e) => setD({ ...d, asset: e.target.value, amount: '' })} aria-label="Asset to withdraw">{ASSET_GROUPS.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</optgroup>)}</select></div></Field>
              <Field label="Amount" error={problems?.amount} hint={`Available: ${fromBase(balances[d.asset] ?? '0', 6)} ${SYMBOL(d.asset)}`}>
                <div className="ws-inline">
                  <input className={inputCls + ' ws-in'} inputMode="decimal" placeholder="0" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} aria-label="Amount to withdraw" />
                  <button type="button" className="ws-link" disabled={bal === 0n} onClick={(e) => { e.preventDefault(); setD({ ...d, amount: baseToInput(bal.toString()) }) }}>Max</button>
                </div>
              </Field>
            </div>
          </div>
        </section>
        <section className="ws-section" aria-label="Where to send it">
          <h2 className="ws-h">Where should it go?</h2>
          <Field label="NEAR address" error={problems?.to} help="Paste the address of the wallet that should receive it: a name like alice.testnet, or a 64-character hex address. Only NEAR testnet addresses work here. Check it twice, a transfer cannot be undone." hint="For example alice.testnet">
            <input className={inputCls + ' ws-in'} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="alice.testnet" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} aria-label="NEAR address" />
          </Field>
        </section>
      </div>
      <div className="ws-rail">
        <section className="ws-card ws-card--tight" aria-label="Withdrawal summary">
          <h2 className="ws-sum-title">{live.ok ? `${fromBase(live.built.amountBase, 6)} ${SYMBOL(d.asset)}` : `Send ${LABEL[d.asset]}`}</h2>
          <p className="ws-sum-sub" role="status">{live.ok ? 'Ready to send' : 'Fill in the amount and the address'}</p>
          <dl className="ws-facts">
            <div><dt>To</dt><dd>{d.to.trim() || '—'}</dd></div>
            <div><dt>Network</dt><dd>NEAR testnet</dd></div>
            <div><dt>Network fee</dt><dd>Paid by Andum</dd></div>
          </dl>
          <p className="ws-note">Transfers cannot be undone. If the address is new to this asset, Andum sets it up first using a small deposit (0.00125 NEAR) from your account.</p>
          <button className="ws-send">Send to this address <span aria-hidden="true">→</span></button>
        </section>
        {rail}
      </div>
    </form>
  )
}
