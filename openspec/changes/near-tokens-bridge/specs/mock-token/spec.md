## ADDED Requirements

### Requirement: Capped public faucet
`ft_mint` SHALL mint to any account up to `per_call` and a rolling-24h `daily` total per account.

#### Scenario: Within caps
- **WHEN** an account mints exactly the per-call cap
- **THEN** it succeeds and the account is auto-registered

#### Scenario: Over per-call cap
- **WHEN** amount exceeds the per-call cap
- **THEN** it panics `FAUCET_CAP_PER_CALL`

#### Scenario: Daily cap and rollover
- **WHEN** the 24h total would exceed the daily cap
- **THEN** `FAUCET_CAP_DAILY`; after 24h the allowance returns; other accounts are unaffected

#### Scenario: Zero amount
- **WHEN** amount is 0
- **THEN** `INVALID_AMOUNT`

### Requirement: Minter role
Privileged mint, burn and mint-call SHALL require the owner or a listed minter.

#### Scenario: Non-minter
- **WHEN** another account calls `ft_mint_privileged`, `ft_burn_privileged` or `ft_mint_call`
- **THEN** `NOT_MINTER`

#### Scenario: Burn keeps supply consistent
- **WHEN** a minter burns part of its balance
- **THEN** total supply decreases by that amount; burning more than held panics

#### Scenario: Unused refund burn
- **WHEN** `ft_mint_call` receiver reports unused tokens
- **THEN** at most the receiver's balance is burned and the burned amount is returned
