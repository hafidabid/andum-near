import { useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Card, Spinner } from '@/components/app/ui'
import { SignIn } from '@/components/app/SignIn'
import { useSession } from '@/components/app/Session'
import { Send } from '@/components/app/Send'
import { Approvals, Sent } from '@/components/app/Lists'
import { AccountBar, Balances, useBalances } from '@/components/app/Wallet'

type Tab = 'send' | 'sent' | 'approve'
const TABS: Array<[Tab, string]> = [['send', 'Send'], ['sent', 'Sent'], ['approve', 'To approve']]

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
  const head: Record<Tab, [string, string]> = {
    send: ['Send a package', 'Split money, gold or stocks into parts, and choose when and how each part opens.'],
    sent: ['Sent packages', 'What you sent, who has accepted it, and what you can take back.'],
    approve: ['To approve', 'Parts where you are the approver. Each opens once you confirm.'],
  }
  return (
    <section className="!pt-[88px]">
      <div className="ws">
        <header className="ws-head">
          <div className="ws-title"><h1>{head[tab][0]}</h1><p>{head[tab][1]}</p></div>
          <AccountBar />
        </header>
        <div role="tablist" className="ws-tabs" aria-label="Package workspace">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="ws-tab">{label}</button>
          ))}
        </div>
        {tab === 'send' && <Send balances={balances} rail={<Balances balances={balances} refresh={refresh} />} onDone={() => { setVersion((v) => v + 1); void refresh() }} />}
        {tab !== 'send' && (
          <div className="ws-grid">
            <div className="min-w-0">
              {tab === 'sent' ? <Sent version={version} onChange={() => void refresh()} /> : <Approvals version={version} />}
            </div>
            <div className="ws-rail"><Balances balances={balances} refresh={refresh} /></div>
          </div>
        )}
      </div>
    </section>
  )
}
