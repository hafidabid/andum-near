# Interface changes

Changes to the frozen interface (ANDUM-PLAN section 3). Pending human approval (gate H-1).

| # | What | Why | Affected |
|---|---|---|---|
| 1 | `PackageView.invite_hash` (optional base64 string) added to the core view | The backend must verify on `/invites/{id}/attach` that the on-chain package carries the invite's hash (ANDUM-PLAN 7.4 says "invite_hash matches" but the view did not expose it). The hash is already public in the `create_package` transaction arguments. | core, backend, web |
| 2 | `GET /v1/auth/nonce` and `GET /v1/auth/me`, `POST /v1/auth/logout` added | `POST /auth/session` with provider `local` needs a server-issued nonce | backend, web |
| 3 | `invite_secret` / `accept_package` secret is passed as base64 of the 32 raw bytes (`Base64VecU8`); the contract hashes the raw bytes | Unambiguous hashing | core, backend, web |
| 4 | OTP codes are emailed immediately by the API and never persisted in plain text (the notifier does not send OTP) | ANDUM-PLAN 7.10 requires OTP hashed at rest; queuing plaintext in `notifications` would violate that | backend |
| 5 | `GET /p/{slug}/og.png` not yet implemented (HTML page with Open Graph tags is) | needs an image renderer dependency | backend |
| 6 | Email sign-in: `POST /v1/auth/email/start`, `POST /v1/auth/email/verify`; key binding `POST /v1/auth/key`; encrypted key backup `GET/PUT /v1/auth/key-backup`; new API error `KEY_REQUIRED`; `users.near_account_id/public_key` nullable until a key is bound | Privy does not document NEAR support, so email login is built in-house and stays non-custodial (the browser generates the ed25519 key; the server only stores an encrypted backup it cannot open) | backend, web |
| 7 | `POST /v1/auth/session` response now carries `public_key`, `key_required`, `has_backup` | same | web |
