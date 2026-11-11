import type { Config } from 'tailwindcss'

/**
 * The design tokens live as CSS variables in src/styles/legacy.css (:root).
 * Tailwind reads them here so utilities and the component CSS always agree.
 * Preflight is off: legacy.css already carries the resets this design was built on.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        card: 'var(--card)',
        card2: 'var(--card2)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        open: 'var(--open)',
        wait: 'var(--wait)',
        blue: 'var(--blue)',
        bad: 'var(--bad)',
        line: 'var(--line)',
        line2: 'var(--line2)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      transitionTimingFunction: { andum: 'var(--ease)' },
    },
  },
  plugins: [],
} satisfies Config
