import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  ApiError, CHAIN_CLIENT, ChainClient, DB, ENV, Env, PolicyState, RelayJobData, decide, decodeSignedDelegate, DecodedDelegate, buildPolicyState, policyConfig,
} from '@andum/shared';
import { AuthUser, CurrentUser, parse } from './common';
import { RELAY_Q, Publisher } from './infra';
import { upstream } from './accounts';

const submitBody = z.object({
  signed_delegate_b64: z.string().min(20).max(30_000),
  purpose: z.string().max(100).optional(),
  client_request_id: z.string().min(1).max(100),
});
const UUID = /^[0-9a-f-]{36}$/i;

@Controller('v1/relay')
export class RelayController {
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env, @Inject(RELAY_Q) private q: Queue, private pub: Publisher) {}

  @Post('submit') @HttpCode(202)
  async submit(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(submitBody, body);
    let d: DecodedDelegate;
    try { d = decodeSignedDelegate(b.signed_delegate_b64); } catch { throw new ApiError(400, 'VALIDATION_FAILED', 'signed_delegate_b64 is not a valid signed delegate action'); }
    const payloadHash = createHash('sha256').update(Buffer.from(b.signed_delegate_b64, 'base64')).digest();

    // idempotent resubmission by client_request_id
    const existing = (await this.db.query('select id, status, payload_hash from relay_jobs where account_id=$1 and client_request_id=$2', [u.accountId, b.client_request_id])).rows[0];
    if (existing) {
      if (!existing.payload_hash.equals(payloadHash)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'client_request_id was used with a different payload');
      return { relay_id: existing.id, status: existing.status };
    }

    let state: PolicyState;
    try { state = await buildPolicyState(this.db, this.chain, this.env, d, u.accountId, u.publicKey, payloadHash); } catch (e) { throw upstream(e); }
    const decision = decide(d, state, policyConfig(this.env));
    if (!decision.allow) {
      const { rule, message } = decision;
      if (rule === 'R10') throw new ApiError(409, 'RELAY_DUPLICATE', message, { rule });
      if (rule === 'R9') throw new ApiError(429, 'RATE_LIMITED', message, { rule });
      if (rule === 'R3' && /expired/.test(message)) throw new ApiError(400, 'RELAY_EXPIRED', message, { rule });
      throw new ApiError(rule === 'R1' || rule === 'R2' ? 401 : 403, rule === 'R1' || rule === 'R2' ? 'UNAUTHENTICATED' : 'RELAY_POLICY_DENIED', message, { rule });
    }
    const a = d.actions[0] as { methodName: string };
    let id: string;
    try {
      const r = await this.db.query(
        `insert into relay_jobs (client_request_id, account_id, receiver_id, method, payload_hash, signed_delegate_b64, purpose) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [b.client_request_id, u.accountId, d.receiverId, a.methodName, payloadHash, b.signed_delegate_b64, b.purpose ?? null]);
      id = r.rows[0].id;
    } catch (e: any) {
      if (e?.code === '23505') throw new ApiError(409, 'RELAY_DUPLICATE', 'This exact payload was already submitted', { rule: 'R10' });
      throw e;
    }
    await this.q.add('relay', { relayId: id } satisfies RelayJobData, { jobId: id, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
    return { relay_id: id, status: 'QUEUED' };
  }

  @Get(':id')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Relay job not found');
    const r = await this.db.query('select * from relay_jobs where id=$1 and account_id=$2', [id, u.accountId]);
    if (!r.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Relay job not found');
    const j = r.rows[0];
    return { status: j.status, tx_hash: j.tx_hash ?? undefined, error_code: j.error_code ?? undefined, error_message: j.error_message ?? undefined, outcome: j.outcome ?? undefined };
  }
}
