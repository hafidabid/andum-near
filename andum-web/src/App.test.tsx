import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'
import { ROUTER_FUTURE } from './routerFuture'
import { DEFAULT_TITLE } from './hooks/useDocumentTitle'

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.hash}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  document.title = DEFAULT_TITLE
  vi.mocked(window.scrollTo).mockClear()
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
})

describe('routing', () => {
  it('/ shows the landing page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pay in parts.')
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument()
    expect(document.title).toBe(DEFAULT_TITLE)
  })

  it('/p/<known> shows the package link page with its title', () => {
    renderAt('/p/rina-audit-bonus')
    expect(screen.getByRole('heading', { level: 1, name: 'Your audit bonus' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Parts' })).toBeInTheDocument()
    expect(screen.getByText('Opens 15 Nov, after Dewi approves')).toBeInTheDocument()
    expect(screen.getByText('Dewi left you a note')).toBeInTheDocument()
    expect(document.title).toBe('Your audit bonus · Andum')
    expect(screen.queryByRole('heading', { name: 'Frequently asked questions' })).not.toBeInTheDocument()
  })

  it('link names are not case sensitive', () => {
    renderAt('/p/Rina-Audit-Bonus')
    expect(screen.getByRole('heading', { level: 1, name: 'Your audit bonus' })).toBeInTheDocument()
  })

  it('the second example link opens too', () => {
    renderAt('/p/aina-birthday')
    expect(screen.getByRole('heading', { level: 1, name: 'Happy birthday, Aina' })).toBeInTheDocument()
    expect(screen.getByText(/5,000 MYR/)).toBeInTheDocument()
  })

  it('/p/<well-formed but unknown> says the link is not active', () => {
    renderAt('/p/nobody-here')
    expect(screen.getByRole('heading', { level: 1, name: 'This link is not active' })).toBeInTheDocument()
    expect(document.title).toBe('Link not found · Andum')
  })

  it('/p/<malformed> says it is not a package link', () => {
    renderAt('/p/AB')
    expect(screen.getByRole('heading', { level: 1, name: /does not look like a package link/ })).toBeInTheDocument()
  })

  it('/p alone goes home', () => {
    renderAt('/p')
    expect(where()).toBe('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pay in parts.')
  })

  it('anything else is a 404 with a way back', async () => {
    const user = userEvent.setup()
    renderAt('/nope/not-here')
    expect(screen.getByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
    expect(document.title).toBe('Page not found · Andum')
    await user.click(screen.getByRole('link', { name: 'Back to home' }))
    expect(where()).toBe('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pay in parts.')
  })
})

describe('navigation', () => {
  it('every nav link points at a section of the landing page', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const hrefs = within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/#ways', '/#build', '/#how', '/#chains', '/#uses', '/#roles', '/#faq'])
  })

  it('every section a link points to exists on the landing page', () => {
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const a of within(nav).getAllByRole('link')) {
      const hash = a.getAttribute('href')!.split('#')[1]
      if (hash) expect(document.getElementById(hash), `#${hash}`).not.toBeNull()
    }
    for (const id of ['ways', 'build', 'how', 'receiving', 'chains', 'uses', 'roles', 'faq']) {
      expect(document.getElementById(id), `#${id}`).not.toBeNull()
    }
  })

  it('a section link on the landing page scrolls to that section', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'FAQ' }))
    expect(where()).toBe('/#faq')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement
    expect(target.id).toBe('faq')
  })

  it('a section link from another page goes to the landing page and then scrolls', async () => {
    const user = userEvent.setup()
    renderAt('/p/rina-audit-bonus')
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'How it works' }))
    expect(where()).toBe('/#how')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pay in parts.')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect((vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement).id).toBe('how')
  })

  it('opening the site on a hash scrolls to it', async () => {
    renderAt('/#chains')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect((vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement).id).toBe('chains')
  })

  it('a hash that matches nothing does not crash', async () => {
    renderAt('/#no-such-section')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pay in parts.')
  })

  it('the brand link goes home and back to the top', async () => {
    const user = userEvent.setup()
    renderAt('/p/rina-audit-bonus')
    await user.click(screen.getAllByRole('link', { name: 'Andum home' })[0])
    expect(where()).toBe('/')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('moving to another page starts at the top', async () => {
    const user = userEvent.setup()
    renderAt('/p/rina-audit-bonus')
    vi.mocked(window.scrollTo).mockClear()
    await user.click(screen.getByRole('link', { name: 'What is Andum?' }))
    expect(where()).toBe('/')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('the footer links work from any page', async () => {
    const user = userEvent.setup()
    renderAt('/nope')
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Who can do what' })).toHaveAttribute('href', '/#roles')
    await user.click(within(footer).getByRole('link', { name: 'FAQ' }))
    expect(where()).toBe('/#faq')
  })

  it('external links open the prototype in a new tab, safely', () => {
    renderAt('/p/rina-audit-bonus')
    const a = screen.getByRole('link', { name: /Accept package/ })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })
})

describe('shared chrome', () => {
  it('every page has the nav, the footer and the wallet sheet', () => {
    for (const path of ['/', '/p/rina-audit-bonus', '/p/zzz-zzz', '/nope']) {
      const { unmount } = renderAt(path)
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
      expect(screen.getByRole('contentinfo')).toBeInTheDocument()
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument()
      unmount()
    }
  })

  it('"Send a package" in the nav opens the wallet sheet on any page', async () => {
    const user = userEvent.setup()
    renderAt('/nope')
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Send a package/ }))
    expect(screen.getByRole('dialog')).toHaveClass('show')
  })
})
