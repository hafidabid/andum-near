import { useEffect, useState, type RefObject } from 'react'

interface Options {
  threshold?: number
  rootMargin?: string
  /** Stop observing after the first time the element is seen. */
  once?: boolean
}

/** True while the element is on screen (or, with `once`, after it has been seen). */
export function useInView<T extends Element>(ref: RefObject<T>, { threshold = 0.12, rootMargin, once = false }: Options = {}): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true)
            if (once) io.disconnect()
          } else if (!once) {
            setSeen(false)
          }
        }
      },
      { threshold, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, threshold, rootMargin, once])
  return seen
}
