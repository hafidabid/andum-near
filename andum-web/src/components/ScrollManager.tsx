import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Makes navigation feel like a normal page:
 * - a link with a hash (/#faq) scrolls to that section, even when it comes from another route
 * - any other navigation starts at the top
 */
export function ScrollManager() {
  const { pathname, hash, key } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const id = decodeURIComponent(hash.slice(1))
    let tries = 0
    let raf = 0
    const go = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else if (tries++ < 30) raf = requestAnimationFrame(go)
    }
    go()
    return () => cancelAnimationFrame(raf)
  }, [pathname, hash, key])
  return null
}
