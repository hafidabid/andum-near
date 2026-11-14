import { useCallback, useEffect, useState } from 'react'
import { apiClient, type PackageView } from '@/lib/api'
import { NEAR_CORE, TGAS } from '@/lib/chain'
import { errorText } from '@/lib/errors'
import { Btn, Card, Notice, Spinner, TxLink } from './ui'
import { PartsList } from './PartsList'
import { useSession } from './Session'
import { cx } from '@/lib/format'

function usePackages(role: 'sender' | 'approver', version: number) {
  const [items, setItems] = useState<PackageView[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setItems((await apiClient.packages(role)).items); setErr(null) } catch (e) { setErr(errorText(e)) }
  }, [role])
  useEffect(() => { void load() }, [load, version])
  useEffect(() => { const t = setInterval(() => void load(), 8000); return () => clearInterval(t) }, [load])
  return { items, err, load }
}

const STATUS_TONE: Record<string, string> = { AWAITING_FUNDS: 'wait', FUNDED: 'info', ACCEPTED: 'open', RECLAIMED: 'plain' }
const STATUS_TEXT: Record<string, string> = { AWAITING_FUNDS: 'Awaiting funds', FUNDED: 'Waiting to be accepted', ACCEPTED: 'Accepted', RECLAIMED: 'Reclaimed' }

function Header({ p }: { p: PackageView }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><span className="font-display text-[20px]">Package #{p.id}</span> <span className="text-[13px] text-muted">{p.theme}</span></div>
      <span className={cx('chip', STATUS_TONE[p.status] ?? 'plain')}>{STATUS_TEXT[p.status] ?? p.status}</span>
    </div>
  )
}

export function Sent({ version, onChange }: { version: number; onChange: () => void }) {
  const s = useSession()
  const { items, err, load } = usePackages('sender', version)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string; tx?: string }>>({})

  async function reclaim(p: PackageView) {
    setBusy(p.id)
    try {
      const r = await s.call({ receiver: NEAR_CORE, method: 'reclaim_unaccepted', args: { package_id: p.id }, gas: 150n * TGAS, purpose: 'reclaim' })
      setMsg((m) => ({ ...m, [p.id]: { ok: true, text: 'Reclaimed. The money is back in your account.', tx: r.tx_hash } })); await load(); onChange()
    } catch (e) { setMsg((m) => ({ ...m, [p.id]: { ok: false, text: errorText(e) } })) } finally { setBusy(null) }
  }

  if (err) return <Notice>{err}</Notice>
  if (!items) return <div className="py-10 text-center"><Spinner /></div>
  if (!items.length) return <Card><p className="text-muted">You have not sent a package yet.</p></Card>
  return (
    <div className="grid gap-4">
      {items.map((p) => {
        const expired = p.status === 'FUNDED' && BigInt(p.accept_by_ns) / 1_000_000n < BigInt(Date.now())
        return (
          <Card key={p.id} className="grid gap-3" >
            <Header p={p} />
            <PartsList parts={p.parts} />
            {expired && <Btn className="ghost justify-self-start" busy={busy === p.id} busyLabel="Taking it back…" onClick={() => reclaim(p)}>Take it back (not accepted in time)</Btn>}
            {msg[p.id] && <Notice kind={msg[p.id].ok ? 'ok' : 'bad'}>{msg[p.id].text} <TxLink hash={msg[p.id].tx} /></Notice>}
          </Card>
        )
      })}
    </div>
  )
}

export function Approvals({ version }: { version: number }) {
  const s = useSession()
  const { items, err, load } = usePackages('approver', version)
  const [busy, setBusy] = useState<string | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [txs, setTxs] = useState<Record<string, string>>({})

  async function approve(pkg: string, part: number) {
    const k = `${pkg}:${part}`
    setBusy(k); setErrs((e) => ({ ...e, [k]: '' }))
    try {
      const r = await s.call({ receiver: NEAR_CORE, method: 'approve_part', args: { package_id: pkg, part_id: part }, gas: 30n * TGAS, purpose: 'approve' })
      setTxs((t) => ({ ...t, [k]: r.tx_hash ?? '' })); await load()
    } catch (e) { setErrs((m) => ({ ...m, [k]: errorText(e) })) } finally { setBusy(null) }
  }

  if (err) return <Notice>{err}</Notice>
  if (!items) return <div className="py-10 text-center"><Spinner /></div>
  if (!items.length) return <Card><p className="text-muted">Nothing is waiting for your approval. When someone names this account as an approver, their package shows up here.</p></Card>
  return (
    <div className="grid gap-4">
      {items.map((p) => (
        <Card key={p.id} className="grid gap-3">
          <Header p={p} />
          <PartsList
            parts={p.parts.filter((x) => x.approvers.includes(s.accountId!))}
            error={Object.fromEntries(p.parts.map((x) => [x.part_id, errs[`${p.id}:${x.part_id}`] || undefined]))}
            action={(x) => {
              const k = `${p.id}:${x.part_id}`
              if (x.approvals.includes(s.accountId!)) return <span className="text-[13px] text-open">You approved {txs[k] && <TxLink hash={txs[k]} />}</span>
              if (x.state === 'TAKEN') return null
              return <Btn className="sm" disabled={busy !== null} busy={busy === k} busyLabel="Approving…" onClick={() => approve(p.id, x.part_id)} aria-label={`Approve part ${x.part_id + 1} of package ${p.id}`}>Approve</Btn>
            }}
          />
        </Card>
      ))}
    </div>
  )
}
