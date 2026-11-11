## Why
Multichain demonstration on Sepolia and Base Sepolia (D-02, P2): mock ERC-20s, a burn/mint gateway and gasless meta-transactions (ANDUM-PLAN §6).

## What Changes
- `smart-contract-evm`: `MockERC20` (faucet, permit, burn, minter role), `AndumGateway` (deposit-for-NEAR, relayer release, replay guard, ERC-2771), forwarder via OpenZeppelin `ERC2771Forwarder`, deploy script.

## Capabilities
### New Capabilities
- `evm-mock-token`
- `evm-gateway`

## Impact
No package logic on EVM. Relayer is trusted (demo). OpenZeppelin v5.1.0 forwarder request shape verified by tests (spike S-05 resolved).
