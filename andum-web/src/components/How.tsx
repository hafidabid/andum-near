import { useRef, type CSSProperties, type ReactNode } from 'react'
import { AssetIcon } from '@/lib/assets'
import { cx } from '@/lib/format'
import { useIsDesktop } from '@/hooks/useMedia'
import { scrollToPin, useScrollProgress } from '@/hooks/useScrollProgress'
import { CheckIcon } from './Icons'

export const HOW_STEPS: Array<[string, string]> = [
  ['Build the package', 'Pick the assets, set the amount for each part and choose how each one opens. Andum writes the agreement in plain sentences before you confirm.'],
  ['Fund it', 'You deposit everything in one go. From then on the money sits in the package and the amounts, dates and approvers are fixed.'],
  ['Send the link', 'The receiver opens the link, signs in with email or Google, and sees what is inside and why each part is waiting.'],
  ['Each part opens', "When a part's terms are met, the receiver gets an email and can take it. The package stays in their account until the last part has opened."],
]

const k = (n: number): CSSProperties => ({ ['--k' as string]: n })

function Check() {
  return <span className="check"><CheckIcon /></span>
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mcard stag spot">
      <span className="mono">{title}</span>
      {children}
    </div>
  )
}

const VISUALS: ReactNode[] = [
  <Card key="build" title="Build the package">
    <div className="mrow" style={k(0)}><div>Part 1<small>Opens when accepted</small></div><div className="a"><AssetIcon a="USDC" size={24} />200 USDC</div></div>
    <div className="mrow" style={k(1)}><div>Part 2<small>15 Nov, after Dewi approves</small></div><div className="a"><AssetIcon a="USDC" size={24} />800 USDC</div></div>
    <div className="mrow" style={k(2)}><div>Part 3<small>30 Nov</small></div><div className="a"><AssetIcon a="GOLD" size={24} />1.5 g gold</div></div>
  </Card>,
  <Card key="fund" title="Fund it">
    <div className="mrow" style={k(0)}><div>1,000 USDC<small>Deposited</small></div><Check /></div>
    <div className="mrow" style={k(1)}><div>1.5 g gold<small>Deposited</small></div><Check /></div>
    <div className="mrow" style={k(2)}><div>Terms locked<small>Amounts, dates and approvers are fixed</small></div><Check /></div>
  </Card>,
  <Card key="link" title="Send the link">
    <div className="mrow" style={{ ...k(0), flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <div className="mono m-0">To rina@example.com</div>
      <div className="font-display text-[22px] tracking-[-.02em]">Dewi sent you a package</div>
      <small className="text-muted">1,000 USDC and 1.5 g gold are already in it.</small>
    </div>
    <div className="mrow" style={k(1)}><div className="mono m-0 !normal-case !tracking-normal">andum.app/p/rina-audit-bonus</div><span className="chip info plain">Copy</span></div>
  </Card>,
  <Card key="open" title="Parts open">
    <div className="mrow" style={k(0)}><div>200 USDC<small>Opened on acceptance</small></div><span className="chip open">Open</span></div>
    <div className="mrow" style={k(1)}><div>800 USDC<small>Dewi approved</small></div><span className="chip open">Open</span></div>
    <div className="mrow" style={k(2)}><div>1.5 g gold<small>Opens on 30 Nov</small></div><span className="chip wait">Waiting for date</span></div>
  </Card>,
]

export function stepIndex(p: number): number {
  return Math.min(3, Math.floor(p * 4))
}

export function How() {
  const desk = useIsDesktop()
  const wrap = useRef<HTMLDivElement>(null)
  const p = useScrollProgress(wrap, desk)
  const cur = stepIndex(p)

  return (
    <section id="how">
      <div className="pinwrap" id="how-wrap" ref={wrap} style={{ height: '330vh' }}>
        <div className="pin">
          <div className="sec-head">
            <div className="mono">How it works</div>
            <h2>From a blank package to the last part</h2>
          </div>
          <div className="how-grid">
            <div className="relative">
              <div className="progress"><i style={{ height: `${p * 100}%` }} /></div>
              <div className="steps">
                {HOW_STEPS.map(([title, text], i) => (
                  <div
                    key={title}
                    className={cx('step', cur === i && 'on')}
                    data-i={i}
                    onClick={() => desk && scrollToPin(wrap.current, (i + 0.5) / 4)}
                  >
                    <span className="n">0{i + 1}</span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                    <div className="sv">{VISUALS[i]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="vis-stack">
              {VISUALS.map((v, i) => (
                <div key={i} className={cx('vs', cur === i && 'on')} data-i={i}>
                  {v}
                </div>
              ))}
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
