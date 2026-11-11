## 1. Worker app
- [x] 1.1 Nest standalone bootstrap, config, modules
- [x] 1.2 Relay processor
- [x] 1.3 Reconciler (events + views + sweep)
- [x] 1.4 Notifier
- [x] 1.5 Bridge worker (state machine + providers)
## 2. Tests
- [x] 2.1 Relay processor: success/fail/retry/policy/idempotent
- [x] 2.2 Reconciler: parsing, upsert, sweep, chain failure
- [x] 2.3 Notifier: once, recheck, opt-out, retries
- [x] 2.4 Bridge: both directions, reorg, replay, restart
## 3. Ship
- [x] 3.1 Dockerfile + compose
- [ ] 3.2 Real NEAR/EVM validation on testnet [HUMAN: keys, funds]
