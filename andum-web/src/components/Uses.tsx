import { useEffect, useRef, useState } from 'react'
import { SCENARIOS, USES_AXIS, usesAt } from '@/lib/scenarios'
import { clamp, cx, dlab, money } from '@/lib/format'
import { openTotals } from '@/lib/lanes'
import type { AssetId } from '@/lib/assets'
import { useFrame } from '@/hooks/useFrame'
import { useInView } from '@/hooks/useInView'
import { useIsDesktop, useReducedMotion } from '@/hooks/useMedia'
import { scrollToPin, useScrollProgress } from '@/hooks/useScrollProgress'
import { Axis, LaneRow, Lanes, Playhead } from './Lane'
import { PauseIcon, PlayIcon } from './Icons'

export function Uses() {
  const desk = useIsDesktop()
  const reduce = useReducedMotion()
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const p = useScrollProgress(wrap, desk)

  // Desktop: scroll chooses both the scenario and the day. Touch: a timer and the slider do.
  const [touchIdx, setTouchIdx] = useState(0)
  const [touchDay, setTouchDay] = useState(0)
  const [playing, setPlaying] = useState(false)
  const dayRef = useRef(0)
  const at = usesAt(p)
  const cur = desk ? at.index : touchIdx
  const day = desk ? at.day : touchDay

  // Swap the story with a short fade when the scenario changes.
  const [shown, setShown] = useState(cur)
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (cur === shown) return
    if (reduce) {
      setShown(cur)
      return
    }
    setOut(true)
    const t = setTimeout(() => {
      setShown(cur)
      setOut(false)
    }, 260)
    return () => clearTimeout(t)
  }, [cur, shown, reduce])

  const move = (d: number) => {
    dayRef.current = d
    setTouchDay(d)
  }
  useFrame((dt) => {
    const d = dayRef.current + dt * 6
    if (d >= USES_AXIS) {
      move(USES_AXIS)
      setPlaying(false)
    } else move(d)
  }, playing && !desk)

  const inView = useInView(stage, { threshold: 0.4 })
  const startedOnce = useRef(false)
  useEffect(() => {
    if (desk || reduce) return
    if (inView) {
      if (!startedOnce.current) {
        startedOnce.current = true
        setPlaying(true)
      }
    } else setPlaying(false)
  }, [inView, desk, reduce])

  const sc = SCENARIOS[shown]
  const tot = openTotals(sc.parts, day)
  const totalText = (Object.keys(tot) as AssetId[]).map((a) => money(a, tot[a]!)).join(' + ')

  const pick = (i: number) => {
    if (desk) {
      scrollToPin(wrap.current, (i + 0.5) / SCENARIOS.length)
      return
    }
    setPlaying(false)
    move(0)
    setTouchIdx(i)
    setTimeout(() => !reduce && setPlaying(true), 400)
  }
  const toggle = () => {
    if (playing) return setPlaying(false)
    if (dayRef.current >= USES_AXIS) move(0)
    setPlaying(true)
  }

  return (
    <section id="uses">
      <div className="pinwrap" id="uses-wrap" ref={wrap} style={{ height: '480vh' }}>
        <div className="pin">
          <div className="sec-head">
            <div className="mono">What people send</div>
            <h2>Money that has a schedule</h2>
            <p className="lede" id="uses-lede">
              {desk ? 'Five everyday situations. Scroll to move through time and watch each part open.' : 'Five everyday situations. Pick one and press play.'}
            </p>
          </div>
          <div className="sx">
            <div className="sx-list" role="tablist" aria-label="Situations">
              {SCENARIOS.map((s, i) => (
                <button key={s.n} role="tab" aria-selected={cur === i} data-i={i} onClick={() => pick(i)}>
                  <span className="bar"><i /></span>
                  <b>{s.n}</b>
                  <span>{s.d}</span>
                </button>
              ))}
            </div>
            <div className="sx-stage spot" ref={stage}>
              <div className={cx('sx-in', out && 'out')}>
                <div className="sx-top">
                  <div>
                    <div className="mono">{sc.who}</div>
                    <h3>{sc.title}</h3>
                  </div>
                  <div className="sx-tot">
                    <div className="mono">Opened so far</div>
                    <div className="v">{totalText || 'Nothing yet'}</div>
                  </div>
                </div>
                <p className="sx-story">{sc.story}</p>
                <Lanes>
                  {sc.parts.map((part, i) => (
                    <LaneRow key={`${sc.n}-${i}`} p={part} day={day} axis={USES_AXIS} />
                  ))}
                  <Playhead day={day} axis={USES_AXIS} />
                </Lanes>
                <Axis axis={USES_AXIS} steps={[0, 15, 30, 45, 60]} />
              </div>
              <div className="sx-ctl">
                <button className="ibtn" aria-label="Play or pause" onClick={toggle}>
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={USES_AXIS}
                  step={0.05}
                  value={clamp(day, 0, USES_AXIS)}
                  aria-label="Move along the timeline"
                  onChange={(e) => {
                    setPlaying(false)
                    move(parseFloat(e.target.value))
                  }}
                />
                <span className="num min-w-[58px] text-right text-sm">{dlab(day)}</span>
              </div>
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
