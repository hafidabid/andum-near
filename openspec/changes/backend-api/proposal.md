## Why
The web app needs a gasless, email-verified API in front of the NEAR contracts (ANDUM-PLAN §7). Users never pay gas (D-04); invites are email-gated (A-03); custom links (D-10).

## What Changes
- `backend/` NestJS 11 API: sessions (local provider now, Privy/Web3Auth later), account bootstrap, invites + OTP, custom link slugs, relay submission (policy checked, queued in Redis/BullMQ), package read API, faucet, notification prefs, SSE, health.
- `shared/` workspace with everything both processes need: borsh/NEP-366 codec, relayer policy engine (pure), error codes, DB access + migrations, chain client interface (real JSON-RPC + in-memory fake), mailer.
- PostgreSQL for state, Redis for queue/pubsub.

## Capabilities
### New Capabilities
- `auth-and-accounts`, `invites-and-links`, `relay-submission`, `package-read-api`, `faucet-and-notifications`

## Impact
Interface = ANDUM-PLAN §3.7/§7.4. Idempotency-Key supported on POSTs. All amounts decimal strings, times suffixed `_ns`/`_ms`.
