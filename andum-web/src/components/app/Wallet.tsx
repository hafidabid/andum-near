import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { accountUrl, DEPLOYED_ASSETS, tokenBalance } from '@/lib/chain'
import { errorText } from '@/lib/errors'
import { fromBase } from '@/lib/money'
import { Card, Notice, Spinner } from './ui'
import { useSession } from './Session'

const LABEL: Record<string, string> = { usdc: 'USDC', idrx: 'IDRX', myr: 'MYR', xau: 'Gold g', aapl: 'AAPL' }

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

/** The signed-in account, its test-token balances and the faucet. */
export function WalletStrip({ balances, refresh }: { balances: Record<string, string>; refresh: () => Promise<void> }) {
  const s = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="mono">Your account</div>
          <a className="block max-w-full break-all text-[14px] text-fg underline-offset-2 hover:underline" href={accountUrl(s.accountId!)} target="_blank" rel="noreferrer" data-testid="account-id">{s.accountId}</a>
          <div className="text-[13px] text-muted">{s.email}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(s.accountId!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy account'}</button>
          <button className="btn ghost sm" onClick={() => void s.signOut()}>Sign out</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {DEPLOYED_ASSETS.map((a) => (
          <div key={a} className="rounded-xl border border-line bg-bg2 p-3" data-asset={a}>
            <div className="text-[12px] text-muted">{LABEL[a]}</div>
            <div className="num text-[18px]">{fromBase(balances[a] ?? '0')}</div>
            <button className="mt-1.5 text-[12.5px] text-open underline-offset-2 hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => faucet(a)} aria-label={`Get test ${LABEL[a]}`}>{busy === a ? <Spinner /> : '+ test tokens'}</button>
          </div>
        ))}
      </div>
      {err && <Notice>{err}</Notice>}
    </Card>
  )
}
