## 1. Shared library
- [x] 1.1 borsh + NEP-366 delegate codec + signature verify
- [x] 1.2 Policy engine R1-R11 (pure) + tests
- [x] 1.3 Error code maps, slug rules, copy map, event parser
- [x] 1.4 DB layer + migrations (schema §7.2 + idempotency, otp, kill switches)
- [x] 1.5 ChainClient: interface, JSON-RPC impl, FakeChain
- [x] 1.6 Mailer (console, SMTP/Mailpit, capture)
## 2. API (NestJS)
- [x] 2.1 Config + DB + Redis + queue modules
- [x] 2.2 Auth (local) + session guard
- [x] 2.3 Accounts bootstrap, time, health
- [x] 2.4 Invites, OTP, links, public view, og/nft svg
- [x] 2.5 Relay submit/status + idempotency
- [x] 2.6 Packages read/list/events
- [x] 2.7 Faucet, notification prefs, SSE, bridge read endpoints
## 3. Tests
- [x] 3.1 Unit: codec, policy, slug, crypto
- [x] 3.2 Integration: supertest vs real Postgres+Redis+FakeChain, every endpoint positive/negative/edge
- [ ] 3.3 OpenAPI file (not written)
- [ ] 2.8 og.png renderer for chat previews
- [ ] 2.9 EVM faucet endpoint
## 4. Ship
- [x] 4.1 docker-compose (postgres, redis, mailpit, api, worker) (written, not run: Docker daemon was off)
- [x] 4.2 .env.example, README run steps
- [ ] 4.3 Privy/Web3Auth provider [HUMAN: app ids, spike S-02]
