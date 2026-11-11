import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useInView } from '@/hooks/useInView'
import { cx } from '@/lib/format'

interface Props {
  className?: string
  /** Transition delay in ms. */
  delay?: number
  style?: CSSProperties
  children: ReactNode
  id?: string
}

/** A block that fades up once when it first scrolls into view. */
export function Rv({ className, delay, style, children, id }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { threshold: 0.12, rootMargin: '0px 0px -6% 0px', once: true })
  return (
    <div id={id} ref={ref} className={cx('rv', seen && 'in', className)} style={{ ...(delay ? { ['--d' as string]: `${delay}ms` } : null), ...style }}>
      {children}
    </div>
  )
}
