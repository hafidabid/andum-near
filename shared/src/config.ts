import { z } from 'zod';

const bool = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  PUBLIC_API_BASE: z.string().default('http://localhost:8080'),
  PUBLIC_WEB_BASE: z.string().default('http://localhost:3000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgres://andum:andum@localhost:5432/andum'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(8).default('change-me-please'),
  INVITE_ENC_KEY: z.string().default(Buffer.alloc(32, 7).toString('base64')),
  NEAR_RPC_URLS: z.string().default('https://test.rpc.fastnear.com,https://rpc.testnet.near.org'),
  NEAR_ROOT: z.string().default('andum-hack.testnet'),
  NEAR_CORE: z.string().default('core.andum-hack.testnet'),
  NEAR_BRIDGE: z.string().default('bridge.andum-hack.testnet'),
  RELAYER_ACCOUNT: z.string().default('relayer.andum-hack.testnet'),
  RELAYER_PRIVATE_KEY: z.string().default(''),
  RELAYER_DAILY_BUDGET_NEAR: z.coerce.number().default(5),
  TOPUP_NEAR: z.coerce.number().default(0.02),
  TOPUP_MIN_NEAR: z.coerce.number().default(0.005),
  BOOTSTRAP_PER_DAY: z.coerce.number().default(2),
  AUTH_PROVIDER: z.string().default('email'),
  AUTH_LOCAL_ENABLED: bool.default(true),
  AUTH_EMAIL_ENABLED: bool.default(true),
  PRIVY_APP_ID: z.string().default(''),
  PRIVY_VERIFICATION_KEY: z.string().default(''),
  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_FROM: z.string().default('Andum <no-reply@example.com>'),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  USE_FAKE_CHAIN: bool.default(false),
  BRIDGE_WORKER_ACCOUNT: z.string().default('bridgeworker.andum-hack.testnet'),
  BRIDGE_WORKER_PRIVATE_KEY: z.string().default(''),
  EVM_RELAYER_PK: z.string().default(''),
  EVM_SEPOLIA_RPC: z.string().default(''),
  EVM_BASE_SEPOLIA_RPC: z.string().default(''),
  EVM_GATEWAY_SEPOLIA: z.string().default(''),
  EVM_GATEWAY_BASE_SEPOLIA: z.string().default(''),
  BRIDGE_ENABLED: bool.default(false),
  WORKER_AUTOSTART: bool.default(true),
  QUEUE_PREFIX: z.string().default('andum'),
  FAUCET_IP_PER_HOUR: z.coerce.number().default(30),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = envSchema.safeParse(source);
  if (!r.success) throw new Error('Invalid environment: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
export const NEAR_YOCTO = 10n ** 24n;
export const nearToYocto = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
export const ENV = 'ENV';
