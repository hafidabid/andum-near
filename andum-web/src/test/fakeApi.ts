import { vi } from 'vitest'

export type Handler = (req: { body: any; url: URL }) => [number, unknown] | Promise<[number, unknown]> | 'network'
export interface FakeApi { calls: Array<{ key: string; body: any }>; routes: Record<string, Handler>; count(prefix: string): number }

export const err = (status: number, code: string, message = code, details: Record<string, unknown> = {}): [number, unknown] => [status, { error: { code, message, details } }]

/** Replace fetch with a table of "METHOD /path" -> handler. Unknown routes answer 404 so a missing mock is loud. NEAR RPC is faked too. */
export function installFakeApi(routes: Record<string, Handler>): FakeApi {
  const fake: FakeApi = { calls: [], routes, count: (p) => fake.calls.filter((c) => c.key.startsWith(p)).length }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url.pathname === '/' && method === 'POST' && body?.jsonrpc) return rpc(body)
    const key = `${method} ${url.pathname}`
    fake.calls.push({ key, body })
    const h = fake.routes[key]
    if (!h) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: key, details: {} } }), { status: 404 })
    const r = await h({ body, url })
    if (r === 'network') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(r[1]), { status: r[0], headers: { 'content-type': 'application/json' } })
  }))
  return fake
}

function rpc(b: { method: string; params: any }) {
  const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
  if (b.method === 'status') return ok({ sync_info: { latest_block_height: 1000 } })
  if (b.method === 'query' && b.params.request_type === 'view_access_key') return ok({ nonce: 7 })
  if (b.method === 'query' && b.params.request_type === 'call_function') return ok({ result: Array.from(new TextEncoder().encode('"10000000000"')) })
  return ok({})
}

export const user = (over: Partial<Record<string, unknown>> = {}) => ({ user_id: 'u1', email: 'rina@example.com', near_account_id: null, public_key: null, key_required: true, has_backup: false, ...over })

export const publicInvite = (over: Record<string, unknown> = {}) => ({
  sender_display: 'abc', accept_by_ms: Date.now() + 3_600_000, email_hint: 'r***@example.com', title: 'Your audit bonus',
  package: {
    id: '7', status: 'FUNDED', theme: 'confetti', has_note: true,
    parts: [
      { token: 'usdc.hafidbuild.testnet', amount: '200000000', unlock_ns: null, approver_count: 0, threshold: 1 },
      { token: 'usdc.hafidbuild.testnet', amount: '800000000', unlock_ns: String(BigInt(Date.now() + 86_400_000) * 1_000_000n), approver_count: 2, threshold: 2 },
    ],
    total_by_token: { 'usdc.hafidbuild.testnet': '1000000000' },
  },
  ...over,
})
