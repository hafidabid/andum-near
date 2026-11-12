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

## Live checks
- `node scripts/live/live-e2e.mjs`: email login -> gasless package lifecycle on testnet, 16 checks.
- `node scripts/live/live-bridge.mjs`: NEAR testnet <-> anvil bridge, 9 checks.

## Costs and limits
Each deploy needs roughly 25 NEAR (storage deposits scale with wasm size) plus gas. The relayer account holds 5 NEAR and tops up new users 0.02 NEAR each (2 per day per account).
