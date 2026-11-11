## ADDED Requirements

### Requirement: Invite creation and attach
The API SHALL create invites and bind them to an on-chain package only after verifying the chain.

#### Scenario: Create
- **WHEN** a sender posts a recipient email
- **THEN** an invite id and `invite_hash_b64` (sha256 of a 32-byte secret) are returned and the secret is stored encrypted

#### Scenario: Attach verifies chain
- **WHEN** attach is called with a package whose on-chain sender and invite_hash match
- **THEN** the invite is `ATTACHED` and one invite email is queued (idempotent)

#### Scenario: Attach mismatch
- **WHEN** sender or hash differ, or the package is missing
- **THEN** `403 FORBIDDEN` or `404`; invite stays `DRAFT`

#### Scenario: Not owner
- **WHEN** another user attaches
- **THEN** `403 FORBIDDEN`

### Requirement: Email-gated secret release
The API SHALL release the invite secret only after a valid one-time code.

#### Scenario: Correct code
- **WHEN** a correct 6-digit code is confirmed
- **THEN** `{package_id, invite_secret}` is returned once and the invite becomes `VERIFIED`

#### Scenario: Wrong codes lock
- **WHEN** 5 wrong codes are submitted
- **THEN** `OTP_LOCKED` until a new code is requested

#### Scenario: Expired / resend flood / unattached
- **WHEN** the code is older than 10 minutes, a new code is requested within 60s, or the invite is not attached
- **THEN** `OTP_EXPIRED`, `429 RATE_LIMITED`, `INVITE_NOT_ATTACHED`

#### Scenario: Second release
- **WHEN** a code already used is confirmed again
- **THEN** `OTP_INVALID`

### Requirement: Custom link
The API SHALL manage a unique, readable link alias per invite.

#### Scenario: Availability check
- **WHEN** `GET /links/check?slug=` is called
- **THEN** it returns availability, with reasons `SLUG_INVALID`, `SLUG_RESERVED`, `SLUG_TAKEN` (+ suggestion) and never reveals the owner

#### Scenario: Slug rules
- **WHEN** slug is shorter than 3, longer than 32, has uppercase/illegal chars or leading/trailing/double hyphen, is reserved or starts with `andum`
- **THEN** it is invalid or reserved; the boundary lengths 3 and 32 are valid

#### Scenario: Patch link
- **WHEN** the sender sets slug, title (<=60) and show_amount
- **THEN** the link and preview are returned; the old slug redirects for 24h

#### Scenario: Locked after accept
- **WHEN** the invite is `ACCEPTED`
- **THEN** `LINK_LOCKED`

#### Scenario: Public view privacy
- **WHEN** `GET /invites/{id}/public` or the preview is read
- **THEN** the email is masked, no secret, the note is hidden, amounts only when `show_amount`
