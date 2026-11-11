## ADDED Requirements

### Requirement: Local login
The API SHALL authenticate a user by proving control of an ed25519 key and map them to one NEAR account.

#### Scenario: Valid challenge
- **WHEN** a client requests a nonce then posts a correct signature for `andum-login:<nonce>:<account>`
- **THEN** a session cookie is set and `{user_id, near_account_id}` returned

#### Scenario: Bad signature, replayed nonce, mismatched account
- **WHEN** the signature is wrong, the nonce was used or never issued, or the account id is not the implicit account of the key
- **THEN** `401 UNAUTHENTICATED`

#### Scenario: No cookie
- **WHEN** a protected endpoint is called without a session or with an expired one
- **THEN** `401 UNAUTHENTICATED`

### Requirement: Account bootstrap
The API SHALL top up an account with a small amount of NEAR so it can hold tokens, within limits.

#### Scenario: New account
- **WHEN** the account holds less than `TOPUP_MIN`
- **THEN** `TOPUP_NEAR` is sent and `created:true` returned

#### Scenario: Already funded
- **WHEN** balance is at least `TOPUP_MIN`
- **THEN** no transfer and `created:false`

#### Scenario: Per-day limit
- **WHEN** the user already got a top-up within the daily limit
- **THEN** `429 BOOTSTRAP_LIMIT`

### Requirement: Server time
The API SHALL expose server and chain time for countdown UIs.

#### Scenario: Time endpoint
- **WHEN** `GET /v1/time` is called
- **THEN** it returns `server_ms` and `chain_ns`
