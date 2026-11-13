import type { PartView } from './api'

export const nsToDate = (ns: string | null): Date | null => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)) : null)

export const fmtDate = (d: Date): string =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The rule of a part in words, from the data the public preview exposes. */
export function ruleText(p: { unlock_ns: string | null; approver_count?: number; approvers?: string[]; threshold: number }): string {
  const n = p.approver_count ?? p.approvers?.length ?? 0
  const d = nsToDate(p.unlock_ns)
  const when = d ? `Opens ${fmtDate(d)}` : 'Opens when you accept'
  if (!n) return when
  const ap = `${p.threshold} of ${n} approver${n > 1 ? 's' : ''} must approve`
  return d ? `${when} and ${ap}` : `Opens after ${ap}`
}

export interface PartBadge { label: string; tone: 'open' | 'wait' | 'info' | 'bad' | 'plain' }

/** Status chip for a part of an accepted package. */
export function partBadge(p: PartView): PartBadge {
  if (p.state === 'TAKEN') return { label: 'Taken', tone: 'info' }
  switch (p.status) {
    case 'OPEN': return { label: 'Ready', tone: 'open' }
    case 'WAITING_DATE': { const d = nsToDate(p.unlock_ns); return { label: d ? `Opens ${fmtDate(d)}` : 'Waiting for date', tone: 'wait' } }
    case 'WAITING_APPROVAL': return { label: `Needs approval ${p.approvals.length}/${p.threshold}`, tone: 'wait' }
    case 'WAITING_DATE_AND_APPROVAL': return { label: 'Waiting for date and approval', tone: 'wait' }
    default: return { label: p.status.toLowerCase().replace(/_/g, ' '), tone: 'plain' }
  }
}
