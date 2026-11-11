## Decisions
- Relay jobs: API inserts `relay_jobs` row (QUEUED) then adds BullMQ job `{relay_id}`; worker loads row, re-runs policy with fresh chain state, wraps delegate in tx signed by relayer key, serialises per relayer key (concurrency 1), records outcome.
- Retry only on transport errors; a failed contract call is final (`FAILED` with `ANDUM_ERR` code). `InvalidNonce` of the relayer key triggers nonce refresh and one retry.
- Reconciler is idempotent: `chain_events` unique `(chain, tx_hash, log_index)`.
- Notifier uses `notifications.dedupe_key` unique so duplicates are impossible even with two workers; always re-checks chain before sending.
- Bridge: `BridgeProvider` interface; Mock provider with injected EVM log source so state machine is unit-testable; confirmations before action; reorged logs -> FAILED/REORGED.
