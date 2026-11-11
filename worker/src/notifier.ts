import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import {
  CHAIN_CLIENT, ChainClient, DB, ENV, Env, MAILER, Mailer, PackageView, deliverNotification, enqueueNotification,
} from '@andum/shared';

@Injectable()
export class Notifier implements OnModuleDestroy {
  private log = new Logger('notifier');
  private timer?: NodeJS.Timeout;
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env, @Inject(MAILER) private mailer: Mailer) {}

  start(intervalMs = 30_000) { this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(String(e))), intervalMs); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(nowNs: bigint = BigInt(Date.now()) * 1_000_000n) {
    const r = { partReady: await this.scanPartReady(nowNs), approvals: await this.scanApprovalRequests(), retried: await this.retryPending() };
    return r;
  }

  /** where to send mail for an owner account: their own preference first, then the invite they accepted */
  private async emailFor(account: string, packageId: string): Promise<{ email: string | null; enabled: boolean }> {
    const pref = (await this.db.query('select email, email_enabled from notification_prefs where account_id=$1', [account])).rows[0];
    const inv = (await this.db.query('select recipient_email from invites where package_id=$1', [packageId])).rows[0];
    return { email: pref?.email ?? inv?.recipient_email ?? null, enabled: pref ? pref.email_enabled : true };
  }

  async scanPartReady(nowNs: bigint): Promise<number> {
    const c = await this.db.query(
      `select p.package_id, p.part_id, k.owner
       from parts p join packages k on k.id = p.package_id
       where k.status = 'ACCEPTED' and k.owner is not null and p.state = 'LOCKED'
         and p.unlock_ns is not null and p.unlock_ns <= $1
         and (cardinality(p.approvers) = 0 or cardinality(p.approvals) >= p.threshold)
         and not exists (select 1 from notifications n where n.dedupe_key = p.package_id::text || ':' || p.part_id::text || ':part_ready')
       order by p.package_id, p.part_id limit 100`, [nowNs.toString()]);
    let sent = 0;
    for (const row of c.rows) {
      const pid = String(row.package_id); const part = Number(row.part_id);
      // the cache is only a hint: confirm on chain before telling a person their money is ready
      let v: PackageView | null;
      try { v = await this.chain.viewFunction<PackageView | null>(this.env.NEAR_CORE, 'get_package', { package_id: pid }); } catch { continue; }
      if (!v || v.parts[part]?.status !== 'OPEN') continue;
      const { email, enabled } = await this.emailFor(row.owner, pid);
      const key = `${pid}:${part}:part_ready`;
      if (!email) continue; // nobody to tell; try again next tick in case an address appears
      if (!enabled) {
        await this.db.query(`insert into notifications (kind, dedupe_key, to_email, status) values ('part_ready',$1,$2,'SKIPPED') on conflict (dedupe_key) do nothing`, [key, email]);
        continue;
      }
      const id = await enqueueNotification(this.db, { kind: 'part_ready', dedupeKey: key, to: email, payload: { link: `${this.env.PUBLIC_WEB_BASE}/package/${pid}`, part_id: part } });
      if (id && (await deliverNotification(this.db, this.mailer, id)) === 'SENT') sent++;
    }
    return sent;
  }

  /** one mail per named approver, once, when the package has been accepted (needs a known address) */
  async scanApprovalRequests(): Promise<number> {
    const c = await this.db.query(
      `select p.package_id, p.part_id, a.approver, k.sender
       from parts p join packages k on k.id = p.package_id, unnest(p.approvers) as a(approver)
       where k.status = 'ACCEPTED' and p.state = 'LOCKED' and not (a.approver = any(p.approvals))
       limit 200`);
    let sent = 0;
    for (const row of c.rows) {
      const pref = (await this.db.query('select email, email_enabled from notification_prefs where account_id=$1', [row.approver])).rows[0];
      if (!pref?.email || !pref.email_enabled) continue;
      const id = await enqueueNotification(this.db, {
        kind: 'approval_request', dedupeKey: `${row.package_id}:${row.part_id}:${row.approver}:approval_request`, to: pref.email,
        payload: { sender: row.sender, link: `${this.env.PUBLIC_WEB_BASE}/approve/${row.package_id}` },
      });
      if (id && (await deliverNotification(this.db, this.mailer, id)) === 'SENT') sent++;
    }
    return sent;
  }

  /** retry anything still pending (for example an invite email that failed when the API tried) */
  async retryPending(): Promise<number> {
    const r = await this.db.query(`select id from notifications where status='PENDING' and next_attempt_at <= now() order by created_at limit 50`);
    let sent = 0;
    for (const row of r.rows) if ((await deliverNotification(this.db, this.mailer, row.id)) === 'SENT') sent++;
    return sent;
  }
}
