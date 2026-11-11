import { useEffect, useRef, useState } from 'react'
import { AssetIcon, AS } from '@/lib/assets'
import { cx, dlab, fm, money } from '@/lib/format'
import { HERO_EVENTS, HERO_MARKERS, HERO_MAX, HERO_PARTS, heroEventIndex, heroOpenAt, heroStat, stepHero } from '@/lib/hero'
import { prototypeHref } from '@/lib/env'
import { useFrame } from '@/hooks/useFrame'
import { useInView } from '@/hooks/useInView'
import { useMedia, useReducedMotion } from '@/hooks/useMedia'
import { LockIcon, PauseIcon, PlayIcon } from './Icons'
import { SectionLink } from './TopBar'
import { useWallet } from './WalletContext'

const HEADLINE = ['Pay in parts.', 'The money is already there.']

function Headline() {
  let i = 0
  return (
    <h1 id="h1">
      {HEADLINE.map((line) => (
        <span className="ln" key={line}>
          {line.split(' ').map((w) => (
            <span className="w" key={`${w}-${i}`} style={{ ['--i' as string]: i++ }}>
              {w}&nbsp;
            </span>
          ))}
        </span>
      ))}
    </h1>
  )
}

export function Hero() {
  const reduce = useReducedMotion()
  const hover = useMedia('(hover: hover)')
  const { open } = useWallet()
  const stageRef = useRef<HTMLDivElement>(null)
  const pkgRef = useRef<HTMLDivElement>(null)
  const visible = useInView(stageRef, { threshold: 0.2 })
  const [day, setDay] = useState(0)
  const [playing, setPlaying] = useState(!reduce)
  const [rewinding, setRewinding] = useState(false)
  const dayRef = useRef(0)
  const dirRef = useRef<1 | -1>(1)

  useEffect(() => setPlaying(!reduce), [reduce])

  useFrame((dt) => {
    const n = stepHero(dayRef.current, dirRef.current, dt)
    dayRef.current = n.day
    dirRef.current = n.dir
    setDay(n.day)
    setRewinding(n.dir < 0)
  }, playing && visible)

  const stats = HERO_PARTS.map((p) => heroStat(p, day))
  const totals: Record<string, number> = {}
  HERO_PARTS.forEach((p, i) => {
    if (stats[i].open) totals[p.a] = (totals[p.a] ?? 0) + p.amt
  })
  const assets = Object.keys(totals) as Array<keyof typeof AS>

  // Caption fades out, swaps and fades back in when the story moves to the next event.
  const ei = heroEventIndex(day)
  const [shownEi, setShownEi] = useState(0)
  const [swap, setSwap] = useState(false)
  useEffect(() => {
    if (ei === shownEi) return
    setSwap(true)
    const t = setTimeout(() => {
      setShownEi(ei)
      setSwap(false)
    }, reduce ? 0 : 220)
    return () => clearTimeout(t)
  }, [ei, shownEi, reduce])

  const scrub = (v: number) => {
    dirRef.current = 1
    dayRef.current = v
    setDay(v)
    setRewinding(false)
    setPlaying(false)
  }
  const toggle = () => {
    if (!playing && dayRef.current >= HERO_MAX) {
      dayRef.current = 0
      dirRef.current = 1
      setDay(0)
    }
    setPlaying(!playing)
  }

  const tilt = (e: React.PointerEvent) => {
    if (reduce || !hover || !stageRef.current || !pkgRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    pkgRef.current.style.transform = `perspective(1100px) rotateY(${(x * 6).toFixed(2)}deg) rotateX(${(-y * 6).toFixed(2)}deg)`
  }

  const pct = (day / HERO_MAX) * 100
  return (
    <header className="hero">
      <div>
        <div className="mono">Andum · Packages for money and assets</div>
        <Headline />
        <p className="sub">
          Put stablecoins, tokenized gold or stocks into one package. Choose when each part opens: right away, on a date, or on a date plus your approval. The person receiving it can see the funds as soon as they open the link.
        </p>
        <div className="cta">
          <button className="btn" onClick={open}>
            Send a package <span className="arr">→</span>
          </button>
          <SectionLink id="ways" className="btn ghost">
            See how a package opens
          </SectionLink>
        </div>
        <p className="recv">
          Got a link from someone?{' '}
          <a href={prototypeHref('#receive')} target="_blank" rel="noreferrer">
            Open your package
          </a>
        </p>
        <div className="facts">
          <span>Funds visible before you accept</span>
          <span>A different rule for each part</span>
          <span>Send across chains</span>
        </div>
      </div>

      <div
        className={cx('stage', rewinding && 'rw')}
        id="stage"
        ref={stageRef}
        aria-label="A package that opens part by part as the timeline moves"
        style={{ ['--aura' as string]: (0.25 + assets.length * 0.3).toFixed(2) }}
        onPointerMove={tilt}
        onPointerLeave={() => pkgRef.current && (pkgRef.current.style.transform = '')}
      >
        <div className="pkg" ref={pkgRef}>
          <div className="pkg-head">
            <div className="who">
              <span className="avs"><b>D</b><b>R</b></span>
              Dewi to Rina
            </div>
            <span className="chip open">Funded</span>
          </div>
          <div className="parts">
            {HERO_PARTS.map((p, i) => {
              const s = stats[i]
              const at = heroOpenAt(p)
              return (
                <div className={cx('part', s.open && 'is-open')} key={i} data-i={i}>
                  <div className="lock"><LockIcon /></div>
                  <div className="amt num">
                    <AssetIcon a={p.a} size={26} />
                    <span>{fm(p.a, p.amt)}</span>
                    <small>{AS[p.a].u}</small>
                  </div>
                  <span className={cx('chip', s.tone)}>{s.label}</span>
                  <div className="why">{s.why}</div>
                  <div className="pl"><i style={{ width: `${at === 0 ? 100 : Math.min(1, day / at) * 100}%` }} /></div>
                </div>
              )
            })}
          </div>
          <div className="tlb">
            <div className="tlb-top">
              <span className="mono">Timeline</span>
              <span className="date num" id="st-date">{dlab(day)}</span>
              <button className="ibtn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
            </div>
            <div className="tlt">
              {HERO_MARKERS.map((m) => (
                <span key={m.at}>
                  <div className={cx('mk2', m.gate && 'gate', day >= m.at && 'hit')} style={{ left: `${(m.at / HERO_MAX) * 100}%` }} />
                  <div className={cx('ml', m.below && 'dn', day >= m.at && 'hit')} style={{ left: `${(m.at / HERO_MAX) * 100}%` }}>{m.label}</div>
                </span>
              ))}
              <div className="trk" />
              <div className="fill" style={{ width: `${pct}%` }} />
              <div className="knob" style={{ left: `${pct}%` }} />
              <input type="range" min={0} max={HERO_MAX} step={0.01} value={day} aria-label="Move along the timeline" onChange={(e) => scrub(parseFloat(e.target.value))} />
            </div>
            <p className={cx('cap', swap && 'sw')} aria-live="polite">{HERO_EVENTS[shownEi].t}</p>
          </div>
          <div className="stage-foot">
            <div className="tot">
              Rina can take{' '}
              {assets.length === 0
                ? 'nothing yet'
                : assets.map((a, i) => (
                    <span key={a}>
                      {i > 0 && ' and '}
                      <b>{money(a, Math.round(totals[a] * 100) / 100)}</b>
                    </span>
                  ))}
              {assets.length > 0 && ' now'}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
