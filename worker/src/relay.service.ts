import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import {
  CHAIN_CLIENT, ChainClient, ChainTransportError, DB, ENV, Env, RELAY_QUEUE, RelayJobData, buildPolicyState, decide, decodeSignedDelegate, parseChainError, policyConfig, DecodedDelegate,
} from '@andum/shared';
import { REDIS } from './infra';
import { Reconciler } from './reconciler';
import { publish } from './publisher';

export type RelayResult = 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'SKIPPED';

@Injectable()
export class RelayService implements OnModuleDestroy {
  private log = new Logger('relay');
  private worker?: Worker;
  /** retry schedule for transport errors (ms); tests shorten it */
  retryDelaysMs = [500, 2000, 5000];

  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env, @Inject(REDIS) private redis: Redis, private reconciler: Reconciler) {}

  /** One relayer key means one in-flight submission: concurrency 1 keeps the key nonce monotonic. */
  start() {
    this.worker = new Worker<RelayJobData>(RELAY_QUEUE, (job: Job<RelayJobData>) => this.process(job.data.relayId),
      { connection: new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), prefix: this.env.QUEUE_PREFIX, concurrency: 1 });
    this.worker.on('error', (e) => this.log.warn(e.message));
  }
  async onModuleDestroy() { await this.worker?.close(); }

  async process(relayId: string): Promise<RelayResult> {
    // claim: only a QUEUED job can start; a second delivery of the same job does nothing
    const claimed = await this.db.query(`update relay_jobs set status='SUBMITTED', attempts = attempts + 1, updated_at=now() where id=$1 and status='QUEUED' returning *`, [relayId]);
    const job = claimed.rows[0];
    if (!job) return 'SKIPPED';

    let d: DecodedDelegate;
    try { d = decodeSignedDelegate(job.signed_delegate_b64); } catch { return this.finish(job, 'REJECTED', { code: 'RELAY_POLICY_DENIED', message: 'payload cannot be decoded' }); }

    // re-check policy with fresh chain state: things may have changed since the API accepted it
    const user = (await this.db.query('select public_key from users where near_account_id=$1', [job.account_id])).rows[0];
    for (let attempt = 0; ; attempt++) {
      try {
        const state = await buildPolicyState(this.db, this.chain, this.env, d, job.account_id, user?.public_key ?? null, job.payload_hash, job.id);
        const decision = decide(d, state, policyConfig(this.env));
        if (!decision.allow) return this.finish(job, 'REJECTED', { code: 'RELAY_POLICY_DENIED', message: `${decision.rule}: ${decision.message}` });
        const out = await this.chain.submitDelegate(job.signed_delegate_b64);
        if (out.success) {
          let summary: Record<string, unknown> = { logs: out.logs.length };
          try { const r = await this.reconciler.ingestOutcome(out); summary = { ...summary, events: r.events, packages: r.packages }; }
          catch (e) { this.log.warn(`ingest failed for ${out.txHash}: ${(e as Error).message}`); } // the periodic sweep will catch up
          return this.finish(job, 'SUCCEEDED', { txHash: out.txHash, outcome: summary });
        }
        // contract failures are final and never retried
        const code = parseChainError(out.failure);
        return this.finish(job, 'FAILED', { txHash: out.txHash, code: code ?? 'RELAY_CHAIN_FAILURE', message: (out.failure ?? '').slice(0, 500) });
      } catch (e) {
        if (e instanceof ChainTransportError && attempt < this.retryDelaysMs.length) { await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt])); continue; }
        if (e instanceof ChainTransportError) return this.finish(job, 'FAILED', { code: 'UPSTREAM_UNAVAILABLE', message: e.message });
        this.log.error(`relay ${relayId} crashed: ${(e as Error).message}`);
        return this.finish(job, 'FAILED', { code: 'RELAY_CHAIN_FAILURE', message: 'internal error' });
      }
    }
  }

  private async finish(job: any, status: 'SUCCEEDED' | 'FAILED' | 'REJECTED', o: { txHash?: string; code?: string; message?: string; outcome?: unknown }): Promise<RelayResult> {
    await this.db.query(`update relay_jobs set status=$2, tx_hash=$3, error_code=$4, error_message=$5, outcome=$6, updated_at=now() where id=$1`,
      [job.id, status, o.txHash ?? null, o.code ?? null, o.message ?? null, o.outcome ? JSON.stringify(o.outcome) : null]);
    await publish(this.redis, { type: 'relay.updated', accounts: [job.account_id], data: { relay_id: job.id, status, tx_hash: o.txHash, error_code: o.code } });
    return status;
  }
}
