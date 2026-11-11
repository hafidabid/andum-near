import { Link } from 'react-router-dom'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export function NotFoundPage() {
  useDocumentTitle('Page not found · Andum')
  return (
    <section className="grid min-h-[70vh] place-items-center !pt-[120px] text-center" aria-labelledby="nf-title">
      <div className="grid max-w-[460px] justify-items-center gap-4">
        <div className="mono">Error 404</div>
        <h1 id="nf-title" className="text-balance text-[clamp(38px,7vw,64px)]">This page does not exist</h1>
        <p className="lede">The link may be mistyped, or the page may have moved. Start again from the home page.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link className="btn" to="/">Back to home</Link>
          <Link className="btn ghost" to={{ pathname: '/', hash: '#faq' }}>Read the FAQ</Link>
        </div>
      </div>
    </section>
  )
}
