## ADDED Requirements

### Requirement: Faucet and roles
`MockERC20` SHALL offer an open faucet capped per call and per 24h per recipient, and restrict `mint` to `MINTER_ROLE`.

#### Scenario: Caps
- **WHEN** amount exceeds per-call cap, or daily total would be exceeded
- **THEN** revert `FaucetCapPerCall` / `FaucetCapDaily`; after 24h the allowance resets

#### Scenario: Zero inputs
- **WHEN** amount is 0 or recipient is the zero address
- **THEN** revert `ZeroAmount` / `ZeroAddress`

#### Scenario: Minter only
- **WHEN** a non-minter calls `mint` or grants a role
- **THEN** it reverts
