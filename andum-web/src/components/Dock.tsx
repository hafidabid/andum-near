import { useEffect, useState } from 'react'
import { cx } from '@/lib/format'
import { useWallet } from './WalletContext'

/** Pure rule for when the phone-width action bar shows. */
export function dockVisible(scrollY: number, heroHeight: number, finalTop: number | null, viewportHeight: number, sheetOpen: boolean): boolean {
  if (sheetOpen) return false
  if (finalTop !== null && finalTop < viewportHeight * 0.9) return false
  return scrollY > heroHeight * 0.72
}

/** Action bar docked to the bottom on phones once the hero has scrolled away. */
export function Dock() {
  const { open, isOpen } = useWallet()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let raf = 0
    const run = () => {
      raf = 0
      const hero = document.querySelector('.hero') as HTMLElement | null
      const fin = document.querySelector('.final') as HTMLElement | null
      setShow(hero ? dockVisible(window.scrollY, hero.offsetHeight, fin ? fin.getBoundingClientRect().top : null, window.innerHeight, isOpen) : false)
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(run)
    }
    run()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [isOpen])

  useEffect(() => {
    document.body.classList.toggle('docked', show)
    return () => document.body.classList.remove('docked')
  }, [show])

  return (
    <div className={cx('dock', show && 'show')} id="dock">
      <button className="btn" onClick={open} tabIndex={show ? 0 : -1}>
        Send a package <span className="arr">→</span>
      </button>
    </div>
  )
}
