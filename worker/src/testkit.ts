import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { CaptureMailer, DB, DelegateActionInput, FakeChain, createPool, keypairFromSecret, migrate, resetAll, signDelegate, sha256, upsertPackage } from '@andum/shared';
import { createWorker, BridgeWorker, Notifier, Reconciler, RelayService } from './worker.module';
import { DepositLog, EvmChain, EvmSource } from './evm';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://andum@localhost:5544/andum_test';
export const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390';
export const ROOT = 'andum-hack.testnet';
export const CORE = `core.${ROOT}`;
export const BRIDGE = `bridge.${ROOT}`;
export const USDC = `usdc.${ROOT}`;
export const TGAS = 10n ** 12n;

export class FakeEvm implements EvmSource {
  blocks: Record<string, bigint> = { sepolia: 100n, baseSepolia: 100n };
  logs: DepositLog[] = [];
  released: { chain: EvmChain; nonce: bigint; to: string; amount: bigint; assetId: string }[] = [];
  releaseGuard = new Set<string>();
  failRelease = 0;
  configured: EvmChain[] = ['sepolia', 'baseSepolia'];
  chains() { return this.configured; }
  async latestBlock(c: EvmChain) { return this.blocks[c]; }
  async getDepositLogs(c: EvmChain, from: bigint, to: bigint) { return this.logs.filter((l) => l.chain === c && l.blockNumber >= from && l.blockNumber <= to); }
  async depositStillExists(c: EvmChain, d: { txHash: string; nonce: bigint }) { return this.logs.some((l) => l.chain === c && l.nonce === d.nonce && l.txHash === d.txHash); }
  async release(c: EvmChain, a: { assetId: string; to: string; amount: bigint; nonce: bigint; nearTxHash: string }) {
    if (this.failRelease > 0) { this.failRelease--; throw new Error('rpc down'); }
    const key = `${c}:${a.nonce}`;
    if (this.releaseGuard.has(key)) return { txHash: '', alreadyReleased: true };
    this.releaseGuard.add(key);
    this.released.push({ chain: c, nonce: a.nonce, to: a.to, amount: a.amount, assetId: a.assetId });
    return { txHash: `0xrelease${this.released.length}`, alreadyReleased: false };
  }
}

export interface WKit {
  app: INestApplicationContext; chain: FakeChain; bridgeNear: FakeChain; mailer: CaptureMailer; evm: FakeEvm; pool: Pool; packages: Map<string, any>;
  relay: RelayService; reconciler: Reconciler; notifier: Notifier; bridge: BridgeWorker; close(): Promise<void>;
}

export async function startWorkerKit(envOverrides: Record<string, unknown> = {}): Promise<WKit> {
  const pool = createPool(TEST_DB, 2);
  await migrate(pool); await resetAll(pool);
  const chain = new FakeChain(); const bridgeNear = new FakeChain();
  const packages = new Map<string, any>();
  chain.setView(CORE, 'get_package', (a) => packages.get(String(a.package_id)) ?? null);
  const mailer = new CaptureMailer(); const evm = new FakeEvm();
  const app = await createWorker({
    chain, bridgeNear, mailer, evm,
    env: { DATABASE_URL: TEST_DB, REDIS_URL: TEST_REDIS, QUEUE_PREFIX: `w${randomBytes(4).toString('hex')}`, NEAR_ROOT: ROOT, NEAR_CORE: CORE, NEAR_BRIDGE: BRIDGE, PUBLIC_WEB_BASE: 'https://andum.test', WORKER_AUTOSTART: false, BRIDGE_ENABLED: false, ...envOverrides } as any,
  });
  const relay = app.get(RelayService); relay.retryDelaysMs = [0, 0, 0];
  return { app, chain, bridgeNear, mailer, evm, pool, packages, relay, reconciler: app.get(Reconciler), notifier: app.get(Notifier), bridge: app.get(BridgeWorker), close: async () => { await app.close(); await pool.end(); } };
}

export function pkgView(id: string, o: Record<string, unknown> = {}): any {
  return {
    id, sender: 'sender.testnet', recipient: null, owner: null, invite_hash: null, status: 'FUNDED', note: null, theme: 'none',
    accept_by_ns: String((Date.now() + 5 * 86_400_000) * 1_000_000), created_ns: '1', accepted_ns: null,
    parts: [{ part_id: 0, token: USDC, amount: '100', funded: '100', unlock_ns: null, approvers: [], threshold: 0, approvals: [], approved: false, state: 'LOCKED', status: 'NOT_ACCEPTED', reason: 'PACKAGE_NOT_ACTIVE', taken_ns: null }],
    ...o,
  };
}
export const part = (o: Record<string, unknown> = {}) => ({ ...pkgView('x').parts[0], ...o });
export const ev = (event: string, data: Record<string, unknown>, standard = 'andum') => 'EVENT_JSON:' + JSON.stringify({ standard, version: '1.0.0', event, data: [data] });

/** make a user row + a QUEUED relay job holding a really signed delegate action */
export async function queuedJob(kit: WKit, o: { method?: string; args?: unknown; gas?: bigint; height?: bigint; nonce?: bigint; receiver?: string; seed?: Buffer; clientId?: string } = {}) {
  const sk = new Uint8Array(o.seed ?? randomBytes(32)); const kp = keypairFromSecret(sk);
  await kit.pool.query(`insert into users (auth_provider, auth_subject, near_account_id, public_key) values ('local',$1,$1,$2) on conflict do nothing`, [kp.accountId, kp.publicKey]);
  const d: DelegateActionInput = {
    senderId: kp.accountId, receiverId: o.receiver ?? CORE,
    actions: [{ type: 'FunctionCall', methodName: o.method ?? 'claim', args: Buffer.from(JSON.stringify(o.args ?? { package_id: '1', part_id: 0 })), gas: o.gas ?? 100n * TGAS, deposit: 0n }],
    nonce: o.nonce ?? 1n, maxBlockHeight: o.height ?? 1100n, publicKey: kp.publicKey,
  };
  const b64 = signDelegate(d, sk);
  const r = await kit.pool.query(
    `insert into relay_jobs (client_request_id, account_id, receiver_id, method, payload_hash, signed_delegate_b64) values ($1,$2,$3,$4,$5,$6) returning id`,
    [o.clientId ?? randomBytes(4).toString('hex'), kp.accountId, d.receiverId, d.actions[0].methodName, sha256(Buffer.from(b64, 'base64')), b64]);
  return { id: r.rows[0].id as string, account: kp.accountId, pk: kp.publicKey, b64 };
}
export const jobRow = async (kit: WKit, id: string) => (await kit.pool.query('select * from relay_jobs where id=$1', [id])).rows[0];
export { DB, upsertPackage };
