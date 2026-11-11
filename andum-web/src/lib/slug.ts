/** Rules for a custom link name (andum.app/p/<slug>). Mirrors the backend rules in the plan. */
export const SLUG_RESERVED = ['new', 'admin', 'api', 'help', 'app', 'p', 'assets', 'approve', 'packages', 'login']

export type SlugResult = { ok: true } | { ok: false; reason: 'SLUG_INVALID' | 'SLUG_RESERVED'; message: string }

export function slugify(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export function checkSlug(s: string): SlugResult {
  if (s.length < 3) return { ok: false, reason: 'SLUG_INVALID', message: 'Use at least 3 characters.' }
  if (s.length > 32) return { ok: false, reason: 'SLUG_INVALID', message: 'Use 32 characters or fewer.' }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) {
    return { ok: false, reason: 'SLUG_INVALID', message: 'Letters, numbers and single hyphens only.' }
  }
  if (SLUG_RESERVED.includes(s) || s.startsWith('andum')) {
    return { ok: false, reason: 'SLUG_RESERVED', message: 'That name is reserved.' }
  }
  return { ok: true }
}
