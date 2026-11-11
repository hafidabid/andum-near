## Why
Demo needs valueless NEP-141 tokens with an open faucet (D-03, F-01) and a trusted demo bridge (B-01, P2) per ANDUM-PLAN §5.10-5.11.

## What Changes
- `smart-contract-near/mock-ft`: NEP-141 + NEP-145, capped faucet (per call, rolling 24h), minter role, `ft_mint_call`.
- `smart-contract-near/bridge`: relayer-only idempotent `bridge_in`, outbound `ft_on_transfer` that burns and records a nonce.

## Capabilities
### New Capabilities
- `mock-token`: faucet caps, privileged mint/burn, mint-and-call.
- `near-bridge`: bridge_in idempotency, outbound burn record, admin kill switch.

## Impact
New crates only. Bridge must be granted minter role on each bridgeable token at deploy time.
