import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiError, CHAIN_CLIENT, ChainClient, ChainTransportError, DB, ENV, Env, nearToYocto } from '@andum/shared';
import { AuthUser, CurrentUser, Public } from './common';

@Controller('v1')
export class AccountsController {
  constructor(@Inject(DB) private db: Pool, @Inject(CHAIN_CLIENT) private chain: ChainClient, @Inject(ENV) private env: Env) {}

  @Public() @Get('time')
  async time() {
    let chainNs: string | null = null;
    try { chainNs = (await this.chain.getChainTimeNs()).toString(); } catch { /* chain unreachable: still return server time */ }
    return { server_ms: Date.now(), chain_ns: chainNs };
  }

  @Post('accounts/bootstrap') @HttpCode(200)
  async bootstrap(@CurrentUser() u: AuthUser) {
    const min = nearToYocto(this.env.TOPUP_MIN_NEAR);
    let bal: bigint;
    try { bal = await this.chain.getBalanceYocto(u.accountId); } catch (e) { throw upstream(e); }
    if (bal >= min) return { account_id: u.accountId, created: false, near_balance_yocto: bal.toString() };
    const recent = await this.db.query(`select count(*)::int n from topups where account_id=$1 and created_at > now() - interval '24 hours'`, [u.accountId]);
    if (recent.rows[0].n >= this.env.BOOTSTRAP_PER_DAY) throw new ApiError(429, 'BOOTSTRAP_LIMIT', 'Daily top-up limit reached');
    const amount = nearToYocto(this.env.TOPUP_NEAR);
    let out;
    try { out = await this.chain.transferNear(u.accountId, amount); } catch (e) { throw upstream(e); }
    if (!out.success) throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Top-up failed');
    await this.db.query('insert into topups (account_id, yocto, tx_hash) values ($1,$2,$3)', [u.accountId, amount.toString(), out.txHash]);
    return { account_id: u.accountId, created: true, near_balance_yocto: (bal + amount).toString(), topup_tx: out.txHash };
  }
}

export function upstream(e: unknown): ApiError {
  return new ApiError(503, 'UPSTREAM_UNAVAILABLE', e instanceof ChainTransportError ? 'NEAR network is unreachable' : 'Upstream error');
}
