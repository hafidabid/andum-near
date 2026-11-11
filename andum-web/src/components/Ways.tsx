import { useEffect, useRef, useState } from 'react'
import { clamp, cx, dlab } from '@/lib/format'
import { WAYS, WAYS_AXIS, waysIndex } from '@/lib/ways'
import { useIsDesktop, useReducedMotion } from '@/hooks/useMedia'
import { useInView } from '@/hooks/useInView'
import { scrollToPin, useScrollProgress } from '@/hooks/useScrollProgress'
import { Axis, LaneRow, Lanes, Playhead } from './Lane'
import type { Way } from '@/lib/ways'

/** On touch layouts each card plays its own lane once, the first time it is seen. */
function MiniLane({ p }: { p: Way }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { threshold: 0.6, once: true })
  const reduce = useReducedMotion()
  const [day, setDay] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (reduce) {
      setDay(WAYS_AXIS)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const f = (t: number) => {
      const k = clamp((t - t0) / 4200, 0, 1)
      setDay(k * WAYS_AXIS)
      if (k < 1) raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [seen, reduce])
  return <LaneRow p={p} day={day} axis={WAYS_AXIS} rowRef={ref} />
}

export function Ways() {
  const desk = useIsDesktop()
  const wrap = useRef<HTMLDivElement>(null)
  const p = useScrollProgress(wrap, desk)
  const idx = waysIndex(p)
  const day = p * WAYS_AXIS

  const list = useRef<HTMLDivElement>(null)
  const [dot, setDot] = useState(0)
  const onListScroll = () => {
    const el = list.current
    if (!el || desk) return
    let best = 0
    let bd = Infinity
    Array.from(el.children).forEach((c, i) => {
      const d = Math.abs((c as HTMLElement).offsetLeft - el.offsetLeft - 18 - el.scrollLeft)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = WAYS.length - 1
    setDot(best)
  }
  const goDot = (i: number) => {
    const el = list.current
    const c = el?.children[i] as HTMLElement | undefined
    if (el && c) el.scrollTo({ left: c.offsetLeft - el.offsetLeft - 18, behavior: 'smooth' })
  }

  return (
    <section id="ways">
      <div className="pinwrap" id="ways-wrap" ref={wrap} style={{ height: '300vh' }}>
        <div className="pin">
          <div className="sec-head">
            <div className="mono">How parts open</div>
            <h2>Each part opens its own way</h2>
            <p className="lede">A package can hold as many parts as you need. You set the rule for each one before you fund it. Keep scrolling and the timeline moves through all three.</p>
          </div>
          <div className="ways2">
            <div className="wl" ref={list} onScroll={onListScroll}>
              {WAYS.map((w, i) => (
                <div
                  key={w.t}
                  className={cx('wi', idx === i && 'on')}
                  data-i={i}
                  onClick={() => desk && scrollToPin(wrap.current, [0.12, 0.46, 0.82][i])}
                >
                  <span className="bar"><i /></span>
                  <h3>{w.t}</h3>
                  <p>{w.d}</p>
                  <div className="sv">
                    <Lanes noLabelColumn>
                      <MiniLane p={w} />
                    </Lanes>
                  </div>
                </div>
              ))}
            </div>
            <div className="dots" aria-hidden="true">
              {WAYS.map((w, i) => (
                <i key={w.t} className={cx(dot === i && 'on')} onClick={() => goDot(i)} style={{ cursor: 'pointer' }} />
              ))}
            </div>
            <div className="wv-card spot" id="wv">
              <div className="top">
                <span className="mono">Timeline</span>
                <span className="date num">{dlab(day)}</span>
              </div>
              <Lanes>
                {WAYS.map((w, i) => (
                  <LaneRow key={w.t} p={w} day={day} axis={WAYS_AXIS} dim={idx !== i} />
                ))}
                <Playhead day={day} axis={WAYS_AXIS} />
              </Lanes>
              <Axis axis={WAYS_AXIS} steps={[0, 10, 20, 30]} />
            </div>
          </div>
          <div className="scrollhint" style={{ opacity: p > 0.02 ? 0 : 1 }}>
            <i />
            <span className="mono">Scroll</span>
          </div>
        </div>
      </div>
    </section>
  )
}

