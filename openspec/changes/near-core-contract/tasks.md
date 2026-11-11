## 1. Scaffold
- [x] 1.1 Cargo workspace, near-sdk 5.x, release profile
- [x] 1.2 Error codes + event helpers
## 2. Core logic
- [x] 2.1 Types (Package, Part, views) and storage
- [x] 2.2 create_package validation
- [x] 2.3 ft_on_transfer funding
- [x] 2.4 accept_package + NFT mint
- [x] 2.5 approve_part
- [x] 2.6 claim + on_claim_resolved
- [x] 2.7 reclaim_unaccepted + callback
- [x] 2.8 Views (status/reason, pagination, storage_report)
- [x] 2.9 NFT NEP-171/177/181 views, transfers refused
- [x] 2.10 Admin methods
## 3. Tests
- [x] 3.1 Unit tests: positive
- [x] 3.2 Unit tests: negative (every error code)
- [x] 3.3 Unit tests: edge (boundaries, unicode note, races, stale callbacks)
- [x] 3.4 Sandbox integration test (near-workspaces) with mock-ft (7 tests, real wasm)
- [ ] 3.5 Sandbox: approver group 2-of-3, claim callback failure path, parallel claims
## 4. Ship
- [x] 4.1 wasm build (needs `--cfg near`; set in smart-contract-near/.cargo/config.toml)
- [ ] 4.2 Deploy script and testnet deploy [HUMAN: ROOT credentials]
