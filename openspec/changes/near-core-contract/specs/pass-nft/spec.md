## ADDED Requirements

### Requirement: Non-transferable package pass
The contract SHALL expose NEP-171/177/181 views for pass NFTs and SHALL refuse every transfer.

#### Scenario: Metadata
- **WHEN** `nft_token(package_id)` is read after accept
- **THEN** owner is the receiver and metadata title is `Andum package #<id>`, symbol `ANDUM`, description is the note when present

#### Scenario: Transfers refused
- **WHEN** anyone calls `nft_transfer` or `nft_transfer_call`
- **THEN** it panics with `PASS_NOT_TRANSFERABLE`

#### Scenario: Enumeration
- **WHEN** `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner` are called
- **THEN** counts and pages reflect accepted packages only; pagination arguments are honoured

#### Scenario: One NFT per package
- **WHEN** a package is accepted
- **THEN** exactly one token with id equal to the package id exists (I-6)
