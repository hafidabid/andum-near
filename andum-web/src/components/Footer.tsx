import { Link } from 'react-router-dom'
import { BrandMark } from './Icons'
import { SectionLink } from './TopBar'

export function Footer() {
  return (
    <footer>
      <div>
        <Link className="brand mb-2" to="/" aria-label="Andum home">
          <BrandMark />
          Andum
        </Link>
        <div>Packages for money and assets.</div>
        <div className="mt-1.5 text-faint">Built on NEAR</div>
      </div>
      <div className="cols">
        <div>
          <div className="mono mb-2">Product</div>
          <SectionLink id="ways">How parts open</SectionLink>
          <SectionLink id="build">Try it</SectionLink>
          <SectionLink id="chains">Cross-chain</SectionLink>
          <SectionLink id="uses">Uses</SectionLink>
        </div>
        <div>
          <div className="mono mb-2">Help</div>
          <SectionLink id="roles">Who can do what</SectionLink>
          <SectionLink id="faq">FAQ</SectionLink>
        </div>
      </div>
      <div className="grid w-full gap-1.5 text-[13px] text-faint">
        <div>© 2026 Andum</div>
        <div>Company names and logos belong to their owners and appear only to identify assets.</div>
      </div>
    </footer>
  )
}
