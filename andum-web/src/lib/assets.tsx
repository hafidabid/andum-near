import type { ReactNode } from 'react'
import { LOGO_PATHS } from './logoPaths'

export type AssetId = 'USDC' | 'IDRX' | 'MYR' | 'SGD' | 'THB' | 'EUR' | 'JPY' | 'GOLD' | 'AAPL' | 'NVDA' | 'PLTR' | 'TSLA'

export const ASSET_IDS: AssetId[] = ['USDC', 'IDRX', 'MYR', 'SGD', 'THB', 'EUR', 'JPY', 'GOLD', 'AAPL', 'NVDA', 'PLTR', 'TSLA']

/** u: unit shown after a number. n: full name. d: decimals shown. */
export const AS: Record<AssetId, { u: string; n: string; d: number }> = {
  USDC: { u: 'USDC', n: 'US dollar stablecoin', d: 2 },
  IDRX: { u: 'IDRX', n: 'Indonesian rupiah', d: 0 },
  MYR: { u: 'MYR', n: 'Malaysian ringgit', d: 2 },
  SGD: { u: 'SGD', n: 'Singapore dollar', d: 2 },
  THB: { u: 'THB', n: 'Thai baht', d: 2 },
  EUR: { u: 'EUR', n: 'Euro', d: 2 },
  JPY: { u: 'JPY', n: 'Japanese yen', d: 0 },
  GOLD: { u: 'g gold', n: 'Tokenized gold', d: 2 },
  AAPL: { u: 'AAPL', n: 'Apple Inc. stock', d: 0 },
  NVDA: { u: 'NVDA', n: 'Nvidia stock', d: 0 },
  PLTR: { u: 'PLTR', n: 'Palantir stock', d: 0 },
  TSLA: { u: 'TSLA', n: 'Tesla stock', d: 0 },
}

export function assetLabel(a: AssetId): string {
  return a === 'GOLD' ? 'Gold' : AS[a].u
}

const F = 'Funnel Sans,Arial,sans-serif'

function Wrap({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

function Logo({ path, color }: { path: string; color: string }) {
  return (
    <Wrap>
      <rect width="24" height="24" fill="#F4F6FA" />
      <g transform="translate(5 5) scale(.58)">
        <path d={path} fill={color} />
      </g>
    </Wrap>
  )
}

const STARS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2
  return { x: +(12 + 6.2 * Math.cos(a)).toFixed(2), y: +(12 + 6.2 * Math.sin(a)).toFixed(2) }
})

const GLYPHS: Record<AssetId, () => ReactNode> = {
  USDC: () => (
    <Wrap>
      <rect width="24" height="24" fill="#2775CA" />
      <text x="12" y="16.8" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily={F}>$</text>
    </Wrap>
  ),
  IDRX: () => (
    <Wrap>
      <rect width="24" height="12" fill="#E70011" />
      <rect y="12" width="24" height="12" fill="#F4F4F4" />
    </Wrap>
  ),
  MYR: () => (
    <Wrap>
      <rect width="24" height="24" fill="#F4F4F4" />
      <rect y="0" width="24" height="3.4" fill="#CC0001" />
      <rect y="6.8" width="24" height="3.4" fill="#CC0001" />
      <rect y="13.6" width="24" height="3.4" fill="#CC0001" />
      <rect y="20.4" width="24" height="3.6" fill="#CC0001" />
      <rect width="13" height="13.6" fill="#010066" />
      <circle cx="5.6" cy="6.8" r="3.5" fill="#FFCC00" />
      <circle cx="6.7" cy="6.8" r="2.9" fill="#010066" />
      <circle cx="9.3" cy="6.8" r="1" fill="#FFCC00" />
    </Wrap>
  ),
  SGD: () => (
    <Wrap>
      <rect width="24" height="12" fill="#EF3340" />
      <rect y="12" width="24" height="12" fill="#F4F4F4" />
      <circle cx="6.6" cy="6" r="3.5" fill="#F4F4F4" />
      <circle cx="7.9" cy="6" r="3" fill="#EF3340" />
      {[[10.4, 4], [12.2, 5.4], [11.5, 7.5], [9.3, 7.6], [9, 5.2]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r=".7" fill="#F4F4F4" />
      ))}
    </Wrap>
  ),
  THB: () => (
    <Wrap>
      <rect width="24" height="24" fill="#A51931" />
      <rect y="4" width="24" height="16" fill="#F4F5F8" />
      <rect y="8" width="24" height="8" fill="#2D2A4A" />
    </Wrap>
  ),
  EUR: () => (
    <Wrap>
      <rect width="24" height="24" fill="#003399" />
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="1.15" fill="#FFCC00" />
      ))}
    </Wrap>
  ),
  JPY: () => (
    <Wrap>
      <rect width="24" height="24" fill="#F4F4F4" />
      <circle cx="12" cy="12" r="5.8" fill="#BC002D" />
    </Wrap>
  ),
  GOLD: () => (
    <Wrap>
      <defs>
        <linearGradient id="gg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FBE9A6" />
          <stop offset="1" stopColor="#C9962B" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" fill="#2A2314" />
      <path d="M4 17.5l2.2-5.2h11.6l2.2 5.2z" fill="url(#gg)" />
      <path d="M7.6 12.3l1.7-4h5.4l1.7 4z" fill="#E8C35A" />
      <path d="M6.2 12.3h11.6" stroke="#9A6F14" strokeWidth=".7" />
    </Wrap>
  ),
  AAPL: () => <Logo path={LOGO_PATHS.apple} color="#111" />,
  NVDA: () => <Logo path={LOGO_PATHS.nvidia} color="#76B900" />,
  PLTR: () => <Logo path={LOGO_PATHS.palantir} color="#111" />,
  TSLA: () => <Logo path={LOGO_PATHS.tesla} color="#E31937" />,
}

/** Round asset badge: flag, logo or glyph. */
export function AssetIcon({ a, size = 24 }: { a: AssetId; size?: number }) {
  return (
    <span className="ai" style={{ ['--s' as string]: `${size}px` }} data-asset={a}>
      {GLYPHS[a]()}
    </span>
  )
}
