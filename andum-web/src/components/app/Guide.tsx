import { useState } from 'react'

const KEY = 'andum.guide.v1'
const read = (): boolean => { try { return localStorage.getItem(KEY) !== 'hidden' } catch { return true } }

/** First-run guide. Open until dismissed; the header's "Guide" button brings it back. */
export function useGuide(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(read)
  return [open, (v) => { setOpen(v); try { localStorage.setItem(KEY, v ? 'shown' : 'hidden') } catch { /* private mode: it just stays for this visit */ } }]
}

const STEPS: Array<[string, string]> = [
  ['Say who it is for', 'Type their email. Andum sends them a link. They can see what is inside before they accept, and they do not need a wallet.'],
  ['Split it into parts', 'Each part holds one asset: money, gold or a stock. Choose when it opens: as soon as they accept, on a date, or on a date after someone approves.'],
  ['Fund and send', 'You confirm once in this browser and Andum pays the network fee. The assets stay locked in the package until each part opens. If they never accept, you can take them back.'],
]

export function Guide({ onClose }: { onClose: () => void }) {
  return (
    <section className="ws-guide" aria-label="How a package works">
      <div className="ws-guide-head">
        <h2>How a package works</h2>
        <button type="button" className="ws-link" onClick={onClose}>Got it, hide this</button>
      </div>
      <div className="ws-guide-steps">
        {STEPS.map(([t, d]) => <div key={t}><b>{t}</b><p>{d}</p></div>)}
      </div>
      <p className="ws-guide-foot">No tokens yet? Press <b>+ Get</b> next to an asset under Your balances for free test tokens. They have no real value. Tap the <span className="ws-hint-btn" aria-hidden="true">?</span> beside any field to see what it does.</p>
    </section>
  )
}
