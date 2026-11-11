import { DynamicModule, Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import {
  CHAIN_CLIENT, ChainClient, DB, ENV, Env, FakeChain, MAILER, Mailer, NearRpcChain, createMailer, createPool, loadEnv, migrate,
} from '@andum/shared';
import { EvmSource, EVM_SOURCE, NullEvmSource, ViemEvmSource } from './evm';

export const REDIS = 'REDIS';
export const BRIDGE_NEAR = 'BRIDGE_NEAR'; // chain client signed by the bridge worker account

export interface WorkerInfraOptions { env?: Partial<Env>; chain?: ChainClient; bridgeNear?: ChainClient; mailer?: Mailer; evm?: EvmSource }

@Global()
@Module({})
export class WorkerInfra {
  static register(opts: WorkerInfraOptions = {}): DynamicModule {
    const env: Env = { ...loadEnv(), ...(opts.env ?? {}) } as Env;
    return {
      module: WorkerInfra,
      global: true,
      providers: [
        { provide: ENV, useValue: env },
        { provide: DB, useFactory: async () => { const p = createPool(env.DATABASE_URL); await migrate(p); return p; } },
        { provide: REDIS, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) },
        {
          provide: CHAIN_CLIENT,
          useFactory: (): ChainClient => opts.chain ?? (env.USE_FAKE_CHAIN ? new FakeChain() : new NearRpcChain({ rpcUrls: env.NEAR_RPC_URLS.split(','), relayerAccount: env.RELAYER_ACCOUNT, relayerSecretKey: env.RELAYER_PRIVATE_KEY })),
        },
        {
          provide: BRIDGE_NEAR,
          useFactory: (): ChainClient => opts.bridgeNear ?? (env.USE_FAKE_CHAIN ? new FakeChain() : new NearRpcChain({ rpcUrls: env.NEAR_RPC_URLS.split(','), relayerAccount: env.BRIDGE_WORKER_ACCOUNT, relayerSecretKey: env.BRIDGE_WORKER_PRIVATE_KEY })),
        },
        { provide: MAILER, useFactory: () => opts.mailer ?? createMailer(env) },
        { provide: EVM_SOURCE, useFactory: (): EvmSource => opts.evm ?? (env.BRIDGE_ENABLED ? new ViemEvmSource(env) : new NullEvmSource()) },
      ],
      exports: [ENV, DB, REDIS, CHAIN_CLIENT, BRIDGE_NEAR, MAILER, EVM_SOURCE],
    };
  }
}
