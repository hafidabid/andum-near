import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ed25519 } from '@noble/curves/ed25519';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { CaptureMailer, DelegateActionInput, FakeChain, PackageView, createPool, keypairFromSecret, migrate, resetAll, signDelegate, DB } from '@andum/shared';
import { createApp } from './app.module';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://andum@localhost:5544/andum_test';
export const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390';
export const ROOT = 'andum-hack.testnet';
export const CORE = `core.${ROOT}`;
export const BRIDGE = `bridge.${ROOT}`;
export const USDC = `usdc.${ROOT}`;
export const TGAS = 10n ** 12n;

export interface Kit { app: INestApplication; chain: FakeChain; mailer: CaptureMailer; http: ReturnType<typeof request>['get'] extends never ? never : any; pool: ReturnType<typeof createPool>; packages: Map<string, any>; close(): Promise<void> }

export async function startKit(envOverrides: Record<string, unknown> = {}): Promise<Kit> {
  const pool = createPool(TEST_DB, 2);
  await migrate(pool);
  await resetAll(pool);
  const chain = new FakeChain();
  const packages = new Map<string, any>();
  chain.setView(CORE, 'get_package', (a) => packages.get(String(a.package_id)) ?? null);
  const mailer = new CaptureMailer();
  const app = await createApp({
    chain, mailer,
    env: { DATABASE_URL: TEST_DB, REDIS_URL: TEST_REDIS, QUEUE_PREFIX: `t${randomBytes(4).toString('hex')}`, NEAR_ROOT: ROOT, NEAR_CORE: CORE, NEAR_BRIDGE: BRIDGE, PUBLIC_WEB_BASE: 'https://andum.test', PUBLIC_API_BASE: 'https://api.andum.test', ...envOverrides } as any,
  });
  await app.init();
  return { app, chain, mailer, http: request(app.getHttpServer()), pool, packages, close: async () => { await app.close(); await pool.end(); } };
}

export interface TestUser { sk: Uint8Array; pk: string; account: string; agent: ReturnType<typeof request.agent>; id: string }

export async function login(kit: Kit, seed = randomBytes(32)): Promise<TestUser> {
  const sk = new Uint8Array(seed);
  const kp = keypairFromSecret(sk);
  const agent = request.agent(kit.app.getHttpServer());
  const { nonce } = (await agent.get('/v1/auth/nonce')).body;
  const signature = Buffer.from(ed25519.sign(Buffer.from(`andum-login:${nonce}:${kp.accountId}`), sk)).toString('base64');
  const r = await agent.post('/v1/auth/session').send({ provider: 'local', account_id: kp.accountId, public_key: kp.publicKey, signature, nonce });
  if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.body));
  return { sk, pk: kp.publicKey, account: kp.accountId, agent, id: r.body.user_id };
}

export function delegate(u: TestUser, o: { receiver?: string; method?: string; args?: unknown; gas?: bigint; deposit?: bigint; nonce?: bigint; height?: bigint } = {}): string {
  const d: DelegateActionInput = {
    senderId: u.account, receiverId: o.receiver ?? CORE,
    actions: [{ type: 'FunctionCall', methodName: o.method ?? 'claim', args: Buffer.from(JSON.stringify(o.args ?? { package_id: '1', part_id: 0 })), gas: o.gas ?? 100n * TGAS, deposit: o.deposit ?? 0n }],
    nonce: o.nonce ?? 1n, maxBlockHeight: o.height ?? 1100n, publicKey: u.pk,
  };
  return signDelegate(d, u.sk);
}

export const sha = (b: Buffer) => createHash('sha256').update(b).digest();

export function pkgView(id: string, o: Partial<PackageView> & { invite_hash?: string | null } = {}): any {
  return {
    id, sender: 'sender.testnet', recipient: null, owner: null, invite_hash: null, status: 'FUNDED', note: 'secret note', theme: 'confetti',
    accept_by_ns: String((Date.now() + 5 * 86_400_000) * 1_000_000), created_ns: '1', accepted_ns: null,
    parts: [{ part_id: 0, token: USDC, amount: '200000000', funded: '200000000', unlock_ns: null, approvers: [], threshold: 0, approvals: [], approved: false, state: 'LOCKED', status: 'NOT_ACCEPTED', reason: 'PACKAGE_NOT_ACTIVE', taken_ns: null }],
    ...o,
  };
}
export { DB };
