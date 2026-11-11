# Andum landing page

Vite + React 18 + TypeScript + Tailwind CSS 3 + React Router 6. Tested with Vitest and Testing Library.
This is the same page as the standalone HTML landing, rebuilt as components. Desktop and mobile were compared against the original screenshot by screenshot.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 142 unit and routing tests
npm run typecheck
npm run build        # type-checks, then builds to dist/
npm run preview      # serve the production build on :4173
```

Node 20 or newer (`.nvmrc` says 22). Optional: copy `.env.example` to `.env.local` and set `VITE_PROTOTYPE_URL`.

## Routes

| Path | Page |
|---|---|
| `/` | Landing page. Sections: `#ways #build #how #receiving #chains #uses #roles #faq` |
| `/p/:slug` | What a receiver sees at a custom link, for example `/p/rina-audit-bonus`, `/p/aina-birthday` |
| `/p` | Redirects to `/` |
| anything else | 404 page |

Links to a section use `/#id` everywhere (`SectionLink`), so they work from any page. `ScrollManager` scrolls to the section after the route renders, and to the top on any other navigation. The site needs a "send every path to index.html" rule on the host: `public/_redirects` (Netlify, Cloudflare Pages) and `vercel.json` are included. Set `base` in `vite.config.ts` if you deploy under a sub-path; the router follows `BASE_URL`.

`/p/:slug` reads example data from `src/lib/links.ts`. In the product that lookup becomes `GET /v1/links/{slug}` (see the build plan).

## Layout

```
src/
  App.tsx                 routes
  main.tsx                BrowserRouter, styles
  pages/                  LandingPage, PackageLinkPage, NotFoundPage
  components/             one file per section, plus Layout, TopBar, Dock, WalletSheet
  hooks/                  useMedia, useInView, useScrollProgress, useFrame, useTween ...
  lib/                    pure logic and content: lanes, hero, scenarios, roles, faq, chains, slug, links
  styles/legacy.css       the design's component CSS, unchanged
  styles/index.css        Tailwind layers
  test/setup.ts           jsdom stand-ins for IntersectionObserver and matchMedia
```

Logic that decides what is shown (which part is open on a given day, which scenario a scroll position selects, who may do what) lives in `src/lib` as plain functions with tests. Components only draw it.

## How styling works

- `legacy.css` carries the design as written for the standalone page: tokens as CSS variables, the pinned chapters, the lanes, the phone, and the mobile and tablet layouts. Keeping it untouched is what keeps the page identical.
- Tailwind is configured to read the same tokens (`text-muted`, `bg-card`, `border-line`, `font-display` ...) and is used for layout and spacing in the new pages and for small adjustments inside components. Preflight is off because `legacy.css` already has the resets the design depends on. Tailwind utilities load after `legacy.css`, so a utility wins over a legacy rule of the same strength.
- To move more of the page to utilities later, replace one component's classes at a time. Nothing else depends on them.

## Behaviour worth knowing

- Below 900 px the pinned, scroll-driven chapters turn into touch layouts: a swipeable carousel (Ways), a connected stepper (How), a timer-driven scenario player (Uses) and a docked action bar. `useIsDesktop` decides.
- `prefers-reduced-motion` is respected: timelines start paused, lanes jump to their end state and particles do not play.
- The wallet sheet shows the network name only after a wallet is "connected", on purpose.
- Fonts come from Google Fonts in `index.html`. Self-host them if the site must not call third parties.

## What the tests cover

Unit: formatting, lane status, hero timeline, scenario selection, permission matrix, slug rules, link lookup, content tables, hooks.
Component: hero, composer (add, remove, rules, amounts, timeline), FAQ, wallet sheet (open, close, Escape, backdrop, connect flow), cross-chain route, scenario picker, role demo, receiving phone, assets strip.
Routing: every route, case-insensitive link names, unknown and malformed links, `/p` redirect, 404 and its way back, hash links from the same page and from other pages, opening on a hash, brand link, scroll-to-top, footer links, shared chrome on every page, external links.

Not covered by unit tests: pointer dragging of the date markers, real scroll-driven pinning, CSS layout. Those were checked in a browser.
