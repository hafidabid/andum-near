import { useState } from 'react'
import { FAQ } from '@/lib/faq'
import { cx } from '@/lib/format'
import { Rv } from './Rv'

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  return (
    <section id="faq">
      <Rv className="sec-head">
        <div className="mono">FAQ</div>
        <h2>Frequently asked questions</h2>
      </Rv>
      <Rv className="faq">
        {FAQ.map(([q, a], i) => {
          const open = openIndex === i
          return (
            <div key={q} className={cx('q', open && 'open')}>
              <button aria-expanded={open} aria-controls={`faq-a-${i}`} onClick={() => setOpenIndex(open ? null : i)}>
                <span>{q}</span>
                <span className="pl" />
              </button>
              <div className="ans" id={`faq-a-${i}`} role="region">
                <div>
                  <p>{a}</p>
                </div>
              </div>
            </div>
          )
        })}
      </Rv>
    </section>
  )
}
