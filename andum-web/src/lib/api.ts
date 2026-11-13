/** Typed client for the Andum API (backend/). Every failure becomes an ApiError with the server's error code. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8090').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestOpts {
  signal?: AbortSignal
  /** abort the request after this many ms (default 15 s) */
  timeoutMs?: number
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000)
  opts.signal?.addEventListener('abort', () => ctl.abort())
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new ApiError(0, 'NETWORK', ctl.signal.aborted ? 'The server took too long to answer' : 'Cannot reach the Andum server')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: unknown = undefined
  try { json = text ? JSON.parse(text) : undefined } catch { /* not json */ }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined)?.error
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? `Request failed (${res.status})`, e?.details ?? {})
  }
  return json as T
}

// ---------------------------------------------------------------- shapes returned by the API
export interface UserView { user_id: string; email: string | null; near_account_id: string | null; public_key: string | null; key_required: boolean; has_backup: boolean }

export interface PartView {
  part_id: number; token: string; amount: string; unlock_ns: string | null; approvers: string[]; threshold: number
  approvals: string[]; approved: boolean; state: 'LOCKED' | 'PENDING' | 'TAKEN'; status: string; reason: string | null; taken_ns: string | null
}
export interface PackageView {
  id: string; sender: string; recipient: string | null; owner: string | null; status: string; note: string | null; theme: string
  accept_by_ns: string; created_ns: string; accepted_ns: string | null; parts: PartView[]
}
export interface PublicInvite {
  sender_display: string
  package: null | {
    id: string; status: string; theme: string; has_note: boolean
    parts: Array<{ token: string; amount: string; unlock_ns: string | null; approver_count: number; threshold: number }>
    total_by_token: Record<string, string>
  }
  accept_by_ms: number | null
  email_hint: string
  title: string | null
}
export interface RelayStatus { status: 'QUEUED' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'REFUSED' | string; tx_hash?: string; error_code?: string; error_message?: string }

export const apiClient = {
  time: () => api<{ server_ms: number; chain_ns: string | null }>('GET', '/v1/time'),
  me: () => api<UserView>('GET', '/v1/auth/me'),
  logout: () => api<{ ok: true }>('POST', '/v1/auth/logout'),
  emailStart: (email: string) => api<{ sent: true; resend_after_s: number }>('POST', '/v1/auth/email/start', { email }),
  emailVerify: (email: string, code: string) => api<UserView>('POST', '/v1/auth/email/verify', { email, code }),
  nonce: () => api<{ nonce: string }>('GET', '/v1/auth/nonce'),
  bindKey: (b: { public_key: string; signature: string; nonce: string }) => api<UserView>('POST', '/v1/auth/key', b),
  bootstrap: () => api<{ account_id: string; created: boolean; near_balance_yocto: string; topup_tx?: string }>('POST', '/v1/accounts/bootstrap'),
  faucet: (asset_id: string, amount?: string) => api<{ tx_hash: string; minted: string }>('POST', '/v1/faucet/near', { asset_id, amount }),
  relaySubmit: (signed_delegate_b64: string, client_request_id: string, purpose?: string) =>
    api<{ relay_id: string; status: string }>('POST', '/v1/relay/submit', { signed_delegate_b64, client_request_id, purpose }),
  relayStatus: (id: string) => api<RelayStatus>('GET', `/v1/relay/${id}`),
  packages: (role: 'sender' | 'owner' | 'approver') => api<{ items: PackageView[]; next: string | null }>('GET', `/v1/packages?role=${role}`),
  package: (id: string) => api<PackageView>('GET', `/v1/packages/${id}`),
  events: (id: string) => api<Array<{ event: string; data: Record<string, unknown>; tx_hash: string; ts: number }>>('GET', `/v1/packages/${id}/events`),
  createInvite: (recipient_email: string) => api<{ invite_id: string; invite_hash_b64: string }>('POST', '/v1/invites', { recipient_email }),
  attach: (id: string, package_id: string, tx_hash: string) => api<{ status: string }>('POST', `/v1/invites/${id}/attach`, { package_id, tx_hash }),
  linkCheck: (slug: string) => api<{ available: boolean; reason?: string; suggestion?: string }>('GET', `/v1/links/check?slug=${encodeURIComponent(slug)}`),
  linkPatch: (id: string, b: { slug?: string; title?: string; show_amount?: boolean }) =>
    api<{ slug: string | null; url: string; title: string | null }>('PATCH', `/v1/invites/${id}/link`, b),
  resolveLink: (slug: string) => api<{ invite_id: string; redirect_to?: string }>('GET', `/v1/links/${encodeURIComponent(slug)}`),
  publicInvite: (id: string) => api<PublicInvite>('GET', `/v1/invites/${encodeURIComponent(id)}/public`),
  verifyStart: (id: string) => api<{ sent: true; resend_after_s: number }>('POST', `/v1/invites/${encodeURIComponent(id)}/verify/start`),
  verifyConfirm: (id: string, code: string) => api<{ package_id: string; invite_secret: string }>('POST', `/v1/invites/${encodeURIComponent(id)}/verify/confirm`, { code }),
}
