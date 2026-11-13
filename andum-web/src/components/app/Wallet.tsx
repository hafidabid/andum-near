import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { AssetIcon, AS } from '@/lib/assets'
import { accountUrl, DEPLOYED_ASSETS, tokenBalance } from '@/lib/chain'
import { errorText } from '@/lib/errors'
import { assetFromKey, fromBase } from '@/lib/money'
import { Notice, Spinner } from './ui'
import { useSession } from './Session'

/** Short symbol shown per asset; gold is counted in grams. */
export const LABEL: Record<string, string> = { usdc: 'USDC', idrx: 'IDRX', myr: 'MYR', xau: 'Gold g', aapl: 'AAPL', nvda: 'NVDA', pltr: 'PLTR' }

export function useBalances(account: string | null) {
  const [b, setB] = useState<Record<string, string>>({})
  const refresh = useCallback(async () => {
    if (!account) return
    const rows = await Promise.all(DEPLOYED_ASSETS.map(async (a) => [a, await tokenBalance(a, account)] as const))
    setB(Object.fromEntries(rows))
  }, [account])
  useEffect(() => { void refresh() }, [refresh])
  return [b, refresh] as const
}

/** Who is signed in: the account on NEAR, a copy action and sign out. Sits at the right of the title row. */
export function AccountBar() {
  const s = useSession()
  const [copied, setCopied] = useState(false)
  return (
    <div className="ws-acct">
      <a href={accountUrl(s.accountId!)} target="_blank" rel="noreferrer" data-testid="account-id" title={s.email ?? undefined}>{s.accountId}</a>
      <button className="ws-act" onClick={() => { void navigator.clipboard?.writeText(s.accountId!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
      <button className="ws-act" onClick={() => void s.signOut()}>Sign out</button>
    </div>
  )
}

/** Test-token balances, one row per asset, with the faucet. The row is the control: no tiles. */
export function Balances({ balances, refresh }: { balances: Record<string, string>; refresh: () => Promise<void> }) {
  const s = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function faucet(asset: string) {
    setErr(null); setBusy(asset)
    try {
      const before = BigInt(balances[asset] ?? '0')
      await apiClient.faucet(asset)
      for (let i = 0; i < 12; i++) { // the mint lands a few seconds later
        await new Promise((r) => setTimeout(r, 1500))
        if (BigInt(await tokenBalance(asset, s.accountId!)) > before) break
      }
      await refresh()
    } catch (e) { setErr(errorText(e)) } finally { setBusy(null) }
  }

  return (
    <section className="ws-card ws-card--tight" aria-label="Your balances">
      <h2 className="ws-h">Your balances <small>Test tokens</small></h2>
      <ul className="ws-bal">
        {DEPLOYED_ASSETS.map((a) => {
          const id = assetFromKey(a)
          const zero = BigInt(balances[a] ?? '0') === 0n
          return (
            <li key={a} data-asset={a}>
              <AssetIcon a={id} size={20} />
              <span className="ws-bal-sym">{LABEL[a]}<small>{AS[id].n.replace(/ (stock|stablecoin)$/i, '').replace('Tokenized gold', 'Gold')}</small></span>
              <span className={`ws-bal-amt num${zero ? ' is-zero' : ''}`}>{fromBase(balances[a] ?? '0')}</span>
              <button disabled={busy !== null} onClick={() => faucet(a)} aria-label={`Get test ${LABEL[a]}`}>{busy === a ? <Spinner /> : '+ Get'}</button>
            </li>
          )
        })}
      </ul>
      {err && <div className="mt-3"><Notice>{err}</Notice></div>}
    </section>
  )
}
