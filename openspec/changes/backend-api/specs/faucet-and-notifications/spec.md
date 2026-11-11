## ADDED Requirements

### Requirement: NEAR faucet
The API SHALL mint mock tokens for the caller within per-call and daily caps.

#### Scenario: Mint
- **WHEN** a user requests a known asset within the caps
- **THEN** the backend mints to the caller and records the claim

#### Scenario: Caps and unknown asset
- **WHEN** the amount exceeds per-call or daily caps, or the asset is unknown or kill-switched
- **THEN** `FAUCET_CAP` / `VALIDATION_FAILED`

### Requirement: Notification prefs
The API SHALL let a user opt out of emails.

#### Scenario: Update
- **WHEN** a user sets `email_enabled=false`
- **THEN** later `part_ready` mails are SKIPPED

### Requirement: Live updates
The API SHALL stream changes to the owning user over server-sent events.

#### Scenario: SSE
- **WHEN** a client opens `/v1/stream`
- **THEN** it receives `package.updated`, `relay.updated` events for its own account only
