import { Link, useParams } from 'react-router-dom'
import { AS, AssetIcon } from '@/lib/assets'
import { fm } from '@/lib/format'
import { prototypeHref } from '@/lib/env'
import { lookupLink, type DemoLink } from '@/lib/links'
import { THEME_TINT } from '@/lib/themes'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ThemeArt } from '@/components/ThemeArt'

function Unavailable({ invalid }: { invalid: boolean }) {
  useDocumentTitle('Link not found · Andum')
  return (
    <section className="grid min-h-[70vh] place-items-center !pt-[120px] text-center" aria-labelledby="pl-title">
      <div className="grid max-w-[460px] justify-items-center gap-4">
        <div className="mono">Package link</div>
        <h1 id="pl-title" className="text-balance text-[clamp(34px,7vw,56px)]">{invalid ? 'That does not look like a package link' : 'This link is not active'}</h1>
        <p className="lede">
          {invalid
            ? 'Link names use letters, numbers and single hyphens. Check the link you were sent.'
            : 'It may have expired, or the sender changed the name. Ask them to send it again.'}
        </p>
        <Link className="btn mt-2" to="/">Back to home</Link>
      </div>
    </section>
  )
}

/** What a receiver sees when they open a custom link (andum.app/p/<name>). */
export function PackageLinkPage() {
  const { slug } = useParams()
  const found = lookupLink(slug)
  if (found.kind !== 'found') return <Unavailable invalid={found.kind === 'invalid'} />
  return <Found link={found.link} />
}

function Found({ link }: { link: DemoLink }) {
  useDocumentTitle(`${link.title} · Andum`)
  const total = link.parts.reduce<Record<string, number>>((t, p) => ({ ...t, [p.a]: (t[p.a] ?? 0) + p.amt }), {})
  return (
    <section className="!pt-[110px]" aria-labelledby="pl-title">
      <div className="mx-auto grid max-w-[560px] gap-6">
        <div className="relative grid justify-items-center gap-3 py-2 text-center" style={{ ['--tint' as string]: THEME_TINT[link.theme] }}>
          <div className="absolute h-[190px] w-[190px] rounded-full" style={{ background: 'radial-gradient(closest-side, var(--tint), transparent)' }} aria-hidden="true" />
          <ThemeArt theme={link.theme} className="relative h-[84px] w-[84px]" />
          <div className="mono relative">{link.from} · Andum</div>
        </div>
        <div className="text-center">
          <h1 id="pl-title" className="text-balance text-[clamp(34px,8vw,54px)]">{link.title}</h1>
          <p className="lede mx-auto mt-3.5">{link.from} sent {link.to} a package. The money is already in it. Each part opens on its own terms.</p>
        </div>

        <div className="rounded-2xl border border-line bg-card px-4 py-1" role="list" aria-label="Parts">
          {link.parts.map((p, i) => (
            <div key={i} role="listitem" className="flex items-center justify-between gap-3 border-b border-line py-3.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <AssetIcon a={p.a} size={30} />
                <div>
                  <div className="font-display text-[21px] tracking-[-.02em]">{fm(p.a, p.amt)} <small className="text-sm text-muted">{AS[p.a].u}</small></div>
                  <div className="text-[13px] text-muted">{p.opens}</div>
                </div>
              </div>
              <span className="chip wait">Locked</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm text-muted">
          <span>Inside</span>
          <b className="num font-medium text-fg">{Object.entries(total).map(([a, n]) => `${fm(a as keyof typeof AS, n)} ${AS[a as keyof typeof AS].u}`).join(' + ')}</b>
        </div>
        {link.note && <span className="chip info mx-auto">{link.from} left you a note</span>}

        <div className="grid gap-3">
          <a className="btn w-full justify-center" href={prototypeHref('#receive')} target="_blank" rel="noreferrer">
            Accept package <span className="arr">→</span>
          </a>
          <Link className="btn ghost w-full justify-center" to="/">What is Andum?</Link>
        </div>
        <p className="text-center text-[13px] text-faint">You will confirm with a code sent to your email. Andum pays the network fee.</p>
      </div>
    </section>
  )
}
