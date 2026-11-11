export type RoleId = 'sender' | 'receiver' | 'approver' | 'andum'
export type ActionId = 'fund' | 'change' | 'open' | 'approve' | 'back' | 'fee'
export type Verdict = 'yes' | 'no' | 'if' | 'na'

export const ROLES: Array<{ id: RoleId; n: string; d: string; av: string }> = [
  { id: 'sender', n: 'Sender', d: 'Funds the package and sets the terms.', av: 'D' },
  { id: 'receiver', n: 'Receiver', d: 'Owns the package and opens parts when their rules are met.', av: 'R' },
  { id: 'approver', n: 'Approver', d: 'Signs off on the parts they are named on.', av: 'A' },
  { id: 'andum', n: 'Andum', d: 'Relays transactions and pays the network fee.', av: '+' },
]

export const ACTIONS: Array<[ActionId, string]> = [
  ['fund', 'Fund the package'],
  ['change', 'Change amounts, dates or receiver'],
  ['open', 'Open a part'],
  ['approve', 'Approve a part'],
  ['back', 'Take the money back'],
  ['fee', 'Pay the network fee'],
]

const FEE = "Not needed. Andum's relayer pays the network fee."
const FIXED = 'Refused. Terms are fixed once the package is funded.'
const ONLY_NAMED = 'Refused. Only the person named on a part can approve it.'

export const MATRIX: Record<RoleId, Record<ActionId, [Verdict, string]>> = {
  sender: {
    fund: ['yes', 'Funded. 1,000 USDC and 1.5 g gold are now in the package.'],
    change: ['no', FIXED],
    open: ['no', 'Refused. Only the receiver can open a part.'],
    approve: ['no', ONLY_NAMED],
    back: ['if', 'Allowed only while the receiver has not accepted. After the link expires you can take everything back.'],
    fee: ['na', FEE],
  },
  receiver: {
    fund: ['no', 'Refused. Only the sender can fund a package.'],
    change: ['no', FIXED],
    open: ['yes', "Allowed once the part's date has passed and any approval is in. Until then the contract names what is missing."],
    approve: ['no', ONLY_NAMED],
    back: ['no', 'Refused. The sender can only take it back if you never accept.'],
    fee: ['na', FEE],
  },
  approver: {
    fund: ['no', 'Refused. Only the sender can fund a package.'],
    change: ['no', FIXED],
    open: ['no', 'Refused. Approving pays no one. Only the receiver can open a part.'],
    approve: ['yes', 'Approved. That part now only waits for its date.'],
    back: ['no', 'Refused. Only the sender can take money back, and only before acceptance.'],
    fee: ['na', FEE],
  },
  andum: {
    fund: ['no', "Refused. Andum can't move your money."],
    change: ['no', "Refused. Andum can't change amounts, dates or the receiver."],
    open: ['no', "Refused. Andum can't open a part for the receiver."],
    approve: ['no', "Refused. Andum can't approve on anyone's behalf."],
    back: ['no', "Refused. Andum can't take money from a package."],
    fee: ['yes', "Done. Andum's relayer sends the transaction and pays the network fee."],
  },
}

export const VERDICT_MARK: Record<Verdict, string> = { yes: '✓ Allowed', no: '✕ Refused', if: '● Sometimes', na: '– Covered' }

export function verdictLabel(v: Verdict): string {
  return v === 'yes' ? 'Allowed' : v === 'if' ? 'Sometimes' : v === 'na' ? 'Covered' : 'Refused'
}

export function verdictTone(v: Verdict): 'open' | 'wait' | 'info' | 'bad' {
  return v === 'yes' ? 'open' : v === 'if' ? 'wait' : v === 'na' ? 'info' : 'bad'
}

/** A call "gets through to the package" when it is allowed or sometimes allowed. */
export function verdictPasses(v: Verdict): boolean {
  return v === 'yes' || v === 'if'
}

/** Tidy the sentence start so "Refused" etc. is followed by a full stop and a space. */
export function verdictText(text: string): string {
  return text.replace(/^(Refused|Done|Allowed|Funded|Approved)\.?\s?/, '$1. ')
}
