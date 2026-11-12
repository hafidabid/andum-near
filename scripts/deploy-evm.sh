#!/usr/bin/env bash
# Deploy the EVM contracts with `forge create` + `cast send` (robust on rate-limited public RPCs; no fork simulation).
# Usage: ./scripts/deploy-evm.sh anvil|sepolia|baseSepolia      (RPC override: EVM_<NET>_RPC)
#  anvil: run `anvil` first; uses anvil's well-known dev key.  sepolia/baseSepolia: SEPOLIA_PRIVATE_KEY from ./secret (gitignored).
# Relayer keys: deployments/secrets/evm-keys.json (generated). Writes deployments/<net>.json (addresses only). Never prints private keys.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
net="${1:?anvil, sepolia or baseSepolia}"
node scripts/keys.mjs gen >/dev/null
case "$net" in
  anvil) rpc="${EVM_ANVIL_RPC:-http://127.0.0.1:8545}"; pk="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";;
  sepolia) rpc="${EVM_SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"; pk=$(node scripts/keys.mjs evm sepolia priv);;
  baseSepolia) rpc="${EVM_BASE_SEPOLIA_RPC:-https://sepolia.base.org}"; pk=$(node scripts/keys.mjs evm sepolia priv);;
  *) echo "bad network"; exit 1;;
esac
relayer=$(node scripts/keys.mjs evm relayer addr)
me=$(cast wallet address --private-key "$pk")
echo "network $net · deployer $me · balance $(cast balance "$me" --rpc-url "$rpc" --ether) ETH"
cd smart-contract-evm
retry() { local n=0; until "$@"; do n=$((n+1)); [ $n -ge 5 ] && return 1; sleep $((n*3)); done; }
create() { # contract path, args...
  local c="$1"; shift
  local a; a=$(retry forge create "$c" --rpc-url "$rpc" --private-key "$pk" --broadcast --json "$@" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['deployedTo'])")
  settle; echo "$a"
}
settle() { [ "$net" = anvil ] || sleep "${SETTLE:-10}"; }
send() { retry cast send "$@" --rpc-url "$rpc" --private-key "$pk" >/dev/null; settle; }
OUT=../deployments/$net.state.json; [ -f "$OUT" ] || echo '{}' > "$OUT"
get() { python3 -c "import json;print(json.load(open('$OUT')).get('$1',''))"; }
put() { python3 -c "import json;d=json.load(open('$OUT'));d['$1']='$2';json.dump(d,open('$OUT','w'),indent=1)"; }

[ -n "$(get forwarder)" ] || { put forwarder "$(create lib/openzeppelin-contracts/contracts/metatx/ERC2771Forwarder.sol:ERC2771Forwarder --constructor-args AndumForwarder)"; }
echo "forwarder $(get forwarder)"
[ -n "$(get gateway)" ] || put gateway "$(create src/AndumGateway.sol:AndumGateway --constructor-args "$(get forwarder)" "$me")"
[ -n "$(get gateway_relayer)" ] || { send "$(get gateway)" "setRelayer(address,bool)" "$relayer" true; put gateway_relayer done; }
echo "gateway $(get gateway)"
ids=(usdc idrx myr sgd thb eur jpy xau aapl nvda tsla)
names=("US dollar stablecoin" "Indonesian rupiah" "Malaysian ringgit" "Singapore dollar" "Thai baht" "Euro" "Japanese yen" "Tokenized gold" "Apple Inc. stock" "Nvidia stock" "Tesla stock")
for i in "${!ids[@]}"; do
  id=${ids[$i]}; sym=$(echo "$id" | tr a-z A-Z)
  if [ "$i" -lt 7 ]; then per=10000000000; day=100000000000; else per=100000000; day=1000000000; fi
  if [ -z "$(get "$id")" ]; then
    put "$id" "$(create src/MockERC20.sol:MockERC20 --constructor-args "${names[$i]}" "$sym" 6 "$per" "$day" "$me")"
  fi
  t=$(get "$id")
  if [ "$i" -lt 7 ] && [ -z "$(get "${id}_wired")" ]; then
    send "$t" "grantRole(bytes32,address)" "$(cast keccak MINTER_ROLE)" "$(get gateway)"
    send "$(get gateway)" "setAsset(bytes32,address,bool,uint256)" "$(cast keccak "$id")" "$t" true 1000000000000
    put "${id}_wired" done
  fi
  echo "$id $(get "$id")"
done
python3 - "$net" "$relayer" <<PY
import json,sys
s=json.load(open("$OUT")); net,relayer=sys.argv[1:3]
tokens={k:v for k,v in s.items() if k not in("forwarder","gateway","gateway_relayer") and not k.endswith("_wired")}
json.dump({"network":net,"forwarder":s["forwarder"],"gateway":s["gateway"],"relayer":relayer,"tokens":tokens},open("../deployments/%s.json"%net,"w"),indent=2)
print("wrote deployments/%s.json"%net)
PY
