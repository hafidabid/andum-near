import { Outlet } from 'react-router-dom'
import { useSpotlight } from '@/hooks/useSpotlight'
import { Dock } from './Dock'
import { Footer } from './Footer'
import { ScrollManager } from './ScrollManager'
import { TopBar } from './TopBar'
import { WalletProvider } from './WalletContext'

/** Chrome shared by every page: background light, navigation, footer, wallet sheet. */
export function Layout() {
  useSpotlight()
  return (
    <WalletProvider>
      <ScrollManager />
      <div className="glow" aria-hidden="true" />
      <div className="gridlines" aria-hidden="true" />
      <TopBar />
      <main className="wrap" id="top">
        <Outlet />
        <Footer />
      </main>
      <Dock />
    </WalletProvider>
  )
}
