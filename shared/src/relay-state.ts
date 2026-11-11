import { Pool } from 'pg';
import { ASSETS, nearTokenAccount } from './assets';
import { ChainClient } from './chain';
import { Env, nearToYocto } from './config';
import { isKilled } from './db';
import { PolicyConfig, PolicyState } from './policy';
import { DecodedDelegate } from './near-tx';

export function policyConfig(env: Env): PolicyConfig {
  return {
    core: env.NEAR_CORE, bridge: env.NEAR_BRIDGE, tokens: ASSETS.map((a) => nearTokenAccount(a.id, env.NEAR_ROOT)),
    maxHeightWindow: 200, perMinute: 30, perDay: 600, mintsPerMinute: 3,
  };
}

/** Collect the facts the pure policy function needs. Shared by API and worker. */
export async function buildPolicyState(db: Pool, chain: ChainClient, env: Env, d: DecodedDelegate, sessionAccountId: string, registeredPublicKey: string | null, payloadHash: Buffer, excludeJobId?: string): Promise<PolicyState> {
  const [height, keyNonce, paused] = await Promise.all([chain.getBlockHeight(), d.publicKey ? chain.getAccessKeyNonce(d.senderId, d.publicKey) : Promise.resolve(null), isKilled(db, 'relayer')]);
  const c = await db.query(
    `select count(*) filter (where created_at > now() - interval '1 minute')::int m,
            count(*) filter (where created_at > now() - interval '1 day')::int d,
            count(*) filter (where created_at > now() - interval '1 minute' and method='ft_mint')::int mints
     from relay_jobs where account_id=$1 and ($2::uuid is null or id<>$2)`, [sessionAccountId, excludeJobId ?? null]);
  const g = await db.query(`select count(*)::int n from relay_jobs where created_at > now() - interval '1 day' and status in ('SUBMITTED','SUCCEEDED','FAILED')`);
  const dup = await db.query(`select 1 from relay_jobs where payload_hash=$1 and ($2::uuid is null or id<>$2)`, [payloadHash, excludeJobId ?? null]);
  const estimatedSpend = BigInt(g.rows[0].n) * nearToYocto(0.003);
  return {
    sessionAccountId, currentBlockHeight: height, keyNonce, registeredPublicKey,
    submissionsLastMinute: c.rows[0].m, submissionsToday: c.rows[0].d, mintsLastMinute: c.rows[0].mints,
    dailyBudgetExceeded: estimatedSpend >= nearToYocto(env.RELAYER_DAILY_BUDGET_NEAR),
    payloadAlreadySeen: dup.rowCount! > 0, relayerPaused: paused,
  };
}

