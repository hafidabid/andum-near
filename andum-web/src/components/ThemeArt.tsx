import type { ThemeId } from '@/lib/themes'

const ART: Record<ThemeId, React.ReactNode> = {
  none: (
    <>
      <circle cx="16" cy="16" r="10" fill="none" stroke="#8F9AAD" strokeWidth="2" />
      <path d="M9 23L23 9" stroke="#8F9AAD" strokeWidth="2" />
    </>
  ),
  confetti: (
    <>
      <rect x="6" y="8" width="5" height="9" rx="1.5" fill="#6FE3C1" transform="rotate(-20 8 12)" />
      <rect x="14" y="5" width="5" height="9" rx="1.5" fill="#F2B661" transform="rotate(15 16 9)" />
      <rect x="21" y="11" width="5" height="9" rx="1.5" fill="#8DB1FF" transform="rotate(30 23 15)" />
      <circle cx="10" cy="24" r="2.5" fill="#F28B93" />
      <circle cx="22" cy="25" r="2" fill="#EBEFF6" />
    </>
  ),
  gift: (
    <>
      <rect x="5" y="13" width="22" height="14" rx="2" fill="#8DB1FF" />
      <rect x="4" y="9" width="24" height="5" rx="2" fill="#A9C4FF" />
      <rect x="14.5" y="9" width="3" height="18" fill="#F2B661" />
      <path d="M16 9C13 3 8 5 10 8c1 1.5 4 1 6 1zM16 9c3-6 8-4 6-1-1 1.5-4 1-6 1z" fill="#F2B661" />
    </>
  ),
  balloons: (
    <>
      <ellipse cx="11" cy="12" rx="6" ry="7.5" fill="#F28B93" />
      <ellipse cx="21" cy="10" rx="5.5" ry="7" fill="#6FE3C1" />
      <path d="M11 19.5c0 4 4 4 5 8M21 17c0 5-3 6-5 10.5" stroke="#8F9AAD" strokeWidth="1.2" fill="none" />
    </>
  ),
  hearts: (
    <path d="M16 27s-10-6.2-12.5-12.3C1.8 10.6 4.8 6 9.4 6c2.7 0 4.7 1.4 6.6 4 1.9-2.6 3.9-4 6.6-4 4.6 0 7.6 4.6 5.9 8.7C26 20.8 16 27 16 27z" fill="#F28B93" />
  ),
  gold: (
    <>
      <path d="M16 3l3.2 9.8L29 16l-9.8 3.2L16 29l-3.2-9.8L3 16l9.8-3.2z" fill="#F2B661" />
      <circle cx="26" cy="6" r="2" fill="#FFE3A8" />
    </>
  ),
}

/** The small illustration for an opening-moment theme. */
export function ThemeArt({ theme, className }: { theme: ThemeId; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={`${theme} theme`}>
      {ART[theme]}
    </svg>
  )
}
