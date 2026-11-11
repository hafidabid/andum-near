import { useEffect } from 'react'

/** Moves the soft highlight on any `.spot` element to follow the pointer. */
export function useSpotlight(): void {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const target = e.target as Element | null
      const s = target?.closest?.('.spot') as HTMLElement | null
      if (!s) return
      const r = s.getBoundingClientRect()
      s.style.setProperty('--mx', `${e.clientX - r.left}px`)
      s.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => document.removeEventListener('pointermove', move)
  }, [])
}
