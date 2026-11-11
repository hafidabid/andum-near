import { useEffect, useState, type RefObject } from 'react'
import { clamp } from '@/lib/format'

/** How far through a tall "pinwrap" element the viewport has scrolled, 0..1. */
export function pinProgress(rectTop: number, wrapHeight: number, viewportHeight: number): number {
  return clamp(-rectTop / Math.max(1, wrapHeight - viewportHeight), 0, 1)
}

/** Scroll progress through a pinned chapter. Only tracks while `enabled`. */
export function useScrollProgress<T extends HTMLElement>(ref: RefObject<T>, enabled: boolean): number {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      setP(pinProgress(el.getBoundingClientRect().top, el.offsetHeight, window.innerHeight))
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref, enabled])
  return enabled ? p : 0
}

/** Scroll the page so a pinned chapter sits at `fraction` of its length. */
export function scrollToPin(el: HTMLElement | null, fraction: number): void {
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY
  const total = el.offsetHeight - window.innerHeight
  window.scrollTo({ top: top + total * fraction, behavior: 'smooth' })
}
