import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

interface AppLauncher {
  /** Always false: kept so the dock can ask whether a sheet is covering the page. */
  isOpen: boolean
  /** Go to the working app (sign in, build and send a package). */
  open: () => void
}

const Ctx = createContext<AppLauncher | null>(null)

/** Every "Send a package" call to action opens the real app at /app. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const open = useCallback(() => navigate('/app'), [navigate])
  const value = useMemo(() => ({ isOpen: false, open }), [open])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWallet(): AppLauncher {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>')
  return v
}
