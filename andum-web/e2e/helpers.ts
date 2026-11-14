import { expect, type Page } from '@playwright/test'

export const MAIL = process.env.MAIL_URL ?? 'http://localhost:8025'
export const API = process.env.API_URL ?? 'http://localhost:8090'
export const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

/** Newest 6-digit code mailed to `to` that is not in `seen`. Mailpit is the project's local inbox. */
export async function mailCode(to: string, seen: Set<string> = new Set()): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + to)}`)).json()
    for (const m of list.messages ?? []) {
      if (!/code/i.test(m.Subject ?? '')) continue // other mails (the invite) carry long hashes that contain digits
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()
      const code = /(?<!\d)(\d{6})(?!\d)/.exec(full.Text ?? '')?.[1]
      if (code && !seen.has(code)) { seen.add(code); return code }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no mail for ${to}`)
}

/** Sign in on whichever sign-in card is on screen. */
export async function signIn(page: Page, email: string, seen: Set<string>) {
  await page.getByLabel('Your email').fill(email)
  await page.getByRole('button', { name: /Send me a/ }).click()
  await fillCode(page, 'Sign-in code', await mailCode(email, seen))
  await page.getByRole('button', { name: 'Continue' }).click()
}

export async function expectToast(page: Page, text: RegExp | string) {
  await expect(page.getByRole('alert').filter({ hasText: text }).first()).toBeVisible()
}

/** The code field is six boxes: empty it, click the first box and type the digits. */
export async function fillCode(page: Page, label: 'Sign-in code' | 'Invite code', code: string) {
  const boxes = page.getByRole('group', { name: label, exact: true }).locator('input')
  await boxes.last().click()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace')
  await boxes.first().click()
  await page.keyboard.type(code)
}
