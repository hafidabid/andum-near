export function LockIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8.5" width="12" height="7.5" rx="2" />
      <path className="sh" d="M6 8.5V6a3 3 0 016 0v2.5" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.5l2.5 2.5L10 3.5" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 1.5v11l9-5.5z" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="1.5" width="3" height="11" rx="1" />
      <rect x="8.5" y="1.5" width="3" height="11" rx="1" />
    </svg>
  )
}

export function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="2" />
      <path d="M2.6 4.6L8 8.6l5.4-4" />
    </svg>
  )
}

export function NearMark({ size = 26 }: { size?: number }) {
  return (
    <span className="ai" style={{ ['--s' as string]: `${size}px` }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" fill="#EBEFF6" />
        <rect x="8" y="3" width="13" height="5" rx="2" fill="#6FE3C1" />
        <rect x="3" y="9.5" width="13" height="5" rx="2" fill="#0A0F16" />
        <rect x="3" y="16" width="13" height="5" rx="2" fill="#0A0F16" fillOpacity=".4" />
      </svg>
    </span>
  )
}

export function BrandMark() {
  return (
    <svg className="mk" viewBox="0 0 44 44" aria-hidden="true">
      <rect x="13" width="31" height="11" rx="4" fill="#6FE3C1" />
      <rect y="16.5" width="31" height="11" rx="4" fill="#EBEFF6" />
      <rect y="33" width="31" height="11" rx="4" fill="#EBEFF6" fillOpacity=".42" />
    </svg>
  )
}
