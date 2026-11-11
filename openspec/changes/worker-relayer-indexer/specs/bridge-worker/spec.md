## ADDED Requirements

### Requirement: EVM to NEAR
The bridge worker SHALL mint on NEAR only for confirmed EVM deposits, once each.

#### Scenario: Confirmed deposit
- **WHEN** a `DepositedForNear` log reaches the confirmation depth
- **THEN** `bridge_in` is submitted once and the transfer ends `DONE`

#### Scenario: Reorg
- **WHEN** a detected log disappears before confirmation
- **THEN** transfer is `FAILED` with `REORGED` and nothing is sent

#### Scenario: Duplicate detection
- **WHEN** the same log is seen twice
- **THEN** only one transfer exists

### Requirement: NEAR to EVM
The bridge worker SHALL release on EVM exactly once per NEAR outbound nonce.

#### Scenario: Outbound
- **WHEN** a new bridge outbound nonce exists
- **THEN** `gateway.release` is called once and the transfer is `DONE`; restart does not repeat it
