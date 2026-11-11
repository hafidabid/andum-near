# Andum build status

Last updated: 11 Nov 2026 (session 1). Legend: DONE = built and tested locally. PARTIAL = built, not validated against a live network. TODO = not started. HUMAN = needs a person (keys, funds, accounts).

Nothing here has been deployed to NEAR testnet, Sepolia or Base Sepolia yet. Everything below was verified with unit tests, a local Postgres and Redis, an in-memory chain model, and (when it ran) the NEAR sandbox.

## Test results (latest run)

| Area | Command | Result |
|---|---|---|
| NEAR core contract | `cd smart-contract-near && cargo test -p andum-core` | 102 passed |
| NEAR mock token | `cargo test -p andum-mock-ft` | 13 passed |
| NEAR bridge | `cargo test -p andum-bridge` | 9 passed |
| NEAR sandbox integration (real wasm, real cross-contract calls) | `cargo test -p andum-integration -- --test-threads=1` | 7 passed |
| EVM (Foundry) | `cd smart-contract-evm && forge test` | 38 passed |
| shared library | `npm run test -w shared` | 79 passed |
| backend API | `npm run test -w backend` | 146 passed (incl. 3 full-stack API+queue+worker scenarios) |
| worker | `npm run test -w worker` | 63 passed |

Test environment: Postgres on `localhost:5544` (db `andum_test`, user `andum`, trust auth) and Redis on `localhost:6390`. Override with `TEST_DATABASE_URL` and `TEST_REDIS_URL`.

## Important finding

A plain `cargo build --target wasm32-unknown-unknown` produces a contract whose panics lose their message (the ANDUM_ERR codes would never reach the backend) because near-sdk falls back to pure Rust. The build needs `--cfg near` (what `cargo near build` sets). `smart-contract-near/.cargo/config.toml` now sets it. The sandbox tests caught this; unit tests cannot.

## By requirement (ANDUM-PLAN section 1.3)

| ID | Pri | State | Where | Notes |
|---|---|---|---|---|
| C-01 create (1..8 parts, approver groups, theme, note) | P0 | DONE | `smart-contract-near/core` | every validation error code covered |
| C-02 exact funding, refund excess | P0 | DONE | core `ft_on_transfer` | sandbox test covers the real token refund |
| C-03 FUNDED when all parts funded | P0 | DONE | core | |
| C-04 accept with invite secret, one NFT | P0 | DONE | core | |
| C-05 approvers, threshold, once each | P0 | DONE | core | |
| C-06 claim, parallel-safe, attempt ids | P0 | DONE | core | callbacks tested through `resolve_claim` (unit) and sandbox |
| C-07 reclaim after deadline, retry-safe | P0 | DONE | core | |
| C-08 NEP-171/177/181 views, transfers refused | P1 | DONE | core | hand-rolled, no `nft_approve` (not needed) |
| C-09 NEP-297 events | P0 | DONE | core | |
| C-10 admin without custody (I-1) | P0 | DONE | core | no withdraw method exists; sandbox test probes names |
| C-11 computed status and reason | P0 | DONE | core | |
| C-12 theme and note | P1 | DONE | core | |
| F-01 mock token, open faucet | P0 | DONE | `mock-ft` | |
| F-02 minter role, mint/burn/mint-call | P2 | DONE | `mock-ft` | |
| B-01 NEAR bridge | P2 | DONE | `bridge` | `bridge_in` + fund path unit tested only |
| E-01 MockERC20 | P2 | DONE | `smart-contract-evm` | |
| E-02 gateway | P2 | DONE | | |
| E-03 ERC-2771 forwarder | P2 | DONE | | uses OpenZeppelin v5.1 `ERC2771Forwarder`; request shape verified by test |
| A-01 login and session | P0 | DONE (email) / PARTIAL (Privy) | `backend/src/auth.ts` | Email OTP over SMTP + client-held key (non-custodial) + encrypted backup, all tested (incl. a real SMTP server). Privy token verification implemented but NEAR signing via Privy is unverified (their docs do not list NEAR): spike S-02 [HUMAN]. Web3Auth not implemented |
| A-02 account bootstrap | P0 | DONE | `accounts.ts` | |
| A-03 invites, OTP, single use | P0 | DONE | `invites.ts` | |
| A-04 relayer + policy engine | P0 | PARTIAL | `shared/policy.ts`, `worker/relay.service.ts` | real JSON-RPC client written but NOT run against testnet (spike S-01) |
| A-05 package read API + reconcile | P0 | DONE | `packages.ts`, `worker/reconciler.ts` | |
| A-06 notifier | P1 | DONE | `worker/notifier.ts` | SMTP/Mailpit; Resend via SMTP relay |
| A-07 faucet API | P0 | DONE (NEAR) | `misc.ts` | EVM faucet endpoint returns 501 (TODO, P2) |
| A-08 bridge worker | P2 | PARTIAL | `worker/bridge.ts`, `evm.ts` | state machine tested with fakes; viem client untested against a chain |
| A-09 SSE | P1 | DONE | `misc.ts` | |
| L-01 custom link | P1 | PARTIAL | `invites.ts` | `og.png` not implemented (HTML OG tags are) |
| O-01 opening moment | P1 | n/a here | web app | contract stores theme + note |
| U-01, U-02 web app | P0/P1 | OUT OF SCOPE this session | `andum-web/` exists (separate) | not wired to this backend |
| N-01 gasless | P0 | PARTIAL | policy R6 allows only 1 yocto on `ft_transfer_call` | spike S-01 must confirm the user-pays-1-yocto behaviour on testnet |
| N-02 30-minute setup | P0 | PARTIAL | `README.md`, `.env.example`, `docker-compose.yml` | compose file not run (Docker daemon was not running) |

## Not done (next steps, in order)

1. **[HUMAN] H-2 credentials**: create `ROOT` testnet account, fund it, run `scripts/deploy-near.sh` (written, syntax-checked, not run). Then spike S-01 (delegate action calling `ft_transfer_call` with 1 yocto) and spike S-03 (gas numbers).
2. Run `scripts/deploy-evm.sh` for both Sepolia networks [HUMAN: funded deployer + relayer]. Fill `deployments/*.json` and the `EVM_GATEWAY_*` env vars. Enable `BRIDGE_ENABLED=true`.
3. Validate `NearRpcChain` (hand-rolled borsh transaction encoding, `send_tx`) against testnet. If it misbehaves, swap the implementation for `near-api-js` behind the same `ChainClient` interface; nothing else changes.
4. Privy/Web3Auth provider (spike S-02) in `auth.ts`. Today only the `local` key-pair provider authenticates.
5. `GET /p/{slug}/og.png` (image renderer) and OpenAPI 3.1 file (`packages/shared` in the plan; not written).
6. EVM faucet endpoint and the EVM gasless signing path in the API.
7. Gas tuning (plan 5.9 numbers are estimates), `near-workspaces` tests for approver groups 2-of-3, `ft_mint_call` + `bridge_in` with fund, and the bridge on the sandbox.
8. Web app integration (WS-E), Playwright E2E (WS-F), UAT scripts.
9. `docs/DECISIONS.md`, `docs/VERIFY-LOG.md`, `docs/RUNBOOK.md` (only `docs/interface-changes.md` exists).

## Deviations from the plan (all logged in `docs/interface-changes.md`)

- `PackageView.invite_hash` added so `/attach` can verify the hash on chain.
- Extra auth endpoints: `GET /v1/auth/nonce`, `GET /v1/auth/me`, `POST /v1/auth/logout`.
- OTP emails are sent by the API immediately and never persisted in plain text.
- Folder names follow the request, not the plan layout: `smart-contract-near`, `smart-contract-evm`, `backend`, `worker`, `shared`.
- NestJS + raw `pg` (no ORM) instead of Fastify + Drizzle.

## Known limitations

- Silent approver leaves a part closed forever (C-APPROVE-90, accepted by the plan).
- The invite secret appears in the accept transaction (plan 5.4). Mitigated by single use + deadline.
- Time-dependent part status (`WAITING_DATE` to `OPEN`) is computed by the contract at read time. The Postgres cache can be up to 10 seconds stale; the API refreshes on read.
- Worker `Notifier` sends `part_ready` using the cached `unlock_ns` as a hint and then confirms on chain.
