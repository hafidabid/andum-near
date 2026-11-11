## ADDED Requirements

### Requirement: Deposit for NEAR
The gateway SHALL burn the caller's tokens and emit `DepositedForNear` with an incrementing nonce.

#### Scenario: Valid deposit
- **WHEN** an enabled asset amount in `(0, maxPerTx]` with a 1..64 byte NEAR account is deposited
- **THEN** tokens are burned and the event carries nonce, amount, account, packageId, partId, fund

#### Scenario: Invalid deposit
- **WHEN** asset disabled, amount 0 or above max, account empty or >64 bytes, paused, no allowance or balance
- **THEN** it reverts and no nonce is consumed

#### Scenario: Permit variants
- **WHEN** a valid permit is supplied, or the permit was front-run, the deposit succeeds; an expired permit with no allowance reverts

### Requirement: Release from NEAR
Only relayers SHALL release, once per NEAR nonce.

#### Scenario: Replay
- **WHEN** the same `nearNonce` is released twice
- **THEN** the second reverts `AlreadyReleased`

#### Scenario: Unauthorised or invalid
- **WHEN** caller is not a relayer (including the owner), paused, zero address/amount, disabled asset
- **THEN** it reverts and the nonce is not consumed

### Requirement: Gasless deposits
The gateway SHALL accept deposits through the trusted ERC-2771 forwarder and attribute them to the signer.

#### Scenario: Forwarded deposit
- **WHEN** the relayer executes a signed forward request
- **THEN** the signer's tokens are burned and the signer pays no gas

#### Scenario: Abuse
- **WHEN** a request is expired, replayed or tampered, or a direct caller appends a fake sender suffix
- **THEN** it reverts or is attributed to the real caller
