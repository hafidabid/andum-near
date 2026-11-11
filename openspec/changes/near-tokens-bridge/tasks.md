## 1. mock-ft
- [x] 1.1 NEP-141/145 + metadata (6 decimals)
- [x] 1.2 Faucet caps (per call, sliding daily)
- [x] 1.3 Minter role, burn, mint_call + resolve
- [x] 1.4 Unit tests (13) positive/negative/edge
## 2. bridge
- [x] 2.1 bridge_in idempotent + fund variant
- [x] 2.2 outbound ft_on_transfer + views
- [x] 2.3 Unit tests (9)
## 3. Integration / ship
- [x] 3.1 near-workspaces sandbox test: core + mock-ft end to end (funding refund, claim transfer)
- [ ] 3.4 Sandbox: bridge_in + ft_mint_call fund path, outbound burn
- [ ] 3.2 Deploy 11 token instances [HUMAN: ROOT account]
- [ ] 3.3 Grant bridge minter role on bridgeable tokens at deploy
