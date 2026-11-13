import { useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cx } from '@/lib/format'
import { Card, Spinner } from '@/components/app/ui'
import { SignIn } from '@/components/app/SignIn'
import { useSession } from '@/components/app/Session'
import { Send } from '@/components/app/Send'
import { Approvals, Sent } from '@/components/app/Lists'
import { useBalances, WalletStrip } from '@/components/app/Wallet'

type Tab = 'send' | 'sent' | 'approve'
const TABS: Array<[Tab, string]> = [['send', 'Send a package'], ['sent', 'Sent'], ['approve', 'To approve']]

/** The working product: sign in, get test tokens, build and fund a package, follow it, approve other people's. */
export function AppPage() {
  useDocumentTitle('Your packages · Andum')
  const s = useSession()
  const [tab, setTab] = useState<Tab>('send')
  const [version, setVersion] = useState(0)
  const [balances, refresh] = useBalances(s.accountId)

  if (s.status === 'loading') return <section className="grid min-h-[60vh] place-items-center !pt-[120px]" aria-busy="true"><Spinner /></section>
  if (s.status === 'anon') {
    return (
      <section className="!pt-[110px]">
        <div className="mx-auto grid max-w-[460px] gap-6">
          <div className="text-center">
            <div className="mono">Andum</div>
            <h1 className="mt-2 text-balance text-[clamp(32px,7vw,48px)]">Sign in to send or approve</h1>
            <p className="lede mx-auto mt-3">Your email proves it is you. Your NEAR key is created in this browser and never leaves it.</p>
          </div>
          <Card><SignIn /></Card>
        </div>
      </section>
    )
  }
  return (
    <section className="!pt-[100px]">
      <div className="mx-auto grid max-w-[720px] gap-5">
        <WalletStrip balances={balances} refresh={refresh} />
        <div role="tablist" className="flex gap-2" aria-label="Sections">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cx('rounded-full border px-4 py-2 text-[14px] transition', tab === id ? 'border-fg bg-fg text-bg' : 'border-line text-muted hover:text-fg')}>{label}</button>
          ))}
        </div>
        {tab === 'send' && <Send balances={balances} onDone={() => { setVersion((v) => v + 1); void refresh() }} />}
        {tab === 'sent' && <Sent version={version} onChange={() => void refresh()} />}
        {tab === 'approve' && <Approvals version={version} />}
      </div>
    </section>
  )
}
