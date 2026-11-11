## Decisions
- `near-contract-standards` `FungibleToken`; its `internal_deposit/withdraw` already adjust total supply (verified by test), so mint/burn never touch it manually.
- Storage management impl is hand-delegated because the library macro is incompatible with NearToken in 5.30.
- Faucet window: per-account log of (ts, amount) pruned after 24h => true sliding window.
- Replay key is `"<src_chain>:<src_nonce>"` so the same nonce on two EVM chains is distinct (I-8).
- Fees zero. Relayer is trusted (documented).
