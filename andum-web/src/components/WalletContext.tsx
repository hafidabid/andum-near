import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type SheetStep = 's1' | 's2' | 's3'

interface WalletApi {
  isOpen: boolean
  step: SheetStep
  wallet: string
  open: () => void
  close: () => void
  choose: (wallet: string) => void
}

const Ctx = createContext<WalletApi | null>(null)

/** How long the "Connecting" step lasts before the wallet shows as connected. */
export const CONNECT_MS = 1300

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)
  const [step, setStep] = useState<SheetStep>('s1')
  const [wallet, setWallet] = useState('')

  const open = useCallback(() => {
    setStep('s1')
    setOpen(true)
  }, [])
  const close = useCallback(() => setOpen(false), [])
  const choose = useCallback((w: string) => {
    setWallet(w)
    setStep('s2')
  }, [])

  useEffect(() => {
    if (step !== 's2') return
    const t = setTimeout(() => setStep('s3'), CONNECT_MS)
    return () => clearTimeout(t)
  }, [step])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  const value = useMemo(() => ({ isOpen, step, wallet, open, close, choose }), [isOpen, step, wallet, open, close, choose])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>')
  return v
}
