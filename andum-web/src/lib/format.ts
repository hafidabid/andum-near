import { AS, type AssetId } from './assets'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Day zero of every timeline on the page (UTC). */
export const BASE_DAY = Date.UTC(2026, 10, 10)

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

/** "15 Nov" for a day offset from 10 Nov 2026. Fractions are floored. */
export function dlab(day: number): string {
  const d = new Date(BASE_DAY + Math.floor(day + 1e-6) * 864e5)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

export function fm(a: AssetId, n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: AS[a].d })
}

export function money(a: AssetId, n: number): string {
  return `${fm(a, n)} ${AS[a].u}`
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Ease-out cubic, used by number tweens. */
export function easeOutCubic(k: number): number {
  return 1 - Math.pow(1 - k, 3)
}

/** Ease in-out quad, used by the role demo's travelling dot. */
export function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
}
