import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './Icons'
import { useWallet } from './WalletContext'
import { cx } from '@/lib/format'

export const NAV_LINKS: Array<{ id: string; label: string }> = [
  { id: 'ways', label: 'Parts' },
  { id: 'build', label: 'Try it' },
  { id: 'how', label: 'How it works' },
  { id: 'chains', label: 'Cross-chain' },
  { id: 'uses', label: 'Uses' },
  { id: 'roles', label: 'Roles' },
  { id: 'faq', label: 'FAQ' },
]

/** Link to a section of the landing page that also works from other routes. */
export function SectionLink({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <Link to={{ pathname: '/', hash: `#${id}` }} className={className}>
      {children}
    </Link>
  )
}

/** Fixed navigation plus the reading-progress bar. */
export function TopBar() {
  const { open } = useWallet()
  const [scrolled, setScrolled] = useState(false)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const on = () => {
      setScrolled(window.scrollY > 24)
      const h = document.documentElement
      const max = h.scrollHeight - h.clientHeight
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <>
      <div className="pbar" ref={bar} aria-hidden="true" />
      <nav className={cx('top', scrolled && 'scrolled')} id="nav" aria-label="Main">
        <div className="in">
          <Link className="brand" to="/" aria-label="Andum home">
            <BrandMark />
            Andum
          </Link>
          <div className="links">
            {NAV_LINKS.map((l) => (
              <SectionLink key={l.id} id={l.id}>
                {l.label}
              </SectionLink>
            ))}
          </div>
          <button className="btn sm" onClick={open}>
            Send a package <span className="arr">→</span>
          </button>
        </div>
      </nav>
    </>
  )
}
