#!/usr/bin/env bash
# Idempotent NEAR testnet deploy using plaintext keys (testnet only). Secrets: ./secret (funded account) and deployments/secrets/ (generated, gitignored).
# Usage: ./scripts/deploy-near.sh          (ROOT defaults to the account whose key is in ./secret)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${ROOT:-hafidbuild.testnet}"
ASSETS=(${ASSETS:-usdc idrx myr xau aapl})
BRIDGEABLE=(${BRIDGEABLE:-usdc idrx myr})
export PATH="$HOME/.cargo-andum/bin:$PATH"; export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup-andum}" CARGO_HOME="${CARGO_HOME:-$HOME/.cargo-andum}"
node scripts/keys.mjs gen >/dev/null
RPK=$(node scripts/keys.mjs near root pub); RSK=$(node scripts/keys.mjs near root priv)
OPK=$(node scripts/keys.mjs near ops pub); OSK=$(node scripts/keys.mjs near ops priv)
RELPK=$(node scripts/keys.mjs near relayer pub); BWPK=$(node scripts/keys.mjs near bridgeworker pub)

# 1. build + shrink (needs binaryen's wasm-opt; halves storage cost)
(cd smart-contract-near && cargo build --release --target wasm32-unknown-unknown -q 2>&1 | grep -v warning || true)
W=smart-contract-near/target/wasm32-unknown-unknown/release; O=smart-contract-near/target/opt; mkdir -p $O
for f in andum_core andum_mock_ft andum_bridge; do wasm-opt -Oz --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int --signext-lowering $W/$f.wasm -o $O/$f.wasm; done

acct() { echo "$1.$ROOT"; }
exists() { near account view-account-summary "$1" network-config testnet now >/dev/null 2>&1; }
# balance (NEAR) = wasm storage (1 NEAR per 100 KB) + slack
bal() { python3 -c "import os,sys;print(round(os.path.getsize('$1')/1e5+${2:-0.6},2))"; }
root_sign=(sign-with-plaintext-private-key "$RSK" send)
ops_sign=(sign-with-plaintext-private-key "$OSK" send)
create() { # name balance pubkey
  exists "$(acct "$1")" && { echo "exists: $(acct "$1")"; return; }
  near account create-account fund-myself "$(acct "$1")" "$2 NEAR" use-manually-provided-public-key "$3" sign-as "$ROOT" network-config testnet "${root_sign[@]}" >/dev/null && echo "created $(acct "$1") ($2 NEAR)"
}
deployed() { near contract inspect "$(acct "$1")" network-config testnet now 2>/dev/null | grep -q "Contract Code hash\|code_hash\|Global" ; }

create core "$(bal $O/andum_core.wasm 6)" "$OPK"
create bridge "$(bal $O/andum_bridge.wasm 0.6)" "$OPK"
create relayer 5 "$RELPK"
create bridgeworker 1 "$BWPK"
create admin 0.5 "$OPK"
for a in "${ASSETS[@]}"; do create "$a" "$(bal $O/andum_mock_ft.wasm 0.6)" "$OPK"; done

join() { local IFS=,; echo "$*"; }
list() { local out=(); for a in "$@"; do out+=("\"$(acct "$a")\""); done; join "${out[@]}"; }
STATE=deployments/.near-deploy-state; touch $STATE
once() { grep -qx "$1" $STATE && { echo "done: $1"; return; }; shift; "$@"; echo "$KEY" >> $STATE; }

deploy_core() { near contract deploy "$(acct core)" use-file $O/andum_core.wasm with-init-call new json-args "{\"owner\":\"$(acct admin)\",\"allowed_tokens\":[$(list "${ASSETS[@]}")],\"limits\":null}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet "${ops_sign[@]}" >/dev/null; }
KEY=core; once core deploy_core

for a in "${ASSETS[@]}"; do
  case " ${BRIDGEABLE[*]} " in *" $a "*) per=10000000000; day=100000000000;; *) per=100000000; day=1000000000;; esac
  d() { near contract deploy "$(acct "$a")" use-file $O/andum_mock_ft.wasm with-init-call new json-args "{\"owner_id\":\"$(acct admin)\",\"name\":\"$a\",\"symbol\":\"$(echo "$a" | tr a-z A-Z)\",\"decimals\":6,\"minters\":[\"$(acct bridge)\"],\"per_call_cap\":\"$per\",\"daily_cap\":\"$day\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet "${ops_sign[@]}" >/dev/null; }
  KEY="tok-$a"; once "tok-$a" d
  r() { near contract call-function as-transaction "$(acct "$a")" storage_deposit json-args "{\"account_id\":\"$(acct core)\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as "$ROOT" network-config testnet "${root_sign[@]}" >/dev/null; }
  KEY="reg-$a"; once "reg-$a" r
done

deploy_bridge() { near contract deploy "$(acct bridge)" use-file $O/andum_bridge.wasm with-init-call new json-args "{\"owner\":\"$(acct admin)\",\"relayer\":\"$(acct bridgeworker)\",\"core\":\"$(acct core)\",\"bridgeable_tokens\":[$(list "${BRIDGEABLE[@]}")]}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet "${ops_sign[@]}" >/dev/null; }
KEY=bridge; once bridge deploy_bridge
# the bridge receives tokens via ft_transfer_call (NEAR -> EVM), so it must be registered (NEP-145) with each bridgeable token
for a in "${BRIDGEABLE[@]}"; do
  rb() { near contract call-function as-transaction "$(acct "$a")" storage_deposit json-args "{\"account_id\":\"$(acct bridge)\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as "$ROOT" network-config testnet "${root_sign[@]}" >/dev/null; }
  KEY="regb-$a"; once "regb-$a" rb
done

# contract keeps a NEAR buffer for storage of packages (plan 2.4, reduced for a testnet budget)
fund() { near tokens "$ROOT" send-near "$(acct "$1")" "$2 NEAR" network-config testnet "${root_sign[@]}" >/dev/null; }
KEY=fund-core; once fund-core fund core 4

python3 - <<PY
import json
r="$ROOT"; a=lambda n:f"{n}.{r}"
assets="${ASSETS[*]}".split()
json.dump({"root":r,"core":a("core"),"bridge":a("bridge"),"relayer":a("relayer"),"bridgeworker":a("bridgeworker"),"admin":a("admin"),"opsPublicKey":"$OPK","tokens":{t:a(t) for t in assets}},open("deployments/near.testnet.json","w"),indent=2)
PY
echo "deployed. wrote deployments/near.testnet.json"
