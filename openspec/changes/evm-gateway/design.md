## Decisions
- Faucet window is a per-recipient fixed 24h window starting at the first mint (`start==0` handled so fresh accounts at low timestamps work).
- `depositForNearWithPermit` swallows a failed permit (front-run griefing) and relies on the allowance check inside `burnFrom`.
- `release` consumes the nonce before minting; a mint revert rolls back everything.
- Non-bridgeable assets (gold, stocks) are deployed but not registered in the gateway.
- `via_ir` enabled only to satisfy test helper stack depth.
