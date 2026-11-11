## Why
Chain-facing background work must be separate from HTTP: relayer, reconciler/indexer, notifier, bridge (ANDUM-PLAN §7.5-7.8, user request: worker holds relayer + indexer).

## What Changes
- `worker/` NestJS standalone app (no HTTP) running: BullMQ relay processor, reconciler (events -> `chain_events`, views -> `packages`/`parts`), notifier (invite/OTP/part_ready/approval_request), bridge worker (EVM<->NEAR, P2).

## Capabilities
### New Capabilities
- `relayer-worker`, `reconciler`, `notifier`, `bridge-worker`

## Impact
Uses `shared` (policy, chain client, db). Holds the relayer key; never a key that can move package funds (I-9).
