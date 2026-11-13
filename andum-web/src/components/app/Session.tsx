import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiClient, ApiError, type RelayStatus, type UserView } from '@/lib/api'
import { bindKey, loadKey, newKey, saveKey, signAndRelay, type Call, type Key } from '@/lib/wallet'

type Status = 'loading' | 'anon' | 'authed'

interface Ctx {
  status: Status
  user: UserView | null
  email: string | null
  accountId: string | null
  /** Email a sign-in code. */
  requestCode(email: string): Promise<{ resend_after_s: number }>
  /** Check the code, then make or load this browser's NEAR key and bind it. */
  verifyCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
  /** Sign a contract call with the browser key and relay it (the relayer pays gas). */
  call(c: Call, onStatus?: (s: string) => void): Promise<RelayStatus>
}

const SessionCtx = createContext<Ctx | null>(null)

export function useSession(): Ctx {
  const c = useContext(SessionCtx)
  if (!c) throw new Error('useSession must be used inside <SessionProvider>')
  return c
}

export const KEY_ELSEWHERE = 'This email already has its key on another device. Open Andum there, or use a different email.'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserView | null>(null)
  const keyRef = useRef<Key | null>(null)

  // Come back after a reload: the cookie says who we are, localStorage holds the key.
  useEffect(() => {
    let live = true
    apiClient.me().then((u) => {
      if (!live) return
      const k = u.email ? loadKey(u.email) : null
      if (u.near_account_id && k && k.publicKey === u.public_key) { keyRef.current = k; setUser(u); setStatus('authed') }
      else setStatus('anon')
    }).catch(() => live && setStatus('anon'))
    return () => { live = false }
  }, [])

  const requestCode = useCallback((email: string) => apiClient.emailStart(email), [])

  const verifyCode = useCallback(async (email: string, code: string) => {
    let u = await apiClient.emailVerify(email, code)
    let k = loadKey(email)
    if (u.key_required) {
      k = k ?? newKey()
      saveKey(email, k)
      u = await bindKey(k)
    } else if (!k || k.publicKey !== u.public_key) {
      await apiClient.logout().catch(() => undefined)
      throw new Error(KEY_ELSEWHERE)
    }
    // Make sure the NEAR account exists and holds enough NEAR for the relayer to act on it.
    await apiClient.bootstrap().catch((e) => { if (!(e instanceof ApiError && e.code === 'BOOTSTRAP_LIMIT')) throw e })
    keyRef.current = k
    setUser(u)
    setStatus('authed')
  }, [])

  const signOut = useCallback(async () => {
    await apiClient.logout().catch(() => undefined)
    keyRef.current = null
    setUser(null)
    setStatus('anon')
  }, [])

  const call = useCallback((c: Call, onStatus?: (s: string) => void) => {
    if (!keyRef.current) return Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in'))
    return signAndRelay(keyRef.current, c, onStatus)
  }, [])

  const value = useMemo<Ctx>(() => ({
    status, user, email: user?.email ?? null, accountId: user?.near_account_id ?? null, requestCode, verifyCode, signOut, call,
  }), [status, user, requestCode, verifyCode, signOut, call])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}
