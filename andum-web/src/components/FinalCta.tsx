import { Rv } from './Rv'
import { useWallet } from './WalletContext'

export function FinalCta() {
  const { open } = useWallet()
  return (
    <Rv className="final">
      <h2>Send your first package</h2>
      <p>Fund it once. Each part opens when you said it would.</p>
      <button className="btn" onClick={open}>
        Send a package <span className="arr">→</span>
      </button>
    </Rv>
  )
}
