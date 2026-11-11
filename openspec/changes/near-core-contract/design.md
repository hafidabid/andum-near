## Context
Source of truth: ANDUM-PLAN §3 and §5. Times are nanoseconds (u64, JSON decimal strings). Amounts are u128 decimal strings.

## Decisions
- **Errors**: every failure is `env::panic_str("ANDUM_ERR:<CODE>")` via a single `err(code)` helper so the backend can parse it.
- **Funding**: `ft_on_transfer` panics on bad input (token refunds in full) and returns the unused remainder when over-funded.
- **Claim safety**: state flips to `Pending{attempt_id}` before the promise chain; only `on_claim_resolved` can set `Taken` or revert to `Locked`; stale attempt ids are ignored. Gives I-3.
- **Reclaim**: status set to `RECLAIMED` first; per-part `reclaimed` counter makes retry idempotent; callback restores on failure.
- **Approvals**: `Vec<AccountId>` per part (max 5); duplicates are silent no-ops.
- **NFT**: hand-rolled minimal NEP-171/177/181 over `LookupMap` instead of `near-contract-standards` token struct, to keep transfer disabled and storage predictable. (Standard views and events are implemented.)
- **Time source**: `env::block_timestamp()`; unit tests drive it via `VMContextBuilder`.
- **Admin**: owner-only `set_paused`, `set_allowed_tokens`, `set_limits`, `top_up`, `migrate`. No method transfers tokens or NEAR out (I-1).
- **Open count**: per-sender counter decremented when all parts taken or package reclaimed fully.

## Risks
- Gas numbers are initial estimates (VERIFY S-03).
- Silent approver leaves a part closed forever (documented known limitation C-APPROVE-90).
