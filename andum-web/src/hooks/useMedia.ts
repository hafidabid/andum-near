import { useEffect, useState } from 'react'

function read(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
}

/** Live result of a media query. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return matches
}

export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)')
}

/** The pinned, scroll-driven chapters only run above this width. Below it the page uses touch layouts. */
export const DESKTOP_QUERY = '(min-width: 901px)'

export function useIsDesktop(): boolean {
  return useMedia(DESKTOP_QUERY)
}
