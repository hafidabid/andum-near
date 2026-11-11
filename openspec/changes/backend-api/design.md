## Decisions
- **Raw `pg` + SQL migrations** (no ORM): parameterised queries only, migrations in `shared/src/db/migrations`.
- **ChainClient interface** (view, submit delegate, nonce, height, balance, send NEAR): real implementation speaks JSON-RPC with hand-rolled borsh; `FakeChain` drives all integration tests since testnet is not reachable from CI.
- **Policy engine** is a pure function in `shared`, run by the API (fast 4xx) and again by the relayer worker before submission.
- **Auth `local`**: challenge-response, ed25519 signature over `andum-login:<nonce>:<account>`; nonces single-use; session cookie httpOnly SameSite=Lax. Provider token flows (Privy/Web3Auth) are stubs returning `UNAUTHENTICATED` until spike S-02 [HUMAN].
- **Invite secret**: 32 random bytes, only sha256 returned at creation, AES-256-GCM at rest, released once after OTP.
- **OTP**: 6 digits, sha256 hashed with invite id, 10 min expiry, 5 attempts, 60s resend.
- **Slugs**: rules in shared (`validateSlug`), uniqueness via unique index with citext, 24h redirects.
- **Idempotency**: table keyed by (user|ip, key); same key + same body replays response; different body 409.
- **Cache vs chain**: `packages` table is a cache; reads older than 10s refetch; nothing money-moving uses it.
