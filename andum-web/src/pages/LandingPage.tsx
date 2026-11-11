import { AssetsMarquee } from '@/components/AssetsMarquee'
import { Chains } from '@/components/Chains'
import { Composer } from '@/components/Composer'
import { Faq } from '@/components/Faq'
import { FinalCta } from '@/components/FinalCta'
import { Hero } from '@/components/Hero'
import { How } from '@/components/How'
import { Receiving } from '@/components/Receiving'
import { Roles } from '@/components/Roles'
import { Uses } from '@/components/Uses'
import { Ways } from '@/components/Ways'
import { DEFAULT_TITLE, useDocumentTitle } from '@/hooks/useDocumentTitle'

export function LandingPage() {
  useDocumentTitle(DEFAULT_TITLE)
  return (
    <>
      <Hero />
      <AssetsMarquee />
      <Ways />
      <Composer />
      <How />
      <Receiving />
      <Chains />
      <Uses />
      <Roles />
      <Faq />
      <FinalCta />
    </>
  )
}
