import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toBytes, Hex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { Env } from '@andum/shared';

export type EvmChain = 'sepolia' | 'baseSepolia';
export const EVM_CHAINS: EvmChain[] = ['sepolia', 'baseSepolia'];
/** confirmations before acting [VERIFY] */
export const CONFIRMATIONS: Record<EvmChain, number> = { sepolia: 2, baseSepolia: 5 };
export const EVM_SOURCE = 'EVM_SOURCE';

export interface DepositLog {
  chain: EvmChain; nonce: bigint; assetId: string; from: string; amount: bigint; nearAccount: string;
  packageId: bigint; partId: number; fund: boolean; txHash: string; blockNumber: bigint; logIndex: number;
}
export interface EvmSource {
  chains(): EvmChain[];
  latestBlock(chain: EvmChain): Promise<bigint>;
  getDepositLogs(chain: EvmChain, from: bigint, to: bigint): Promise<DepositLog[]>;
  /** is this deposit still part of the canonical chain? (reorg check) */
  depositStillExists(chain: EvmChain, d: { txHash: string; nonce: bigint; blockNumber: bigint }): Promise<boolean>;
  release(chain: EvmChain, a: { assetId: string; to: string; amount: bigint; nonce: bigint; nearTxHash: string }): Promise<{ txHash: string; alreadyReleased: boolean }>;
}

export const assetIdBytes32 = (id: string): string => keccak256(toBytes(id));

export class NullEvmSource implements EvmSource {
  chains() { return [] as EvmChain[]; }
  async latestBlock(): Promise<bigint> { throw new Error('EVM bridge is not enabled'); }
  async getDepositLogs(): Promise<DepositLog[]> { return []; }
  async depositStillExists() { return false; }
  async release(): Promise<never> { throw new Error('EVM bridge is not enabled'); }
}

const GATEWAY_ABI = parseAbi([
  'event DepositedForNear(uint256 indexed nonce, bytes32 indexed assetId, address indexed from, uint256 amount, string nearAccount, uint64 packageId, uint8 partId, bool fund)',
  'function release(bytes32 assetId, address to, uint256 amount, uint256 nearNonce, string nearTxHash)',
  'error AlreadyReleased()',
]);

/** Real implementation on viem. [VERIFY] on Sepolia and Base Sepolia once contracts are deployed [HUMAN]. */
export class ViemEvmSource implements EvmSource {
  private clients = new Map<EvmChain, { pub: any; wallet: any; gateway: Hex }>();
  constructor(env: Env) {
    const defs: [EvmChain, any, string, string][] = [['sepolia', sepolia, env.EVM_SEPOLIA_RPC, env.EVM_GATEWAY_SEPOLIA], ['baseSepolia', baseSepolia, env.EVM_BASE_SEPOLIA_RPC, env.EVM_GATEWAY_BASE_SEPOLIA]];
    for (const [name, chain, rpc, gw] of defs) {
      if (!rpc || !gw) continue;
      const account = env.EVM_RELAYER_PK ? privateKeyToAccount(env.EVM_RELAYER_PK as Hex) : undefined;
      this.clients.set(name, { pub: createPublicClient({ chain, transport: http(rpc) }), wallet: account ? createWalletClient({ account, chain, transport: http(rpc) }) : null, gateway: getAddress(gw) });
    }
  }
  chains() { return [...this.clients.keys()]; }
  private c(chain: EvmChain) { const x = this.clients.get(chain); if (!x) throw new Error(`chain ${chain} not configured`); return x; }
  async latestBlock(chain: EvmChain) { return this.c(chain).pub.getBlockNumber(); }
  async getDepositLogs(chain: EvmChain, from: bigint, to: bigint): Promise<DepositLog[]> {
    const { pub, gateway } = this.c(chain);
    const logs = await pub.getContractEvents({ address: gateway, abi: GATEWAY_ABI, eventName: 'DepositedForNear', fromBlock: from, toBlock: to });
    return logs.map((l: any) => ({
      chain, nonce: l.args.nonce, assetId: l.args.assetId, from: l.args.from, amount: l.args.amount, nearAccount: l.args.nearAccount,
      packageId: l.args.packageId, partId: Number(l.args.partId), fund: l.args.fund, txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.logIndex,
    }));
  }
  async depositStillExists(chain: EvmChain, d: { txHash: string; nonce: bigint; blockNumber: bigint }) {
    const logs = await this.getDepositLogs(chain, d.blockNumber, d.blockNumber);
    return logs.some((l) => l.nonce === d.nonce && l.txHash.toLowerCase() === d.txHash.toLowerCase());
  }
  async release(chain: EvmChain, a: { assetId: string; to: string; amount: bigint; nonce: bigint; nearTxHash: string }) {
    const { pub, wallet, gateway } = this.c(chain);
    if (!wallet) throw new Error('EVM_RELAYER_PK is not configured');
    try {
      const hash = await wallet.writeContract({ address: gateway, abi: GATEWAY_ABI, functionName: 'release', args: [a.assetId as Hex, a.to as Hex, a.amount, a.nonce, a.nearTxHash] });
      await pub.waitForTransactionReceipt({ hash });
      return { txHash: hash as string, alreadyReleased: false };
    } catch (e: any) {
      if (/AlreadyReleased/.test(String(e?.message ?? e) + String(e?.shortMessage ?? ''))) return { txHash: '', alreadyReleased: true };
      throw e;
    }
  }
}
