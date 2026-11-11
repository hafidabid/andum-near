#!/usr/bin/env bash
# NOT YET RUN: needs a funded deployer key [HUMAN]. Usage: EVM_DEPLOYER_PK=0x.. BRIDGE_RELAYER=0x.. ./scripts/deploy-evm.sh sepolia|baseSepolia
set -euo pipefail
net="${1:?sepolia or baseSepolia}"
: "${EVM_DEPLOYER_PK:?}" "${BRIDGE_RELAYER:?}"
case "$net" in sepolia) rpc="${EVM_SEPOLIA_RPC:?}";; baseSepolia) rpc="${EVM_BASE_SEPOLIA_RPC:?}";; *) echo "bad network"; exit 1;; esac
cd "$(dirname "$0")/../smart-contract-evm"
forge script script/Deploy.s.sol --rpc-url "$rpc" --broadcast | tee "../deployments/$net.log"
echo "copy the printed addresses into deployments/$net.json and the EVM_GATEWAY_* env vars"
