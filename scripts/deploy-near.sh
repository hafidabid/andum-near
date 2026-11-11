#!/usr/bin/env bash
# Idempotent NEAR testnet deploy. NOT YET RUN: needs the ROOT account in the local near-cli keystore [HUMAN].
# Usage: ROOT=andum-hack.testnet ./scripts/deploy-near.sh
set -euo pipefail
: "${ROOT:?set ROOT to your funded testnet account}"
cd "$(dirname "$0")/../smart-contract-near"
export PATH="$HOME/.cargo-andum/bin:$PATH"
cargo build --release --target wasm32-unknown-unknown
W=target/wasm32-unknown-unknown/release
ASSETS=(usdc idrx myr sgd thb eur jpy xau aapl nvda tsla)
BRIDGEABLE=(usdc idrx myr sgd thb eur jpy)
acct() { echo "$1.$ROOT"; }
create() { near account view-account-summary "$(acct "$1")" network-config testnet >/dev/null 2>&1 || near account create-account fund-myself "$(acct "$1")" '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$ROOT" network-config testnet sign-with-keychain send; }

for a in core bridge relayer bridgeworker admin "${ASSETS[@]}"; do create "$a"; done

tokens_json=$(printf '"%s.'"$ROOT"'",' "${ASSETS[@]}"); tokens_json="[${tokens_json%,}]"
near contract deploy "$(acct core)" use-file "$W/andum_core.wasm" with-init-call new json-args "{\"owner\":\"$(acct admin)\",\"allowed_tokens\":$tokens_json,\"limits\":null}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send

for a in "${ASSETS[@]}"; do
  case " ${BRIDGEABLE[*]} " in *" $a "*) per=10000000000; day=100000000000;; *) per=100000000; day=1000000000;; esac
  near contract deploy "$(acct "$a")" use-file "$W/andum_mock_ft.wasm" with-init-call new json-args "{\"owner_id\":\"$(acct admin)\",\"name\":\"$a\",\"symbol\":\"$(echo "$a" | tr a-z A-Z)\",\"decimals\":6,\"minters\":[\"$(acct bridge)\"],\"per_call_cap\":\"$per\",\"daily_cap\":\"$day\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
done

# core must be registered with every token to receive funding via ft_transfer_call (NEP-145)
for a in "${ASSETS[@]}"; do near contract call-function as-transaction "$(acct "$a")" storage_deposit json-args "{\"account_id\":\"$(acct core)\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as "$ROOT" network-config testnet sign-with-keychain send; done

btok=$(printf '"%s.'"$ROOT"'",' "${BRIDGEABLE[@]}"); btok="[${btok%,}]"
near contract deploy "$(acct bridge)" use-file "$W/andum_bridge.wasm" with-init-call new json-args "{\"owner\":\"$(acct admin)\",\"relayer\":\"$(acct bridgeworker)\",\"core\":\"$(acct core)\",\"bridgeable_tokens\":$btok}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send

# contract must hold NEAR for storage (plan 2.4: at least 20 NEAR); relayer must hold NEAR for gas
near tokens "$ROOT" send-near "$(acct core)" '20 NEAR' network-config testnet sign-with-keychain send || true
near tokens "$ROOT" send-near "$(acct relayer)" '10 NEAR' network-config testnet sign-with-keychain send || true

cat > ../deployments/near.testnet.json <<JSON
{"root":"$ROOT","core":"$(acct core)","bridge":"$(acct bridge)","relayer":"$(acct relayer)","bridgeworker":"$(acct bridgeworker)","admin":"$(acct admin)","tokens":{$(printf '"%s":"%s.'"$ROOT"'",' $(for a in "${ASSETS[@]}"; do echo "$a $a"; done) | sed 's/,$//')}}
JSON
echo "deployed. wrote deployments/near.testnet.json"
