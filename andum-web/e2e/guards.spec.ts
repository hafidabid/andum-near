import { expect, test } from '@playwright/test'
import { API, mailCode, signIn, uniq } from './helpers'

// Negative and edge cases that need the real API but not the chain.

test.describe('receiver links', () => {
  test('a malformed link name is rejected before any request', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (r) => { if (r.url().startsWith(API)) calls.push(r.url()) })
    await page.goto('/p/AB')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('does not look like a package link')
    expect(calls.filter((u) => u.includes('/v1/links/'))).toHaveLength(0)
  })

  test('an unknown link says it is not active', async ({ page }) => {
    await page.goto('/p/nobody-here-' + uniq().slice(0, 4))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link is not active')
  })

  test('an unknown invite id says it is not active', async ({ page }) => {
    await page.goto('/i/does-not-exist')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link is not active')
  })

  test('the API being down is explained, not a blank page', async ({ page }) => {
    await page.route(`${API}/**`, (r) => r.abort())
    await page.goto('/p/some-link')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('We cannot reach Andum right now')
  })
})

test.describe('sign in', () => {
  test('an invalid email never reaches the server', async ({ page }) => {
    let sent = 0
    page.on('request', (r) => { if (r.url().includes('/auth/email/start')) sent++ })
    await page.goto('/app')
    await page.getByLabel('Your email').fill('not-an-email')
    await page.getByRole('button', { name: 'Send me a code' }).click()
    await expect(page.getByRole('alert')).toContainText('valid email')
    expect(sent).toBe(0)
  })

  test('a wrong code is refused with the attempts left, a short code is caught in the form', async ({ page }) => {
    const email = `wrong+${uniq()}@example.com`
    await page.goto('/app')
    await page.getByLabel('Your email').fill(email)
    await page.getByRole('button', { name: 'Send me a code' }).click()
    await page.getByLabel('Sign-in code').fill('12')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('alert')).toContainText('6 digits')
    const real = await mailCode(email)
    const wrong = real === '000000' ? '111111' : '000000'
    await page.getByLabel('Sign-in code').fill(wrong)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('alert')).toContainText(/not right.*tries left/)
    // the right code still works afterwards
    await page.getByLabel('Sign-in code').fill(real)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByTestId('account-id')).toBeVisible()
  })

  test('the session survives a reload, and signing out ends it', async ({ page }) => {
    const email = `reload+${uniq()}@example.com`
    await page.goto('/app')
    await signIn(page, email, new Set())
    const account = await page.getByTestId('account-id').textContent()
    await page.reload()
    await expect(page.getByTestId('account-id')).toHaveText(account!)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to send or approve' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in to send or approve' })).toBeVisible()
  })

  test('the same email on a device without its key is told so', async ({ browser }) => {
    test.slow()
    const email = `device+${uniq()}@example.com`
    const seen = new Set<string>()
    const a = await (await browser.newContext()).newPage()
    await a.goto('/app')
    await signIn(a, email, seen)
    await expect(a.getByTestId('account-id')).toBeVisible()
    const b = await (await browser.newContext()).newPage() // a fresh browser profile: no key
    await b.goto('/app')
    await b.getByLabel('Your email').fill(email)
    await b.getByRole('button', { name: 'Send me a code' }).click()
    // edge: asking again inside the 60 s cooldown is refused and the form shows the countdown
    await expect(b.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled()
    await b.waitForTimeout(62_000)
    await b.getByRole('button', { name: 'Resend code' }).click()
    await b.getByLabel('Sign-in code').fill(await mailCode(email, seen))
    await b.getByRole('button', { name: 'Continue' }).click()
    await expect(b.getByRole('alert')).toContainText('key on another device')
  })
})

test.describe('builder validation (nothing is signed until the form is valid)', () => {
  test('catches every bad input before signing', async ({ page }) => {
    const relay: string[] = []
    page.on('request', (r) => { if (r.url().includes('/v1/relay/submit') || r.url().includes('/v1/invites')) relay.push(r.url()) })
    await page.goto('/app')
    await signIn(page, `build+${uniq()}@example.com`, new Set())
    await page.getByRole('button', { name: /Create and send/ }).click()
    await expect(page.getByText('Enter the recipient’s email address.')).toBeVisible()
    await expect(page.getByText(/Enter an amount above zero/)).toBeVisible()

    await page.getByLabel('Recipient email').fill('rina@example.com')
    await page.getByLabel('Part 1 amount').fill('0')
    await page.getByRole('button', { name: /Create and send/ }).click()
    await expect(page.getByText(/Enter an amount above zero/)).toBeVisible()

    await page.getByLabel('Part 1 amount').fill('1.1234567')
    await page.getByRole('button', { name: /Create and send/ }).click()
    await expect(page.getByText(/up to 6 decimals/)).toBeVisible()

    // approvers without a date, a date in the past, a taken-looking reserved link name
    await page.getByLabel('Part 1 amount').fill('5')
    await page.getByLabel('Link name').fill('admin')
    await page.getByLabel('Part 1 opens on a date').check()
    await page.getByLabel('Part 1 date').fill('2020-01-01T10:00')
    await page.getByRole('button', { name: /Create and send/ }).click()
    await expect(page.getByText('The date must be in the future.')).toBeVisible()
    await expect(page.getByText('That name is reserved.')).toBeVisible()

    // more than 8 parts is not possible
    await page.getByLabel('Part 1 opens on a date').uncheck()
    for (let i = 0; i < 7; i++) await page.getByRole('button', { name: '+ Add a part' }).click()
    await expect(page.getByRole('button', { name: '+ Add a part' })).toBeDisabled()

    // a balance of zero is explained and nothing was sent
    await page.getByLabel('Link name').fill('')
    for (let i = 1; i <= 8; i++) await page.getByLabel(`Part ${i} amount`).fill('1')
    await page.getByRole('button', { name: /Create and send/ }).click()
    await expect(page.getByText(/this package needs/)).toBeVisible()
    expect(relay).toHaveLength(0)
  })
})
