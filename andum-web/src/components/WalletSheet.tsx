import { cx } from '@/lib/format'
import { prototypeHref } from '@/lib/env'
import { useWallet } from './WalletContext'

const WALLETS = [
  { id: 'MyNearWallet', badge: 'M', color: '#8DB1FF', sub: 'Browser wallet' },
  { id: 'Meteor Wallet', badge: 'Mt', color: '#6FE3C1', sub: 'Browser extension' },
  { id: 'Email', badge: '@', color: '#F2B661', sub: 'Create an account in a minute', label: 'Email or Google' },
]

/** The "connect a wallet" sheet. The network name appears only after a wallet is connected. */
export function WalletSheet() {
  const { isOpen, step, wallet, close, choose } = useWallet()
  return (
    <div
      className={cx('veil', isOpen && 'show')}
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      aria-hidden={!isOpen}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className={cx('sheet', step)}>
        <button className="x" aria-label="Close" onClick={close}>×</button>
        <div className="st s1c">
          <h3>Connect a wallet</h3>
          <p className="mt-1.5 text-[15px] text-muted">Pick the wallet you want to send from.</p>
          {WALLETS.map((w) => (
            <button key={w.id} className="wal" onClick={() => choose(w.id)}>
              <i style={{ background: w.color }}>{w.badge}</i>
              <span>
                {w.label ?? w.id}
                <small>{w.sub}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="st s2c">
          <div className="spin" />
          <p className="text-center text-muted">Connecting to {wallet}…</p>
        </div>
        <div className="st s3c">
          <h3>Wallet connected</h3>
          <div className="mt-3.5">
            <div className="kv"><span>Account</span><span className="mono !normal-case !tracking-normal text-fg">dewi.testnet</span></div>
            <div className="kv"><span>Network</span><span>NEAR testnet</span></div>
            <div className="kv border-b border-line"><span>Balance</span><span className="num">2,400 USDC</span></div>
          </div>
          <a className="btn mt-5 w-full justify-center" href={prototypeHref('#send')} target="_blank" rel="noreferrer">
            Create a package <span className="arr">→</span>
          </a>
        </div>
      </div>
    </div>
  )
}
