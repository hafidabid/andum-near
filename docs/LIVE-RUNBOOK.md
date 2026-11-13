# Live runbook (NEAR testnet + EVM)

Secrets are never committed: `./secret` (funded account keys) and `deployments/secrets/` (generated keys, `live.env`) are gitignored. Do not paste raw near-cli output anywhere: it echoes private keys.

## One-time
1. `node scripts/keys.mjs gen` creates the relayer, bridge-worker and ops keys (NEAR and EVM) in `deployments/secrets/`.
2. `./scripts/deploy-near.sh` builds, shrinks (`wasm-opt`, install with `brew install binaryen`), creates sub-accounts of the funded root, deploys core/bridge/tokens, registers them with each other, writes `deployments/near.testnet.json`. Idempotent: state in `deployments/.near-deploy-state`.
3. `./scripts/deploy-evm.sh anvil|sepolia|baseSepolia` deploys forwarder, gateway and 11 mock tokens with `forge create`; resumable via `deployments/<net>.state.json`; writes `deployments/<net>.json`.

## Run the stack locally
```
docker compose up -d mailpit            # SMTP :1025, inbox UI http://localhost:8025
brew services or pg_ctl for Postgres, redis-server for Redis  (or docker compose up -d postgres redis)
anvil &                                  # optional local EVM chain
npm run build
set -a; . deployments/secrets/live.env; set +a
node backend/dist/main.js &  node worker/dist/main.js &
```
`deployments/secrets/live.env` holds DATABASE_URL, REDIS_URL, NEAR_* addresses, the relayer and bridge-worker keys, `SMTP_URL=smtp://localhost:1025`, and (for the bridge rehearsal) `EVM_BASE_SEPOLIA_RPC/CHAIN_ID/GATEWAY` pointing at anvil.

## Run the web app (the real product UI)
```
cd andum-web && cp .env.example .env.local     # VITE_API_BASE=http://localhost:8090 by default
npm install && npm run dev                      # http://localhost:3000
```
The API allows the origin in `WEB_ORIGIN` (default `http://localhost:3000`), so keep the dev server on port 3000.
Open `/app` to sign in with an email (the code arrives in Mailpit at http://localhost:8025), get test tokens, build and send a package. The recipient opens the link from the email (`/p/<name>` or `/i/<id>`). Everyone's NEAR key lives in that browser's `localStorage`, one per email address, so use separate browser profiles (or private windows) to play the sender, recipient and approver at the same time.

## Browser end-to-end tests (Playwright)
With the stack and the web app running:
```
cd andum-web && npx playwright install chromium     # first time
npm run test:e2e:guards                             # fast: sign-in, link and form guards (API only, no chain)
npm run test:e2e                                    # also the full journey on NEAR testnet (about 6 minutes)
RECORD=1 VIDEOS=/tmp/andum-videos SHOTS=docs/media/app npm run test:e2e   # record one video per person and screenshots
```
The journey waits for a date 200 seconds away, so it takes a few minutes by design.

## Live checks
- `node scripts/live/live-e2e.mjs`: email login -> gasless package lifecycle on testnet, 16 checks.
- `node scripts/live/live-bridge.mjs`: NEAR testnet <-> anvil bridge, 9 checks.

## Costs and limits
Each deploy needs roughly 25 NEAR (storage deposits scale with wasm size) plus gas. The relayer account holds 5 NEAR and tops up new users 0.02 NEAR each (2 per day per account).
