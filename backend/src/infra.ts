import { DynamicModule, Global, Module, OnApplicationShutdown, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import {
  CHAIN_CLIENT, ChainClient, DB, ENV, Env, FakeChain, MAILER, Mailer, NearRpcChain, RELAY_QUEUE, createMailer, createPool, loadEnv, migrate, StreamMessage, EVENT_CHANNEL,
} from '@andum/shared';

export const REDIS = 'REDIS';
export const RELAY_Q = 'RELAY_Q';
export const PUBLISHER = 'PUBLISHER';

export interface InfraOptions { env?: Partial<Env>; chain?: ChainClient; mailer?: Mailer }

@Injectable()
export class Publisher {
  constructor(@Inject(REDIS) private redis: Redis) {}
  async publish(m: StreamMessage) { await this.redis.publish(EVENT_CHANNEL, JSON.stringify(m)); }
}

@Injectable()
class Shutdown implements OnApplicationShutdown {
  constructor(@Inject(DB) private db: Pool, @Inject(REDIS) private redis: Redis, @Inject(RELAY_Q) private q: Queue) {}
  async onApplicationShutdown() {
    await this.q.close().catch(() => undefined);
    this.redis.disconnect();
    await this.db.end().catch(() => undefined);
  }
}

@Global()
@Module({})
export class InfraModule {
  static register(opts: InfraOptions = {}): DynamicModule {
    const env: Env = { ...loadEnv(), ...(opts.env ?? {}) } as Env;
    return {
      module: InfraModule,
      global: true,
      providers: [
        { provide: ENV, useValue: env },
        { provide: DB, useFactory: async () => { const p = createPool(env.DATABASE_URL); await migrate(p); return p; } },
        { provide: REDIS, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }) },
        { provide: RELAY_Q, useFactory: () => new Queue(RELAY_QUEUE, { connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), prefix: env.QUEUE_PREFIX }) },
        {
          provide: CHAIN_CLIENT,
          useFactory: (): ChainClient => {
            if (opts.chain) return opts.chain;
            if (env.USE_FAKE_CHAIN) return new FakeChain();
            return new NearRpcChain({ rpcUrls: env.NEAR_RPC_URLS.split(','), relayerAccount: env.RELAYER_ACCOUNT, relayerSecretKey: env.RELAYER_PRIVATE_KEY });
          },
        },
        { provide: MAILER, useFactory: () => opts.mailer ?? createMailer(env) },
        Publisher,
        Shutdown,
      ],
      exports: [ENV, DB, REDIS, RELAY_Q, CHAIN_CLIENT, MAILER, Publisher],
    };
  }
}
