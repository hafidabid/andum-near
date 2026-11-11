## ADDED Requirements

### Requirement: Passwordless email sign-in
The API SHALL sign a user in by emailing a 6 digit code over SMTP and SHALL NOT reveal whether an address already has an account.

#### Scenario: Code flow
- **WHEN** a user requests a code and submits the right one within 10 minutes
- **THEN** a session cookie is set and the response says whether a NEAR key is still needed

#### Scenario: Abuse limits
- **WHEN** five wrong codes are tried, a code is reused or expired, a new code is requested within 60 seconds, or limits per address (10/h) or ip (30/h) are exceeded
- **THEN** `OTP_LOCKED`, `OTP_INVALID`, `OTP_EXPIRED` or `RATE_LIMITED`, and the code is stored only as a hash

#### Scenario: Mail outage
- **WHEN** SMTP delivery fails
- **THEN** `503 UPSTREAM_UNAVAILABLE`, no code is left behind and a retry is allowed

### Requirement: Non-custodial key binding
The API SHALL bind a NEAR ed25519 key to an email user only after the caller proves control of the key by signing a server nonce, and SHALL never hold the private key.

#### Scenario: Bind
- **WHEN** a signed-in keyless user posts a public key with a valid `andum-bind` signature
- **THEN** the implicit NEAR account becomes theirs, other endpoints unlock and the email becomes their notification address

#### Scenario: Keyless access
- **WHEN** a user without a bound key calls any endpoint other than auth, me, key, key-backup, logout
- **THEN** `403 KEY_REQUIRED`

#### Scenario: Replacement
- **WHEN** a user binds a different key
- **THEN** it needs `replace=true` and an email proof under 10 minutes old; key-only sessions can never replace; a key owned by another user is refused

#### Scenario: Proof hygiene
- **WHEN** the signature is wrong, signed with the login prefix, the nonce is reused, unknown or expired, or the account id is forged
- **THEN** `401 UNAUTHENTICATED`

### Requirement: Encrypted key backup
The API SHALL store an opaque, client-encrypted key blob (PBKDF2 600k + AES-GCM reference format) and SHALL reject weak parameters.

#### Scenario: New device
- **WHEN** the user signs in by email on another device and fetches the blob
- **THEN** the right passphrase restores the seed locally and the server never sees it

#### Scenario: Rejects
- **WHEN** iterations are below 100000, the version or kdf differs, or sizes are out of range
- **THEN** `400 VALIDATION_FAILED`

### Requirement: Optional Privy provider and dev key sign-in
The API SHALL accept verified Privy tokens when configured, and key-only sign-in only while enabled.
#### Scenario: Privy
- **WHEN** Privy is configured and a token with valid signature, issuer `privy.io`, audience app id and expiry comes with a key proof
- **THEN** a session is created; invalid tokens, a missing proof, or re-pointing the Privy user at another key are refused

#### Scenario: Key-only sign-in switch
- **WHEN** `AUTH_LOCAL_ENABLED=false`
- **THEN** the `local` provider returns `403`
