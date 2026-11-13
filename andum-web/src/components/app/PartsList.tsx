import type { ReactNode } from 'react'
import { AssetIcon, AS } from '@/lib/assets'
import type { PartView } from '@/lib/api'
import { assetOf, fromBase } from '@/lib/money'
import { partBadge, ruleText } from '@/lib/parts'
import { cx } from '@/lib/format'

export function Amount({ token, amount }: { token: string; amount: string }) {
  const a = assetOf(token)
  return <span className="font-display text-[21px] tracking-[-.02em]">{fromBase(amount, a === 'GOLD' ? 2 : 2)} <small className="text-sm text-muted">{AS[a].u}</small></span>
}

/** Parts of a package. `action` renders a button (or anything) per part. */
export function PartsList({ parts, action, error }: { parts: PartView[]; action?: (p: PartView) => ReactNode; error?: Record<number, string | undefined> }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-1" role="list" aria-label="Parts">
      {parts.map((p) => {
        const b = partBadge(p)
        return (
          <div key={p.part_id} role="listitem" data-part={p.part_id} data-status={p.state === 'TAKEN' ? 'TAKEN' : p.status} className="grid gap-2 border-b border-line py-3.5 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <AssetIcon a={assetOf(p.token)} size={30} />
                <div>
                  <Amount token={p.token} amount={p.amount} />
                  <div className="text-[13px] text-muted">{ruleText(p)}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={cx('chip', b.tone)}>{b.label}</span>
                {action?.(p)}
              </div>
            </div>
            {error?.[p.part_id] && <div role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-[13.5px] text-bad">{error[p.part_id]}</div>}
          </div>
        )
      })}
    </div>
  )
}
