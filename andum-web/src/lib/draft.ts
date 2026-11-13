import { toBase } from './money'
import { checkSlug } from './slug'
import { THEMES, type ThemeId } from './themes'

export const MAX_PARTS = 8
export const MAX_APPROVERS = 5
export const MAX_NOTE = 140
export const MAX_TITLE = 60
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEAR_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/

export interface PartDraft {
  asset: string            // faucet/contract key: usdc, idrx, myr, xau, aapl, nvda, pltr
  amount: string
  dated: boolean
  date: string             // datetime-local value
  approvalRequired: boolean
  approvers: string        // comma or space separated NEAR accounts
  threshold: string
}
export interface Draft {
  email: string; title: string; note: string; theme: ThemeId; slug: string; acceptHours: string; parts: PartDraft[]
}

export const emptyPart = (asset = 'usdc'): PartDraft => ({ asset, amount: '', dated: false, date: '', approvalRequired: false, approvers: '', threshold: '1' })
export const emptyDraft = (): Draft => ({ email: '', title: '', note: '', theme: 'confetti', slug: '', acceptHours: '24', parts: [emptyPart()] })

export const splitApprovers = (s: string): string[] => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)

export interface Built {
  recipient_email: string
  title: string
  slug: string | null
  args: { parts: Array<{ token_asset: string; amount: string; unlock_ns?: string; approvers?: string[]; approval_threshold?: number }>; accept_by_ns: string; theme: ThemeId; note?: string }
}
export interface Problems { form: Record<string, string>; parts: Array<Record<string, string>> }

/** Check the form against the same rules as the contract, so mistakes show up before anything is signed. */
export function buildDraft(d: Draft, nowMs: number): { ok: true; built: Built } | { ok: false; problems: Problems } {
  const form: Record<string, string> = {}
  const parts: Array<Record<string, string>> = d.parts.map(() => ({}))
  const email = d.email.trim()
  if (!EMAIL.test(email)) form.email = 'Enter the recipient’s email address.'
  if (d.title.trim().length > MAX_TITLE) form.title = `Use ${MAX_TITLE} characters or fewer.`
  if (d.note.length > MAX_NOTE) form.note = `Use ${MAX_NOTE} characters or fewer.`
  if (!THEMES.some((t) => t.id === d.theme)) form.theme = 'Pick a theme.'
  const slug = d.slug.trim()
  if (slug) { const r = checkSlug(slug); if (!r.ok) form.slug = r.message }
  const hours = Number(d.acceptHours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) form.acceptHours = 'Choose 1 to 720 hours.'
  if (d.parts.length < 1) form.parts = 'Add at least one part.'
  if (d.parts.length > MAX_PARTS) form.parts = `A package has at most ${MAX_PARTS} parts.`

  const out: Built['args']['parts'] = []
  d.parts.forEach((p, i) => {
    const e = parts[i]
    const amount = toBase(p.amount)
    if (!amount) e.amount = 'Enter an amount above zero (up to 6 decimals).'
    let unlock: string | undefined
    if (p.dated) {
      const t = new Date(p.date).getTime()
      if (!p.date || Number.isNaN(t)) e.date = 'Pick a date and time.'
      else if (t <= nowMs + 60_000) e.date = 'The date must be in the future.'
      else if (t > nowMs + 366 * 864e5) e.date = 'The date is too far away.'
      else unlock = (BigInt(t) * 1_000_000n).toString()
    }
    const approvers = splitApprovers(p.approvers)
    let threshold: number | undefined
    if (p.approvalRequired && !approvers.length) e.approvers = 'Add at least one NEAR account that can approve this part.'
    if (approvers.length) {
      if (!p.dated) e.approvers = 'Approvers need a date. The part opens on the date and after approval.'
      else if (approvers.length > MAX_APPROVERS) e.approvers = `At most ${MAX_APPROVERS} approvers.`
      else if (new Set(approvers).size !== approvers.length) e.approvers = 'Each approver can be listed once.'
      else if (!approvers.every((a) => a.length >= 2 && a.length <= 64 && NEAR_ID.test(a))) e.approvers = 'Approvers are NEAR account names (they find theirs after signing in).'
      threshold = Number(p.threshold || '1')
      if (!e.approvers && (!Number.isInteger(threshold) || threshold < 1 || threshold > approvers.length)) e.threshold = `Choose 1 to ${approvers.length}.`
    }
    if (amount) out.push({ token_asset: p.asset, amount, ...(unlock ? { unlock_ns: unlock } : {}), ...(approvers.length ? { approvers, approval_threshold: threshold } : {}) })
  })

  if (Object.keys(form).length || parts.some((e) => Object.keys(e).length)) return { ok: false, problems: { form, parts } }
  return {
    ok: true,
    built: {
      recipient_email: email, title: d.title.trim(), slug: slug || null,
      args: { parts: out, accept_by_ns: (BigInt(nowMs + hours * 3_600_000) * 1_000_000n).toString(), theme: d.theme, ...(d.note.trim() ? { note: d.note.trim() } : {}) },
    },
  }
}

/** Total needed per asset, to compare with the balance before funding. */
export function totalsByAsset(parts: Built['args']['parts']): Record<string, bigint> {
  const t: Record<string, bigint> = {}
  for (const p of parts) t[p.token_asset] = (t[p.token_asset] ?? 0n) + BigInt(p.amount)
  return t
}
