import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests drive the real UI against the real stack: API, worker, relayer, Postgres, Redis, Mailpit and NEAR testnet.
 * Start the stack first (docs/LIVE-RUNBOOK.md), then: npm run test:e2e
 * Outside the live journey, specs only touch the API and never the chain.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  // a step that cannot find its element fails in 30 s instead of hanging until the test timeout
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    actionTimeout: 30_000,
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.RECORD ? { mode: 'on', size: { width: 1280, height: 900 } } : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
})
