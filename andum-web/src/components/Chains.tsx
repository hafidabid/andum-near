import { useEffect, useRef, useState } from 'react'
import { CHAINS, X_AMOUNT, X_PHASE_AT, xNote, xSteps, type Chain, type ChainId, type XMode } from '@/lib/chains'
import { cx, fm } from '@/lib/format'
import { useInView } from '@/hooks/useInView'
import { useReducedMotion } from '@/hooks/useMedia'
import { useTween } from '@/hooks/useTween'
import { NearMark } from './Icons'
import { Rv } from './Rv'

function ChainBadge({ c }: { c: Chain }) {
  return (
    <span className="ai" style={{ ['--s' as string]: '26px' }}>
      <svg viewBox="0 0 24 24">
        <rect width="24" height="24" fill={c.c} />
        <text x="12" y="15.2" textAnchor="middle" fontSize={c.t.length > 3 ? 6.6 : 8.5} fontWeight="700" fill="#0A0E14" fontFamily="Funnel Sans,Arial,sans-serif">
          {c.t}
        </text>
      </svg>
    </span>
  )
}

/** Where the dot and the lit line are at each phase (0 = idle, 5 = arrived). */
export function routeStyle(phase: number): { dotLeft: string; dotOpacity: number; litWidth: string; dotTransition: string; litTransition: string } {
  const ease = 'cubic-bezier(.45,0,.25,1)'
  return {
    dotLeft: phase >= 4 ? '83.4%' : phase >= 2 ? '50%' : '16.6%',
    dotOpacity: phase >= 1 && phase < 5 ? 1 : 0,
    litWidth: phase >= 4 ? '66.8%' : phase >= 2 ? '33.4%' : '0%',
    dotTransition: phase === 0 ? 'none' : phase === 1 ? 'opacity .4s' : `left 1.1s ${ease}, opacity .4s`,
    litTransition: phase === 0 ? 'none' : `width 1.1s ${ease}`,
  }
}

export function Chains() {
  const reduce = useReducedMotion()
  const [mode, setMode] = useState<XMode>('in')
  const [chainId, setChainId] = useState<ChainId>('base')
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState(0)
  const flow = useRef<HTMLDivElement>(null)
  const started = useInView(flow, { threshold: 0.4, once: true })
  const chain = CHAINS.find((c) => c.id === chainId)!

  // Restart the route whenever the mode, chain or replay button changes. First run waits until it is on screen.
  useEffect(() => {
    if (!started) return
    if (reduce) {
      setPhase(5)
      return
    }
    setPhase(0)
    const timers = X_PHASE_AT.map((ms, i) => setTimeout(() => setPhase(i + 1), ms))
    return () => timers.forEach(clearTimeout)
  }, [started, mode, chainId, run, reduce])

  const amount = useTween(0, X_AMOUNT[mode], `${mode}-${chainId}-${run}`, 900, reduce, phase >= 5)
  const steps = xSteps(mode, chain)
  const r = routeStyle(phase)
  const n1 = phase >= 1
  const n2 = phase >= 3
  const n3 = phase >= 5
  const stepOn = [phase >= 1, phase >= 3, phase >= 5]

  return (
    <section id="chains">
      <Rv className="sec-head">
        <div className="mono">Cross-chain</div>
        <h2>Fund from any chain. Send to any chain.</h2>
        <p className="lede">Fund a package with money from the chain you already use. When a part opens, send it to wherever the receiver keeps their funds. NEAR Intents does the swapping and bridging.</p>
      </Rv>
      <Rv className="xc spot">
        <div className="xc-top">
          <div className="seg" role="group" aria-label="Direction">
            <button aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Fund from another chain</button>
            <button aria-pressed={mode === 'out'} onClick={() => setMode('out')}>Send to another chain</button>
          </div>
          <div className="chains" role="group" aria-label="Chain">
            {CHAINS.map((c) => (
              <button key={c.id} className="chn" aria-pressed={c.id === chainId} onClick={() => setChainId(c.id)}>
                <i style={{ background: c.c, fontSize: c.t.length > 3 ? 7.5 : 9.5 }}>{c.t}</i>
                {c.n}
              </button>
            ))}
          </div>
        </div>
        <div className="xc-flow" ref={flow}>
          <div className="lit" style={{ width: r.litWidth, transition: r.litTransition }} />
          <div className="xdot" style={{ left: r.dotLeft, opacity: r.dotOpacity, transition: r.dotTransition }} />
          <div className={cx('xn', n1 && 'on')}>
            <div className="mono">From</div>
            {mode === 'in' ? (
              <>
                <div className="row"><ChainBadge c={chain} /><b className="font-medium">Your wallet on {chain.n}</b></div>
                <div className="big">1,000<span className="sm"> USDC</span></div>
                <div className="sm">Money you already hold</div>
              </>
            ) : (
              <>
                <div className="row"><NearMark /><b className="font-medium">Rina's package on NEAR</b></div>
                <div className="big">800<span className="sm"> USDC</span></div>
                <div className="sm">Part 2 is open</div>
              </>
            )}
          </div>
          <div className={cx('xn', n2 && 'on')}>
            <div className="mono">NEAR Intents</div>
            <div className="big !text-[22px]">Swaps and bridges</div>
            <div className="sm">One quote, shown before you confirm</div>
          </div>
          <div className={cx('xn', n3 && 'on')}>
            <div className="mono">{mode === 'in' ? 'Into' : 'To'}</div>
            {mode === 'in' ? (
              <div className="row"><NearMark /><b className="font-medium">Andum package on NEAR</b></div>
            ) : (
              <div className="row"><ChainBadge c={chain} /><b className="font-medium">Rina's wallet on {chain.n}</b></div>
            )}
            <div className="big" data-testid="xc-amt">{fm('USDC', Math.round(amount))}<span className="sm"> USDC</span></div>
            <div className="sm">{mode === 'in' ? 'Held until each part opens' : 'Where she keeps her funds'}</div>
          </div>
        </div>
        <div className="xsteps">
          {steps.map((t, i) => (
            <div key={t} className={cx('xs', stepOn[i] && 'on')}>
              <b>{i + 1}</b>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="xc-foot">
          <span>{xNote(mode)}</span>
          <button className="btn ghost sm" onClick={() => setRun((n) => n + 1)}>Replay</button>
        </div>
      </Rv>
    </section>
  )
}
