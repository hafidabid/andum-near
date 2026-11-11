## ADDED Requirements

### Requirement: Idempotent bridge_in
Only the relayer SHALL call `bridge_in`, at most once per `(src_chain, src_nonce)`.

#### Scenario: Replay
- **WHEN** the same chain+nonce is submitted twice
- **THEN** the second call returns false with no mint

#### Scenario: Validation
- **WHEN** caller is not the relayer / chain unknown / token not bridgeable / amount 0
- **THEN** `BRIDGE_NOT_RELAYER` / `BRIDGE_BAD_CHAIN` / `BRIDGE_ASSET_DISABLED` / `INVALID_AMOUNT`, and the nonce is not consumed

#### Scenario: Fund target
- **WHEN** `fund` is given
- **THEN** tokens are minted with `ft_mint_call` into core and unused tokens are minted back to the user

### Requirement: Outbound burn record
`ft_on_transfer` SHALL burn received tokens and record a sequential outbound nonce.

#### Scenario: Valid outbound
- **WHEN** a bridgeable token sends with a valid `dest_chain` and 0x address
- **THEN** an Outbound with next nonce is stored lowercase and `bridge_out` emitted

#### Scenario: Invalid outbound
- **WHEN** msg is malformed, chain unknown, address malformed or zero address, token not bridgeable, amount 0
- **THEN** it panics with `BAD_MSG`, `BRIDGE_BAD_CHAIN`, `BRIDGE_BAD_ADDRESS`, `BRIDGE_ASSET_DISABLED`, `INVALID_AMOUNT` and no nonce is consumed

#### Scenario: Pause
- **WHEN** paused
- **THEN** inbound and outbound both panic `PAUSED`
