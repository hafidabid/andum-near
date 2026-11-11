import { useEffect } from 'react'

export const DEFAULT_TITLE = 'Andum: packages for money and assets'

/** Sets the tab title while the component is mounted and restores the default after. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title
    document.title = title
    return () => {
      document.title = prev === title ? DEFAULT_TITLE : prev
    }
  }, [title])
}
