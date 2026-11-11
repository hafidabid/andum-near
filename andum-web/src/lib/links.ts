import type { AssetId } from './assets'
import { checkSlug } from './slug'
import type { ThemeId } from './themes'

export interface LinkPart {
  a: AssetId
  amt: number
  opens: string
}

export interface DemoLink {
  slug: string
  from: string
  to: string
  title: string
  theme: ThemeId
  note?: string
  parts: LinkPart[]
}

/** Example links the public site can open. In the product these come from the API (GET /v1/links/{slug}). */
export const DEMO_LINKS: DemoLink[] = [
  {
    slug: 'rina-audit-bonus',
    from: 'Dewi',
    to: 'Rina',
    title: 'Your audit bonus',
    theme: 'confetti',
    note: 'Thanks for shipping the audit early. This one is on us.',
    parts: [
      { a: 'USDC', amt: 200, opens: 'Opens when you accept' },
      { a: 'USDC', amt: 800, opens: 'Opens 15 Nov, after Dewi approves' },
      { a: 'GOLD', amt: 1.5, opens: 'Opens 30 Nov' },
    ],
  },
  {
    slug: 'aina-birthday',
    from: 'Aina’s parents',
    to: 'Aina',
    title: 'Happy birthday, Aina',
    theme: 'gift',
    note: 'Open the rest when you graduate. So proud of you.',
    parts: [
      { a: 'MYR', amt: 500, opens: 'Opens 17 Nov' },
      { a: 'MYR', amt: 4500, opens: 'Opens 10 Dec, after her guardian approves' },
    ],
  },
]

export type LinkLookup =
  | { kind: 'found'; link: DemoLink }
  | { kind: 'unknown' }
  | { kind: 'invalid' }

export function lookupLink(slug: string | undefined): LinkLookup {
  const s = (slug ?? '').toLowerCase()
  if (!checkSlug(s).ok) return { kind: 'invalid' }
  const link = DEMO_LINKS.find((l) => l.slug === s)
  return link ? { kind: 'found', link } : { kind: 'unknown' }
}
