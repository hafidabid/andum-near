# Andum: contracts, backend, worker

Send money and assets in one package. Each part opens on its own rule (now, a date, or a date plus approval). The package is a non-transferable NFT. Nobody pays gas.

> Status: built and tested locally, **not deployed anywhere yet**. See [STATUS.md](STATUS.md) for what is done and what is not, and [ANDUM-PLAN.md](ANDUM-PLAN.md) for the design.

| Folder | What |
|---|---|
| `smart-contract-near/` | Rust (near-sdk 5): `core` (packages, approvals, NFT pass), `mock-ft` (faucet token), `bridge` (demo bridge), `integration` (sandbox tests on the real wasm) |
| `smart-contract-evm/` | Foundry: `MockERC20`, `AndumGateway` (burn/mint demo bridge, ERC-2771 gasless) |
| `backend/` | NestJS API: sessions, invites + email OTP, custom links, relay submit (policy checked), package reads, faucet, SSE |
| `worker/` | NestJS worker: relayer (BullMQ), reconciler/indexer, notifier, bridge worker |
| `shared/` | Library used by both: NEP-366 codec, relayer policy engine, chain client, DB migrations, mailer |
| `openspec/` | Specs and tasks per change (`openspec list`, `openspec validate --all`) |
| `docs/interface-changes.md` | Deviations from the frozen interface, waiting for approval |

## Run the tests

```bash
# NEAR contracts (Rust). First time: rustup default stable && rustup target add wasm32-unknown-unknown
cd smart-contract-near
cargo test --workspace --exclude andum-integration         # 124 unit tests
cargo build --release --target wasm32-unknown-unknown      # the .cargo/config.toml adds --cfg near (required)
cargo test -p andum-integration -- --test-threads=1        # sandbox tests, downloads the NEAR sandbox once

# EVM
cd smart-contract-evm && forge test                         # 38 tests

# TypeScript (needs Postgres and Redis)
createdb andum_test    # any Postgres; defaults: postgres://andum@localhost:5544/andum_test and redis://localhost:6390
npm install && npm run build -w shared
npm test                                                    # shared + backend + worker
```

Override the test services with `TEST_DATABASE_URL` and `TEST_REDIS_URL`.

## Run locally

```bash
cp .env.example .env     # fill INVITE_ENC_KEY (openssl rand -base64 32) and, for testnet, the relayer key
docker compose up --build   # Postgres, Redis, Mailpit (mail UI on :8025), API on :8080, worker
curl localhost:8080/readyz
```

Set `USE_FAKE_CHAIN=true` to run the API and worker against an in-memory chain (UI demos with no testnet).

## Going to testnet [HUMAN steps]

1. Create and fund a NEAR testnet account (`ROOT`), put its key in your local near-cli keychain.
2. `ROOT=<account> ./scripts/deploy-near.sh` (core, 11 tokens, bridge; registers core with every token).
3. Put the relayer key in `.env`. Run spike S-01 (delegate action calling `ft_transfer_call` with 1 yocto).
4. For the EVM demo: `./scripts/deploy-evm.sh sepolia` and `baseSepolia` with a funded deployer, then set `EVM_GATEWAY_*`, `BRIDGE_ENABLED=true`.

## Trust points and mocks (be honest in the demo)

- All tokens are valueless mocks with an open faucet.
- The "bridge" is a trusted relayer that burns on one chain and mints on the other. The production path is NEAR Intents.
- The contract admin can upgrade the contract. It has no method that moves user funds.
- The backend holds invite secrets (encrypted) and releases one only after an emailed code. The secret becomes public in the accept transaction (single use, short deadline).
- Hackathon note: the HTML prototypes (`andum-web/` and earlier design files) are design material. All contract and backend code here is new.
