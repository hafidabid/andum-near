## Why
Andum's product (multi-part conditional packages, approver groups, NFT pass) lives in one Rust contract on NEAR testnet (ANDUM-PLAN §5, decision D-01). Everything else (backend, web, bridge) depends on its interface (§3).

## What Changes
- New crate `smart-contract-near/core` (near-sdk 5.x) implementing create/fund/accept/approve/claim/reclaim, NEP-171/177/181 pass NFT, NEP-297 events, admin controls with no fund-moving method (I-1).
- Shared error codes `ANDUM_ERR:<CODE>` (§3.5) and event format (§3.6) implemented exactly.
- Unit tests (positive, negative, edge) for every `C-*` rule; sandbox integration tests where the sandbox is available.

## Capabilities
### New Capabilities
- `package-lifecycle`: create_package validation, funding via ft_on_transfer, accept, reclaim.
- `approval-and-claim`: approver groups with threshold, claim promise chain with attempt ids.
- `pass-nft`: non-transferable NEP-171 pass minted on accept.
- `admin-and-views`: computed status/reason views, pause, allowlist, limits, storage report.

## Impact
New code only: `smart-contract-near/core`. Interface is frozen by ANDUM-PLAN §3; no deviations without a change request.
