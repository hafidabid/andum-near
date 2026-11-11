import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ACTIONS, MATRIX, ROLES, VERDICT_MARK, verdictLabel, verdictPasses, verdictText, verdictTone, type ActionId, type RoleId, type Verdict } from '@/lib/roles'
import { clamp, cx, easeInOut } from '@/lib/format'
import { useReducedMotion } from '@/hooks/useMedia'
import { Rv } from './Rv'

interface Pt { x: number; y: number }
interface PathSpec { d: string; k: string }

type Msg = { kind: 'intro' } | { kind: 'result'; id: ActionId }

export function Roles() {
  const reduce = useReducedMotion()
  const [role, setRole] = useState<RoleId>('sender')
  const [active, setActive] = useState<ActionId | null>(null)
  const [msg, setMsg] = useState<Msg>({ kind: 'intro' })
  const [pkgFx, setPkgFx] = useState<'' | 'ok' | 'no'>('')
  const [paths, setPaths] = useState<PathSpec[]>([])
  const [viewBox, setViewBox] = useState('0 0 0 0')
  const [dotBad, setDotBad] = useState(false)
  const busy = useRef(false)
  const stage = useRef<HTMLDivElement>(null)
  const actor = useRef<HTMLDivElement>(null)
  const pkg = useRef<HTMLDivElement>(null)
  const ports = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)

  const r = ROLES.find((x) => x.id === role)!

  const ctr = useCallback((el: Element, side: 'l' | 'r' | 'c'): Pt => {
    const s = stage.current!.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    return { x: (side === 'l' ? b.left : side === 'r' ? b.right : b.left + b.width / 2) - s.left, y: b.top + b.height / 2 - s.top }
  }, [])

  const lines = useCallback(() => {
    if (!stage.current || !actor.current || !pkg.current || !ports.current) return
    if (window.innerWidth <= 760) {
      setPaths([])
      return
    }
    const s = stage.current.getBoundingClientRect()
    setViewBox(`0 0 ${s.width} ${s.height}`)
    const a = ctr(actor.current, 'r')
    const pl = ctr(pkg.current, 'l')
    const pr = ctr(pkg.current, 'r')
    const out: PathSpec[] = [{ d: `M${a.x} ${a.y} L${pl.x} ${pl.y}`, k: 'yes' }]
    ports.current.querySelectorAll<HTMLElement>('.pp').forEach((b) => {
      const t = ctr(b, 'l')
      const mx = (pr.x + t.x) / 2
      out.push({ d: `M${pr.x} ${pr.y} C${mx} ${pr.y} ${mx} ${t.y} ${t.x} ${t.y}`, k: b.dataset.verdict ?? '' })
    })
    setPaths(out)
  }, [ctr])

  useLayoutEffect(() => {
    lines()
  }, [role, lines])
  useEffect(() => {
    window.addEventListener('resize', lines)
    document.fonts?.ready?.then(lines)
    const t = setTimeout(lines, 600)
    return () => {
      window.removeEventListener('resize', lines)
      clearTimeout(t)
    }
  }, [lines])

  const fly = (pts: Pt[], i: number, done?: () => void) => {
    const el = dot.current
    if (!el || i >= pts.length - 1) return done?.()
    const a = pts[i]
    const b = pts[i + 1]
    const t0 = performance.now()
    const dur = Math.max(260, Math.hypot(b.x - a.x, b.y - a.y) * 2.2)
    const f = (t: number) => {
      const k = clamp((t - t0) / dur, 0, 1)
      const e = easeInOut(k)
      el.style.left = `${a.x + (b.x - a.x) * e}px`
      el.style.top = `${a.y + (b.y - a.y) * e}px`
      if (k < 1) requestAnimationFrame(f)
      else fly(pts, i + 1, done)
    }
    requestAnimationFrame(f)
  }

  const showResult = (id: ActionId, verdict: Verdict) => {
    setMsg({ kind: 'result', id })
    setPkgFx('')
    if (verdict !== 'na') requestAnimationFrame(() => setPkgFx(verdictPasses(verdict) ? 'ok' : 'no'))
    setTimeout(() => setPkgFx(''), 1100)
  }

  const tryAction = (id: ActionId) => {
    if (busy.current) return
    const verdict = MATRIX[role][id][0]
    setActive(id)
    const portEl = ports.current?.querySelector<HTMLElement>(`[data-p="${id}"]`)
    if (reduce || window.innerWidth <= 760 || verdict === 'na' || !portEl || !actor.current || !pkg.current || !dot.current) {
      showResult(id, verdict)
      return
    }
    busy.current = true
    const ok = verdictPasses(verdict)
    const a = ctr(actor.current, 'r')
    const pl = ctr(pkg.current, 'l')
    const pr = ctr(pkg.current, 'r')
    const t = ctr(portEl, 'l')
    const el = dot.current
    setDotBad(!ok)
    el.style.left = `${a.x}px`
    el.style.top = `${a.y}px`
    el.style.opacity = '1'
    const finish = () => {
      el.style.opacity = '0'
      busy.current = false
    }
    fly(ok ? [a, pl, pr, t] : [a, pl], 0, () => {
      showResult(id, verdict)
      if (ok) setTimeout(finish, 300)
      else fly([pl, a], 0, finish)
    })
  }

  const pickRole = (id: RoleId) => {
    if (busy.current) return
    setRole(id)
    setActive(null)
    setMsg({ kind: 'intro' })
  }

  const result = msg.kind === 'result' ? MATRIX[role][msg.id] : null

  return (
    <section id="roles">
      <Rv className="sec-head">
        <div className="mono">Who can do what</div>
        <h2>The contract decides</h2>
        <p className="lede">Every action goes to the contract first. For each role it allows a short list and refuses the rest. Pick a role, then try an action.</p>
      </Rv>
      <Rv className="perm">
        <div className="pr-roles" role="group" aria-label="Role">
          {ROLES.map((x) => (
            <button key={x.id} aria-pressed={role === x.id} onClick={() => pickRole(x.id)}>
              <span className="av">{x.av}</span>
              <span>
                <b>{x.n}</b>
                <span className="d">{x.d}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="pr-stage spot" ref={stage}>
          <svg className="pr-lines" viewBox={viewBox} aria-hidden="true">
            {paths.map((p, i) => (
              <path key={i} className={p.k} d={p.d} />
            ))}
          </svg>
          <div className={cx('pr-dot', dotBad && 'bad')} ref={dot} />
          <div className="pr-actor" ref={actor}>
            <span className="av">{r.av}</span>
            <span className="nm">{r.n}</span>
          </div>
          <div className={cx('pr-pkg', pkgFx)} ref={pkg}>
            <i /><i /><i />
            <div className="mono">Package</div>
          </div>
          <div className="pr-ports" ref={ports}>
            {ACTIONS.map(([id, label]) => {
              const v = MATRIX[role][id][0]
              return (
                <button key={id} className={cx('pp', v, active === id && 'act')} data-p={id} data-verdict={v} onClick={() => tryAction(id)}>
                  <span>{label}</span>
                  <span className="st">{VERDICT_MARK[v]}</span>
                </button>
              )
            })}
          </div>
          <div className="pr-msg" aria-live="polite">
            {result && msg.kind === 'result' ? (
              <>
                <span className={cx('chip', verdictTone(result[0]))}>{verdictLabel(result[0])}</span>
                <span>{verdictText(result[1])}</span>
              </>
            ) : (
              <>
                <span className="chip plain">{r.n}</span>
                <span className="text-muted">{r.d} Press an action to try it.</span>
              </>
            )}
          </div>
        </div>
      </Rv>
    </section>
  )
}
