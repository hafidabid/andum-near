import { useEffect, useState } from 'react'
import { easeOutCubic } from '@/lib/format'

/** Eases a number from `from` to `to` over `ms` whenever `runKey` changes. Jumps straight to `to` if `instant`. */
export function useTween(from: number, to: number, runKey: unknown, ms: number, instant: boolean, active = true): number {
  const [v, setV] = useState(from)
  useEffect(() => {
    if (!active) {
      setV(from)
      return
    }
    if (instant) {
      setV(to)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const f = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(from + (to - from) * easeOutCubic(k))
      if (k < 1) raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [from, to, runKey, ms, instant, active])
  return v
}
