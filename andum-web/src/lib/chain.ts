/** Read-only NEAR JSON-RPC from the browser: balances, the signing nonce and the current block height. */
const RPCS: string[] = (import.meta.env.VITE_NEAR_RPC ?? 'https://test.rpc.fastnear.com,https://rpc.testnet.near.org').split(',').map((s: string) => s.trim()).filter(Boolean)
export const NEAR_ROOT: string = import.meta.env.VITE_NEAR_ROOT ?? 'hafidbuild.testnet'
export const NEAR_CORE: string = import.meta.env.VITE_NEAR_CORE ?? `core.${NEAR_ROOT}`
export const EXPLORER: string = (import.meta.env.VITE_EXPLORER ?? 'https://testnet.nearblocks.io').replace(/\/$/, '')
export const NEAR_BRIDGE: string = import.meta.env.VITE_NEAR_BRIDGE ?? `bridge.${NEAR_ROOT}`
export const TGAS = 10n ** 12n
/** NEP-145 minimum to register one account with a token (what the relayer policy accepts). */
export const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n
export const txUrl = (hash: string): string => `${EXPLORER}/txns/${hash}`
export const accountUrl = (id: string): string => `${EXPLORER}/address/${id}`

/** Tokens deployed on testnet (deployments/near.testnet.json). */
export const DEPLOYED_ASSETS = ['usdc', 'idrx', 'myr', 'xau', 'aapl', 'nvda', 'pltr'] as const
export const tokenAccount = (assetKey: string): string => `${assetKey}.${NEAR_ROOT}`

export async function rpc<T = any>(method: string, params: unknown): Promise<T> {
  let last: unknown = new Error('No NEAR RPC configured')
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const j = await res.json()
      if (j.error) throw Object.assign(new Error(j.error.data ?? j.error.message ?? 'rpc error'), { rpcError: j.error })
      return j.result as T
    } catch (e) {
      last = e
      if ((e as { rpcError?: unknown }).rpcError) throw e // a real answer from the chain: do not retry elsewhere
    }
  }
  throw last
}

export async function viewCall<T>(account: string, method: string, args: unknown): Promise<T> {
  const r = await rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)) })
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T
}

export async function tokenBalance(assetKey: string, account: string): Promise<string> {
  try { return await viewCall<string>(tokenAccount(assetKey), 'ft_balance_of', { account_id: account }) } catch { return '0' }
}

export async function accessKeyNonce(account: string, publicKey: string): Promise<bigint> {
  try {
    const r = await rpc<{ nonce: number }>('query', { request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey })
    return BigInt(r.nonce)
  } catch { return 0n }
}

export async function blockHeight(): Promise<bigint> {
  const r = await rpc<{ sync_info: { latest_block_height: number } }>('status', [])
  return BigInt(r.sync_info.latest_block_height)
}

export async function nearBalanceYocto(account: string): Promise<bigint> {
  try { return BigInt((await rpc<{ amount: string }>('query', { request_type: 'view_account', finality: 'final', account_id: account })).amount) } catch { return 0n }
}

/** Is this account registered to hold the token? (NEP-145). A transfer to an unregistered account is refused by the token. */
export async function isRegistered(assetKey: string, account: string): Promise<boolean> {
  const r = await viewCall<{ total: string } | null>(tokenAccount(assetKey), 'storage_balance_of', { account_id: account })
  return r !== null
}
