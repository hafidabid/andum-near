import { useEffect, useRef, useState } from 'react'
import { AS, AssetIcon, type AssetId } from '@/lib/assets'
import { cx, fm } from '@/lib/format'
import { prototypeHref } from '@/lib/env'
import { useInView } from '@/hooks/useInView'
import { useReducedMotion } from '@/hooks/useMedia'
import { CheckIcon, LockIcon, MailIcon } from './Icons'
import { Rv } from './Rv'

/** The phone loops through these moments: waiting, email arrives, part opens, email goes. */
export type PhonePhase = 'waiting' | 'notified' | 'open' | 'done'

export const PHONE_TIMING: Array<[PhonePhase, number]> = [
  ['waiting', 0],
  ['notified', 1800],
  ['open', 2900],
  ['done', 6200],
]
export const PHONE_CYCLE_MS = 9000

interface Row {
  a: AssetId
  amt: number
  open: boolean
  taken: boolean
  why: string
  chip: string
  tone: 'open' | 'wait' | 'plain'
}

export function phoneRows(phase: PhonePhase): Row[] {
  const opened = phase === 'open' || phase === 'done'
  return [
    { a: 'USDC', amt: 200, open: false, taken: true, why: 'Taken on 10 Nov', chip: 'Taken', tone: 'plain' },
    opened
      ? { a: 'USDC', amt: 800, open: true, taken: false, why: 'Dewi approved. Ready to take.', chip: 'Open', tone: 'open' }
      : { a: 'USDC', amt: 800, open: false, taken: false, why: "Waiting for Dewi's approval", chip: 'Waiting for approval', tone: 'wait' },
    { a: 'GOLD', amt: 1.5, open: false, taken: false, why: 'Opens on 30 Nov', chip: 'Waiting for date', tone: 'wait' },
  ]
}

const POINTS = [
  'The funds are visible before you accept.',
  'Every closed part tells you why, and what will open it.',
  'You get an email when a part opens. Taking it costs you no network fee.',
]

export function Receiving() {
  const reduce = useReducedMotion()
  const phone = useRef<HTMLDivElement>(null)
  const started = useInView(phone, { threshold: 0.4, once: true })
  const [phase, setPhase] = useState<PhonePhase>(reduce ? 'open' : 'waiting')

  useEffect(() => {
    if (!started) return
    if (reduce) {
      setPhase('open')
      return
    }
    let timers: ReturnType<typeof setTimeout>[] = []
    const cycle = () => {
      timers = PHONE_TIMING.map(([ph, at]) => setTimeout(() => setPhase(ph), at))
      timers.push(setTimeout(cycle, PHONE_CYCLE_MS))
    }
    cycle()
    return () => timers.forEach(clearTimeout)
  }, [started, reduce])

  const rows = phoneRows(phase)
  const canTake = rows[1].open
  return (
    <section id="receiving">
      <div className="rcv">
        <Rv>
          <div className="mono">If you receive a package</div>
          <h2 className="mt-[18px]">You can see what's coming</h2>
          <p className="lede mt-5">Opening the link shows who sent it and that the funds are in it. After you accept, every part says whether it is open and, if not, what it is waiting for.</p>
          <ul className="points m-0 mt-[34px] p-0">
            {POINTS.map((t) => (
              <li key={t}>
                <span className="check"><CheckIcon /></span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-[30px]">
            <a className="btn ghost" href={prototypeHref('#receive')} target="_blank" rel="noreferrer">
              Open an example package <span className="arr">→</span>
            </a>
          </div>
        </Rv>
        <Rv delay={150}>
          <div className="phone" ref={phone}>
            <div className="scr">
              <div className={cx('notif', (phase === 'notified' || phase === 'open') && 'show')} role="status">
                <div className="ic"><MailIcon /></div>
                <div>
                  <b>800 USDC is ready</b>
                  <span>Dewi approved part 2. You can take it now.</span>
                </div>
              </div>
              <div className="mono">From Dewi</div>
              <h4>Your package</h4>
              <div className="mini">
                {rows.map((r) => (
                  <div className={cx('part', r.open && 'is-open', r.taken && 'taken')} key={`${r.a}-${r.amt}`}>
                    <div className="lock"><LockIcon /></div>
                    <div className="amt num">
                      <AssetIcon a={r.a} size={22} />
                      <span>{fm(r.a, r.amt)}</span>
                      <small>{AS[r.a].u}</small>
                    </div>
                    <span className={cx('chip', r.tone)}>{r.chip}</span>
                    <div className="why">{r.why}</div>
                  </div>
                ))}
              </div>
              <button className={cx('btn', !canTake && 'off')} aria-disabled={!canTake}>
                {canTake ? 'Take 800 USDC' : 'Nothing to take yet'}
              </button>
            </div>
          </div>
        </Rv>
      </div>
    </section>
  )
}
