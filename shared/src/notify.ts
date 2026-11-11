import { Pool } from 'pg';
import { Mailer, emailTemplates } from './mailer';

export type NotificationKind = 'invite' | 'part_ready' | 'approval_request' | 'otp';
export const MAX_NOTIFY_ATTEMPTS = 5;

/** Insert once per dedupe key. Returns the id, or null if it already existed. */
export async function enqueueNotification(db: Pool, n: { kind: NotificationKind; dedupeKey: string; to: string; payload: Record<string, unknown> }): Promise<string | null> {
  const r = await db.query(
    `insert into notifications (kind, dedupe_key, to_email, payload) values ($1,$2,$3,$4) on conflict (dedupe_key) do nothing returning id`,
    [n.kind, n.dedupeKey, n.to, JSON.stringify(n.payload)],
  );
  return r.rows[0]?.id ?? null;
}

function render(kind: string, p: Record<string, any>) {
  switch (kind) {
    case 'invite': return emailTemplates.invite(String(p.sender ?? 'Someone'), String(p.link));
    case 'part_ready': return emailTemplates.partReady(String(p.link), Number(p.part_id ?? 0));
    case 'approval_request': return emailTemplates.approvalRequest(String(p.link), String(p.sender ?? 'Someone'));
    default: throw new Error(`cannot render ${kind}`);
  }
}

/** Send one pending notification. Status machine: PENDING -> SENT | (retry with backoff) | FAILED after MAX attempts. */
export async function deliverNotification(db: Pool, mailer: Mailer, id: string): Promise<'SENT' | 'RETRY' | 'FAILED' | 'SKIPPED' | 'NOOP'> {
  const claimed = await db.query(
    `update notifications set attempts = attempts + 1 where id=$1 and status='PENDING' and next_attempt_at <= now() returning *`, [id]);
  const n = claimed.rows[0];
  if (!n) return 'NOOP';
  try {
    const m = render(n.kind, n.payload);
    const r = await mailer.send({ to: n.to_email, ...m });
    await db.query(`update notifications set status='SENT', provider_id=$2, sent_at=now(), error=null where id=$1`, [id, r.id]);
    return 'SENT';
  } catch (e: any) {
    if (n.attempts >= MAX_NOTIFY_ATTEMPTS) {
      await db.query(`update notifications set status='FAILED', error=$2 where id=$1`, [id, String(e?.message ?? e)]);
      return 'FAILED';
    }
    const backoffSec = Math.min(900, 5 * 2 ** n.attempts);
    await db.query(`update notifications set error=$2, next_attempt_at = now() + ($3 || ' seconds')::interval where id=$1`, [id, String(e?.message ?? e), String(backoffSec)]);
    return 'RETRY';
  }
}

/** Fixed-window counter. Returns true when the call is within the limit. */
export async function consume(db: Pool, key: string, bucket: string, windowSec: number, limit: number): Promise<boolean> {
  const r = await db.query(
    `insert into quota_usage (account_id, bucket, window_start, used)
     values ($1,$2, to_timestamp(floor(extract(epoch from now())/$3)*$3), 1)
     on conflict (account_id, bucket, window_start) do update set used = quota_usage.used + 1
     returning used`,
    [key, bucket, windowSec],
  );
  return r.rows[0].used <= limit;
}

/** Side effects of chain events on backend tables. Idempotent. */
export async function applyEventSideEffects(db: Pool, events: { event: string; data: Record<string, unknown> }[]) {
  for (const e of events) {
    if (e.event === 'package_accepted' && typeof e.data.package_id === 'string') {
      await db.query(`update invites set status='ACCEPTED' where package_id=$1 and status in ('ATTACHED','VERIFIED')`, [e.data.package_id]);
    }
  }
}
