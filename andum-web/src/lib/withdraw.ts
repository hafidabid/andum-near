import { isNearAccountId } from '@shared/policy'
import { DEPLOYED_ASSETS, NEAR_BRIDGE, NEAR_CORE, tokenAccount } from './chain'
import { AS } from './assets'
import { assetFromKey, fromBase, toBase } from './money'

export interface WithdrawDraft { asset: string; amount: string; to: string }
export interface Withdrawal { asset: string; amountBase: string; to: string }
export type WithdrawCheck = { ok: true; built: Withdrawal } | { ok: false; problems: { to?: string; amount?: string } }

const sym = (k: string) => AS[assetFromKey(k)].u

/** Mirrors what the relayer policy accepts for ft_transfer (shared/src/policy.ts), in words a person can act on. */
export function checkWithdraw(d: WithdrawDraft, ctx: { from: string; balances: Record<string, string> }): WithdrawCheck {
  const problems: { to?: string; amount?: string } = {}
  const to = d.to.trim()
  if (!to) problems.to = 'Enter the address to send to.'
  else if (/^0x[0-9a-f]{40}$/i.test(to)) problems.to = 'That looks like an Ethereum address. Withdrawals here go to NEAR addresses.'
  else if (!isNearAccountId(to)) problems.to = 'That is not a NEAR address. Use a name like alice.testnet or a 64-character hex address, in lowercase.'
  else if (to === ctx.from) problems.to = 'That is your own Andum account.'
  else if (to === NEAR_CORE || to === NEAR_BRIDGE || DEPLOYED_ASSETS.some((a) => tokenAccount(a) === to)) problems.to = 'That is an Andum contract. Assets sent there would be lost.'

  const base = toBase(d.amount)
  if (!base) problems.amount = 'Enter an amount above zero, with up to 6 decimals.'
  else if (BigInt(base) > BigInt(ctx.balances[d.asset] ?? '0')) problems.amount = `You only have ${fromBase(ctx.balances[d.asset] ?? '0', 6)} ${sym(d.asset)}.`

  return problems.to || problems.amount ? { ok: false, problems } : { ok: true, built: { asset: d.asset, amountBase: base!, to } }
}
