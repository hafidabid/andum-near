import { useEffect, useRef, useState } from 'react'
import { ASSET_IDS, AS, AssetIcon, type AssetId } from '@/lib/assets'
import { cx, dlab, money } from '@/lib/format'
import { agreementParts, laneStatus, openTotals, type LanePart, type Rule } from '@/lib/lanes'
import { useFrame } from '@/hooks/useFrame'
import { useInView } from '@/hooks/useInView'
import { useReducedMotion } from '@/hooks/useMedia'
import { Axis, LaneTrack, Lanes, Playhead, StatusChip } from './Lane'
import { PauseIcon, PlayIcon } from './Icons'
import { Rv } from './Rv'
import { useWallet } from './WalletContext'

export const COMPOSER_AXIS = 60
const MAX_PARTS = 5
const RULES: Array<[Rule, string]> = [['now', 'Right away'], ['date', 'On a date'], ['both', 'Date + approval']]

export interface CPart extends LanePart {
  id: number
  /** What the person typed, so "1." and "" survive while typing. */
  amtText: string
}

export const INITIAL_PARTS: CPart[] = [
  { id: 1, a: 'USDC', amt: 200, amtText: '200', rule: 'now', date: 0, gate: 0, who: 'Dewi' },
  { id: 2, a: 'USDC', amt: 800, amtText: '800', rule: 'both', date: 14, gate: 22, who: 'Dewi' },
  { id: 3, a: 'GOLD', amt: 1.5, amtText: '1.5', rule: 'date', date: 34, gate: 0, who: 'Dewi' },
]

/** What changes in a part when its rule changes. */
export function withRule(p: CPart, rule: Rule): CPart {
  const date = rule !== 'now' && !(p.date >= 1) ? 10 : p.date
  const gate = rule === 'both' && !(p.gate >= 1) ? date + 6 : p.gate
  return { ...p, rule, date, gate }
}

export function parseAmount(text: string): number {
  return parseFloat(String(text).replace(/,/g, '')) || 0
}

export function Composer() {
  const reduce = useReducedMotion()
  const { open } = useWallet()
  const [parts, setParts] = useState<CPart[]>(INITIAL_PARTS)
  const [day, setDay] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [touched, setTouched] = useState(1)
  const nextId = useRef(4)
  const dayRef = useRef(0)
  const played = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const seen = useInView(box, { threshold: 0.5 })

  const move = (d: number) => {
    dayRef.current = d
    setDay(d)
  }
  const stop = () => setPlaying(false)
  const step = (n: number) => setTouched((t) => Math.max(t, n))
  const update = (id: number, patch: Partial<CPart>) => setParts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const play = () => {
    if (dayRef.current >= COMPOSER_AXIS - 0.5) move(0)
    setPlaying(true)
    step(3)
  }

  useFrame((dt) => {
    const d = Math.min(COMPOSER_AXIS, dayRef.current + dt * 6)
    move(d)
    if (d >= COMPOSER_AXIS) stop()
  }, playing)

  // Start once on its own the first time it is on screen, unless the visitor has already touched it.
  const touchedRef = useRef(touched)
  touchedRef.current = touched
  useEffect(() => {
    if (!seen || played.current || reduce) return
    played.current = true
    const t = setTimeout(() => {
      if (touchedRef.current <= 1) play()
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, reduce])

  const tot = openTotals(parts, day)
  const totKeys = Object.keys(tot) as AssetId[]
  const totalText = totKeys.map((a) => money(a, Math.round(tot[a]! * 100) / 100)).join(' + ')

  return (
    <section id="build">
      <Rv className="sec-head">
        <div className="mono">Try it</div>
        <h2>Build a package with your own numbers</h2>
        <p className="lede">Change an amount or a rule. Drag a diamond to move a date. Press play and watch the package open.</p>
      </Rv>
      <Rv className="steps3">
        {['Add parts and pick a rule', 'Drag the dates', 'Press play'].map((label, i) => (
          <span key={label} className={cx(touched === i + 1 && 'on')} data-s={i + 1}>
            <b>{i + 1}</b>
            {label}
          </span>
        ))}
      </Rv>
      <Rv className="cp spot">
        <div ref={box}>
          <div className="cp-head">
            <div className="who">
              <span className="avs"><b>D</b><b>R</b></span>
              Dewi to Rina
            </div>
            <span className="chip open">Funded</span>
          </div>
          <Lanes>
            {parts.map((p, i) => {
              const s = laneStatus(p, day)
              return (
                <div className={cx('lane', s.open && 'is-open')} key={p.id} data-i={i}>
                  <div className="cl">
                    <div className="cl1">
                      <div className="asel">
                        <AssetIcon a={p.a} size={22} />
                        <select
                          className="fsel"
                          value={p.a}
                          aria-label={`Asset for part ${i + 1}`}
                          onChange={(e) => {
                            stop()
                            update(p.id, { a: e.target.value as AssetId })
                            step(1)
                          }}
                        >
                          {ASSET_IDS.map((k) => (
                            <option key={k} value={k}>{k === 'GOLD' ? 'Gold' : AS[k].u}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        className="fin num"
                        inputMode="decimal"
                        value={p.amtText}
                        aria-label={`Amount for part ${i + 1}`}
                        onChange={(e) => {
                          stop()
                          update(p.id, { amtText: e.target.value, amt: parseAmount(e.target.value) })
                        }}
                      />
                    </div>
                    <div className="cl2">
                      <div className="seg3">
                        {RULES.map(([r, label]) => (
                          <button
                            key={r}
                            aria-pressed={p.rule === r}
                            onClick={() => {
                              stop()
                              setParts((ps) => ps.map((x) => (x.id === p.id ? withRule(x, r) : x)))
                              step(2)
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {parts.length > 1 && (
                        <button
                          className="rmv"
                          aria-label={`Remove part ${i + 1}`}
                          onClick={() => {
                            stop()
                            setParts((ps) => ps.filter((x) => x.id !== p.id))
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="cl3">
                      <StatusChip open={s.open} label={s.label} />
                      {p.rule === 'both' && (
                        <label className="who2">
                          approved by
                          <input
                            value={p.who ?? ''}
                            aria-label={`Who approves part ${i + 1}`}
                            onChange={(e) => {
                              stop()
                              update(p.id, { who: e.target.value || 'Dewi' })
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                  <LaneTrack
                    p={p}
                    day={day}
                    axis={COMPOSER_AXIS}
                    onDrag={(k, d) => {
                      stop()
                      step(2)
                      update(p.id, k === 'd' ? { date: d } : { gate: d })
                    }}
                  />
                </div>
              )
            })}
            <Playhead day={day} axis={COMPOSER_AXIS} />
          </Lanes>
          <Axis axis={COMPOSER_AXIS} steps={[0, 15, 30, 45, 60]} />
          {parts.length < MAX_PARTS && (
            <button
              className="add"
              onClick={() => {
                stop()
                setParts((ps) => [...ps, { id: nextId.current++, a: 'USDC', amt: 100, amtText: '100', rule: 'date', date: 20, gate: 0, who: 'Dewi' }])
                step(1)
              }}
            >
              + Add a part
            </button>
          )}
          <div className="cp-ctl">
            <button className="ibtn" aria-label="Play or pause" onClick={() => (playing ? stop() : play())}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <input
              type="range"
              min={0}
              max={COMPOSER_AXIS}
              step={0.05}
              value={day}
              aria-label="Move along the timeline"
              onChange={(e) => {
                stop()
                move(parseFloat(e.target.value))
              }}
            />
            <span className="num min-w-[58px] text-right text-sm">{dlab(day)}</span>
          </div>
          <div className="cp-bot">
            <div className="agr spot">
              <div className="mono mb-2.5">The agreement</div>
              {parts.map((p) => (
                <p key={p.id}>
                  {agreementParts(p, money(p.a, p.amt)).map((s, i) => (s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>))}
                </p>
              ))}
            </div>
            <div className="cta-box">
              <div className="mono">Right now</div>
              <div className="big">{totalText ? `Rina can take ${totalText}` : 'Nothing is open yet'}</div>
              <button className="btn" onClick={open}>
                Send this package <span className="arr">→</span>
              </button>
            </div>
          </div>
        </div>
      </Rv>
    </section>
  )
}

