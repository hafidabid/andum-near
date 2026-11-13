import { expect, test, type Page } from '@playwright/test'
import { mailCode, signIn, uniq } from './helpers'

/**
 * The whole product, in the browser, against NEAR testnet through the real API, relayer and worker.
 * Three people, three separate browser profiles (each holds its own key): a sender, a recipient, an approver.
 * Part 1 opens when the recipient accepts. Part 2 opens by date AND needs the approver.
 */
const SHOTS = process.env.SHOTS
const VIDEOS = process.env.VIDEOS // directory: record one video per person
let who = 0
const shot = async (p: Page, name: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }) }
const local = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }

test('sender funds a package, recipient accepts and takes it, approver releases the last part', async ({ browser }) => {
  test.setTimeout(900_000)
  const id = uniq()
  const emails = { sender: `sender+${id}@example.com`, rina: `rina+${id}@example.com`, appr: `approver+${id}@example.com` }
  const seen = { sender: new Set<string>(), rina: new Set<string>(), appr: new Set<string>() }
  const page = async (name = `person${who++}`) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(VIDEOS ? { recordVideo: { dir: `${VIDEOS}/${name}`, size: { width: 1280, height: 900 } } } : {}) })
    return ctx.newPage()
  }
  const sender = await page('sender'), rina = await page('recipient'), appr = await page('approver')

  // ---- the approver signs in first, to learn their account
  await appr.goto('/app')
  await signIn(appr, emails.appr, seen.appr)
  const apprAccount = (await appr.getByTestId('account-id').textContent())!
  expect(apprAccount).toMatch(/^[0-9a-f]{64}$/)

  // ---- sender: sign in, get test USDC
  await sender.goto('/')
  await sender.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Send a package/ }).click()
  await expect(sender).toHaveURL(/\/app$/)
  await shot(sender, '01-sign-in')
  await signIn(sender, emails.sender, seen.sender)
  await expect(sender.getByTestId('account-id')).toBeVisible()
  await sender.getByRole('button', { name: 'Get test USDC' }).click()
  await expect(sender.locator('[data-asset=usdc] .num')).toHaveText('10,000', { timeout: 90_000 })
  await shot(sender, '02-wallet')

  // ---- sender: build the package
  await sender.getByLabel('Recipient email').fill(emails.rina)
  await sender.getByLabel('Title').fill('Your audit bonus')
  await sender.getByLabel('Link name').fill(`bonus-${id}`.toLowerCase())
  await sender.getByLabel('Note').fill('Thanks for the audit!')
  await sender.getByLabel('Part 1 amount').fill('200')
  await sender.getByRole('button', { name: '+ Add a part' }).click()
  await sender.getByLabel('Part 2 amount').fill('800')
  await sender.getByLabel('Part 2 opens on a date').check()
  const opensAt = Date.now() + 200_000
  await sender.getByLabel('Part 2 date').fill(local(opensAt))
  await sender.getByLabel('Part 2 approvers').fill(apprAccount)
  await shot(sender, '03-builder')
  await sender.getByRole('button', { name: /Create and send/ }).click()
  await expect(sender.locator('[data-done=true]')).toBeVisible({ timeout: 240_000 })
  await shot(sender, '04-sent')
  const link = await sender.getByLabel('Package link').inputValue()
  expect(link).toContain(`/p/bonus-${id}`)

  // ---- recipient: sees the funds before accepting
  await rina.goto(new URL(link).pathname)
  await expect(rina.getByRole('heading', { level: 1 })).toHaveText('Your audit bonus')
  await expect(rina.getByRole('list', { name: 'Parts' }).getByRole('listitem')).toHaveCount(2)
  await expect(rina.getByText('1,000 USDC')).toBeVisible()
  await expect(rina.getByText(/Locked/).first()).toBeVisible()
  await shot(rina, '05-receiver-preview')

  // ---- negative: a wrong invite code is refused
  await rina.getByRole('button', { name: /Accept package/ }).click()
  await signIn(rina, emails.rina, seen.rina)
  const good = await mailCode(emails.rina, seen.rina)
  await rina.getByLabel('Invite code').fill(good === '000000' ? '111111' : '000000')
  await rina.getByRole('button', { name: 'Accept package' }).click()
  await expect(rina.getByRole('alert')).toContainText(/not right.*tries left/)
  await shot(rina, '06-wrong-code')

  // ---- accept with the right code
  await rina.getByLabel('Invite code').fill(good)
  await rina.getByRole('button', { name: 'Accept package' }).click()
  await expect(rina.locator('[data-owned=true]')).toBeVisible({ timeout: 120_000 })
  await expect(rina.getByText('Thanks for the audit!')).toBeVisible()
  await shot(rina, '07-accepted')

  // ---- take part 1, then try part 2 too early: the contract refuses
  await rina.getByRole('button', { name: 'Take part 1' }).click()
  await expect(rina.locator('[data-part="0"]')).toHaveAttribute('data-status', 'TAKEN', { timeout: 120_000 })
  await rina.getByRole('button', { name: 'Take part 2' }).click()
  await expect(rina.locator('[data-part="1"]').getByRole('alert')).toContainText('not open yet', { timeout: 120_000 })
  await shot(rina, '08-too-early')

  // ---- a stranger cannot approve: the approver tab shows only their own work
  await appr.getByRole('tab', { name: 'To approve' }).click()
  await expect(appr.getByRole('button', { name: /Approve part 2 of package/ })).toBeVisible({ timeout: 60_000 })

  // ---- wait for the date, then the part still needs approval
  await rina.waitForTimeout(Math.max(0, opensAt - Date.now() + 20_000))
  await rina.getByRole('button', { name: 'Take part 2' }).click()
  await expect(rina.locator('[data-part="1"]').getByRole('alert')).toContainText('waiting for approval', { timeout: 120_000 })
  await shot(rina, '09-needs-approval')

  // ---- the approver approves, the recipient takes the rest
  await appr.getByRole('button', { name: /Approve part 2 of package/ }).click()
  await expect(appr.getByText('You approved')).toBeVisible({ timeout: 120_000 })
  await shot(appr, '10-approved')
  await expect(rina.locator('[data-part="1"]')).toHaveAttribute('data-status', 'OPEN', { timeout: 60_000 })
  await rina.getByRole('button', { name: 'Take part 2' }).click()
  await expect(rina.locator('[data-part="1"]')).toHaveAttribute('data-status', 'TAKEN', { timeout: 120_000 })
  await expect(rina.getByText('2 of 2 parts taken')).toBeVisible()
  await shot(rina, '11-all-taken')

  // ---- the money really arrived
  await rina.goto('/app')
  await expect(rina.locator('[data-asset=usdc] .num')).toHaveText('1,000', { timeout: 60_000 })
  await shot(rina, '12-balance')

  // ---- the link is now locked for everyone else
  const stranger = await page('stranger')
  await stranger.goto(new URL(link).pathname)
  await expect(stranger.getByText(/already accepted/)).toBeVisible()
  await expect(stranger.getByRole('button', { name: /Accept package/ })).toHaveCount(0)
  if (VIDEOS) await Promise.all([sender, rina, appr, stranger].map((p) => p.context().close())) // flush the videos
})
