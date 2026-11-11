import { useEffect, useRef } from 'react'

/** Calls `cb(dtSeconds)` every animation frame while `running`. dt is capped at 50 ms. */
export function useFrame(cb: (dt: number) => void, running: boolean): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      if (!last) last = t
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      ref.current(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running])
}
