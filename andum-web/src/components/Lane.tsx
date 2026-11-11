import { useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { AssetIcon } from '@/lib/assets'
import { AS, type AssetId } from '@/lib/assets'
import { clamp, cx, dlab, fm } from '@/lib/format'
import { laneStatus, lCond, lOpen, type LanePart } from '@/lib/lanes'

type Key = 'd' | 'g'

export function StatusChip({ open, label }: { open: boolean; label: string }) {
  return <span className={cx('chip', open ? 'open' : 'wait')}>{label}</span>
}

/** Left-hand label of a read-only lane: amount, rule and live status. */
export function LaneLabel({ p, day }: { p: LanePart; day: number }) {
  const s = laneStatus(p, day)
  return (
    <div className="lb">
      <div className="amt">
        <AssetIcon a={p.a} size={26} />
        <span>{fm(p.a as AssetId, p.amt)}</span>
        <small>{AS[p.a].u}</small>
      </div>
      <div className="cond">
        {lCond(p)} <StatusChip open={s.open} label={s.open ? 'Open' : s.label} />
      </div>
    </div>
  )
}

interface TrackProps {
  p: LanePart
  day: number
  axis: number
  /** When set, the date and approval markers can be dragged. */
  onDrag?: (key: 'd' | 'g', day: number) => void
}

/** The line, fill and markers of one lane. */
export function LaneTrack({ p, day, axis, onDrag }: TrackProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Key | null>(null)
  const fill = (Math.min(day, lOpen(p)) / axis) * 100
  const hit = (at: number) => day >= at - 0.001

  const start = (k: 'd' | 'g') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onDrag) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    setDragging(k)
    const move = (ev: PointerEvent) => {
      const r = trackRef.current?.getBoundingClientRect()
      if (!r || !r.width) return
      onDrag(k, clamp(Math.round(clamp((ev.clientX - r.left) / r.width, 0, 1) * axis), 1, axis))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setDragging(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const m = (k: 'd' | 'g', at: number) => (
    <div
      className={cx('m', k === 'g' && 'g', onDrag && 'drag-ok', hit(at) && 'hit', dragging === k && 'drag')}
      data-k={k}
      style={{ left: `${(at / axis) * 100}%` }}
      onPointerDown={start(k)}
    />
  )

  return (
    <div className="tr" ref={trackRef} data-tr>
      <div className="b" />
      <div className="f" style={{ width: `${fill}%` }} />
      {p.rule === 'now' ? (
        <>
          <div className={cx('m', hit(0) && 'hit')} data-k="n" style={{ left: `${(1 / axis) * 100}%` }} />
          <div className="ml" style={{ left: `${(1 / axis) * 100 + 3}%` }}>Accepts</div>
        </>
      ) : (
        <>
          {m('d', p.date)}
          <div className={cx('ml', p.date / axis > 0.84 && 'r')} data-k="d" style={{ left: `${(p.date / axis) * 100}%` }}>
            {dlab(p.date)}
          </div>
          {p.rule === 'both' && (
            <>
              {m('g', p.gate)}
              <div className={cx('ml dn', p.gate / axis > 0.8 && 'r')} data-k="g" style={{ left: `${(p.gate / axis) * 100}%` }}>
                {p.who || 'Dewi'} approves
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** The playhead line and its date tag. Put it last inside `.lanes`. */
export function Playhead({ day, axis }: { day: number; axis: number }) {
  return <div className="ph" data-d={dlab(day)} style={{ ['--p' as string]: day / axis } as CSSProperties} />
}

export function Axis({ axis, steps }: { axis: number; steps: number[] }) {
  return (
    <div className="axis">
      <div />
      <div>
        {steps.map((d, i) => (
          <span key={d} style={{ left: `${(d / axis) * 100}%` }} data-first={i === 0 || undefined}>
            {dlab(d)}
          </span>
        ))}
      </div>
    </div>
  )
}

interface RowProps {
  p: LanePart
  day: number
  axis: number
  dim?: boolean
  rowRef?: Ref<HTMLDivElement>
}

/** A read-only lane with its label. */
export function LaneRow({ p, day, axis, dim, rowRef }: RowProps) {
  const s = laneStatus(p, day)
  return (
    <div ref={rowRef} className={cx('lane', s.open && 'is-open')} style={dim ? { opacity: 0.38 } : undefined}>
      <LaneLabel p={p} day={day} />
      <LaneTrack p={p} day={day} axis={axis} />
    </div>
  )
}

export function Lanes({ children, noLabelColumn, className }: { children: ReactNode; noLabelColumn?: boolean; className?: string }) {
  return (
    <div className={cx('lanes', className)} style={noLabelColumn ? ({ ['--lw' as string]: '0px' } as CSSProperties) : undefined}>
      {children}
    </div>
  )
}
