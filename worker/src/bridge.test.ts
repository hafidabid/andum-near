import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChainTransportError, resetAll, setKill } from '@andum/shared';
import { assetIdBytes32, DepositLog } from './evm';
import { BRIDGE, USDC, WKit, startWorkerKit } from './testkit';

let kit: WKit;
beforeAll(async () => { kit = await startWorkerKit(); });
afterAll(async () => { await kit.close(); });
beforeEach(async () => {
  await resetAll(kit.pool); kit.evm.logs = []; kit.evm.released = []; kit.evm.releaseGuard.clear(); kit.evm.failRelease = 0; kit.evm.blocks = { sepolia: 100n, baseSepolia: 100n };
  kit.evm.configured = ['sepolia', 'baseSepolia']; kit.bridgeNear.submitted = []; kit.bridgeNear.onSubmit = undefined; kit.bridgeNear.transportFailures = 0;
  kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', () => []);
});

const dep = (o: Partial<DepositLog> = {}): DepositLog => ({
  chain: 'sepolia', nonce: 1n, assetId: assetIdBytes32('usdc'), from: '0xAbCdEf0123456789aBcDeF0123456789abcdef01', amount: 5_000_000n, nearAccount: 'rina.testnet',
  packageId: 0n, partId: 0, fund: false, txHash: '0xtx1', blockNumber: 99n, logIndex: 0, ...o,
});
const rows = async () => (await kit.pool.query('select * from bridge_transfers order by created_at, src_nonce')).rows;

describe('bridge: EVM -> NEAR (A-08)', () => {
  it('detects, waits for confirmations, then mints once on NEAR and ends DONE', async () => {
    kit.evm.logs = [dep({ blockNumber: 100n })];
    await kit.bridge.tick();
    let t = (await rows())[0];
    expect(t).toMatchObject({ direction: 'EVM_TO_NEAR', status: 'DETECTED', asset_id: 'usdc', near_account: 'rina.testnet', amount: '5000000', confirmations: 1 });
    expect(kit.bridgeNear.submitted).toHaveLength(0); // 1 confirmation is not enough on sepolia (needs 2)
    kit.evm.blocks.sepolia = 101n;
    await kit.bridge.tick();
    t = (await rows())[0];
    expect(t.status).toBe('DONE'); expect(t.dst_tx).toMatch(/^FAKE/);
    expect(kit.bridgeNear.submitted).toHaveLength(1);
    expect(kit.bridgeNear.submitted[0]).toMatchObject({ kind: 'call', contract: BRIDGE, method: 'bridge_in', args: { token_id: USDC, near_receiver: 'rina.testnet', amount: '5000000', src_chain: 'sepolia', src_nonce: '1', src_tx_hash: '0xtx1', fund: null } });
    await kit.bridge.tick(); await kit.bridge.tick();
    expect(kit.bridgeNear.submitted).toHaveLength(1); // nothing repeats
  });
  it('Base Sepolia needs 5 confirmations (boundary 4 vs 5)', async () => {
    kit.evm.logs = [dep({ chain: 'baseSepolia', blockNumber: 96n })];
    kit.evm.blocks.baseSepolia = 99n; // 4 confirmations
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('DETECTED');
    kit.evm.blocks.baseSepolia = 100n; // 5
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('DONE');
  });
  it('passes the fund target when the deposit asks to fund a package part (part 0 is valid)', async () => {
    kit.evm.logs = [dep({ fund: true, packageId: 7n, partId: 0 })];
    await kit.bridge.tick();
    expect(kit.bridgeNear.submitted[0].args).toMatchObject({ fund: { package_id: '7', part_id: 0 } });
  });
  it('fund flag with package id 0 is treated as a plain deposit', async () => {
    kit.evm.logs = [dep({ fund: true, packageId: 0n })];
    await kit.bridge.tick();
    expect(kit.bridgeNear.submitted[0].args).toMatchObject({ fund: null });
  });
  it('the same log seen twice (or on rescans) creates one transfer', async () => {
    kit.evm.logs = [dep(), dep()];
    await kit.bridge.tick(); await kit.bridge.scanEvm('sepolia');
    expect(await rows()).toHaveLength(1);
    expect(kit.bridgeNear.submitted).toHaveLength(1);
  });
  it('the same nonce on two chains are two transfers', async () => {
    kit.evm.logs = [dep(), dep({ chain: 'baseSepolia', txHash: '0xtx2' })];
    kit.evm.blocks.baseSepolia = 110n;
    await kit.bridge.tick();
    expect((await rows()).filter((r) => r.status === 'DONE')).toHaveLength(2);
  });
  it('a log that disappears before confirmation (reorg) FAILS as REORGED and nothing is sent', async () => {
    kit.evm.logs = [dep({ blockNumber: 100n })];
    await kit.bridge.tick();
    kit.evm.logs = []; kit.evm.blocks.sepolia = 110n; // reorged out
    await kit.bridge.tick();
    expect((await rows())[0]).toMatchObject({ status: 'FAILED', error: 'REORGED' });
    expect(kit.bridgeNear.submitted).toHaveLength(0);
  });
  it('a malformed NEAR account or unknown asset fails fast and is never sent', async () => {
    kit.evm.logs = [dep({ nonce: 1n, nearAccount: 'NOT VALID!!' }), dep({ nonce: 2n, assetId: assetIdBytes32('xau'), txHash: '0xtx2' }), dep({ nonce: 3n, nearAccount: '', txHash: '0xtx3' })];
    await kit.bridge.tick();
    expect((await rows()).map((r) => [r.status, r.error])).toEqual([['FAILED', 'BAD_NEAR_ACCOUNT'], ['FAILED', 'UNKNOWN_ASSET'], ['FAILED', 'BAD_NEAR_ACCOUNT']]);
    expect(kit.bridgeNear.submitted).toHaveLength(0);
  });
  it('a NEAR-side refusal marks FAILED with the contract code', async () => {
    kit.evm.logs = [dep()];
    kit.bridgeNear.onSubmit = () => ({ success: false, failure: 'ANDUM_ERR:BRIDGE_ASSET_DISABLED' });
    await kit.bridge.tick();
    expect((await rows())[0]).toMatchObject({ status: 'FAILED', error: 'BRIDGE_ASSET_DISABLED' });
  });
  it('a NEAR outage leaves it SUBMITTED and the next tick finishes it (bridge_in is idempotent on chain)', async () => {
    kit.evm.logs = [dep()];
    const orig = kit.bridgeNear.callAsRelayer.bind(kit.bridgeNear);
    kit.bridgeNear.callAsRelayer = async () => { kit.bridgeNear.callAsRelayer = orig; throw new ChainTransportError('near down'); };
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('SUBMITTED');
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('DONE');
  });
  it('survives a restart: a fresh worker on the same database does not repeat finished transfers and resumes the cursor', async () => {
    kit.evm.logs = [dep()];
    await kit.bridge.tick();
    const again = await startWorkerKitSharedDb();
    try {
      again.evm.logs = kit.evm.logs; again.evm.blocks = { ...kit.evm.blocks };
      await again.bridge.tick();
      expect(again.bridgeNear.submitted).toHaveLength(0);
      expect((await rows())).toHaveLength(1);
    } finally { await again.app.close(); await again.pool.end(); }
  });
  it('scans large ranges in spans and stores the cursor', async () => {
    kit.bridge.scanSpan = 10n; kit.bridge.startLookback = 100n;
    kit.evm.blocks.sepolia = 100n;
    kit.evm.logs = [dep({ nonce: 1n, blockNumber: 5n, txHash: '0xa' }), dep({ nonce: 2n, blockNumber: 55n, txHash: '0xb' }), dep({ nonce: 3n, blockNumber: 95n, txHash: '0xc' })];
    await kit.bridge.scanEvm('sepolia');
    expect(await rows()).toHaveLength(3);
    expect((await kit.pool.query(`select value from worker_state where key='evm_cursor:sepolia'`)).rows[0].value).toBe('100');
    kit.bridge.scanSpan = 1000n; kit.bridge.startLookback = 50n;
  });
  it('first run only looks a little way back', async () => {
    kit.evm.logs = [dep({ blockNumber: 3n, txHash: '0xold' })]; // far older than the lookback window
    await kit.bridge.scanEvm('sepolia');
    expect(await rows()).toHaveLength(0);
  });
  it('the bridge kill switch pauses the worker', async () => {
    kit.evm.logs = [dep()];
    await setKill(kit.pool, 'bridge', true);
    expect(await kit.bridge.tick()).toEqual({ skipped: true });
    expect(await rows()).toHaveLength(0);
    await setKill(kit.pool, 'bridge', false);
    await kit.bridge.tick();
    expect(await rows()).toHaveLength(1);
  });
  it('an RPC failure on one chain does not stop the other', async () => {
    kit.evm.logs = [dep({ chain: 'baseSepolia', txHash: '0xb', blockNumber: 99n })];
    kit.evm.blocks.baseSepolia = 120n;
    const orig = kit.evm.latestBlock.bind(kit.evm);
    kit.evm.latestBlock = async (c) => { if (c === 'sepolia') throw new Error('rpc down'); return orig(c); };
    await kit.bridge.tick();
    kit.evm.latestBlock = orig;
    expect((await rows())[0]).toMatchObject({ evm_chain: 'baseSepolia' });
  });
});

describe('bridge: NEAR -> EVM', () => {
  const out = (nonce: number, o: Record<string, unknown> = {}) => ({ nonce: String(nonce), token_id: USDC, from: 'rina.testnet', dest_chain: 'baseSepolia', dest_address: '0x1234567890123456789012345678901234567890', amount: '2500000', ts: 1, ...o });
  it('releases on the EVM chain exactly once per NEAR nonce and ends DONE', async () => {
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1)] : []));
    await kit.bridge.tick(); await kit.bridge.tick(); await kit.bridge.tick();
    expect(kit.evm.released).toHaveLength(1);
    expect(kit.evm.released[0]).toMatchObject({ chain: 'baseSepolia', nonce: 1n, to: '0x1234567890123456789012345678901234567890', amount: 2_500_000n, assetId: assetIdBytes32('usdc') });
    const t = (await rows())[0];
    expect(t).toMatchObject({ direction: 'NEAR_TO_EVM', status: 'DONE', near_account: 'rina.testnet', evm_chain: 'baseSepolia' });
    expect((await kit.pool.query(`select value from worker_state where key='near_out_next'`)).rows[0].value).toBe('2');
  });
  it('processes several outbound transfers in order across pages', async () => {
    const all = Array.from({ length: 60 }, (_, i) => out(i + 1, { dest_chain: i % 2 ? 'sepolia' : 'baseSepolia' }));
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => all.filter((o) => BigInt(o.nonce) >= BigInt(a.from as string)).slice(0, Number(a.limit)));
    await kit.bridge.tick();
    expect(kit.evm.released).toHaveLength(50); // advance() handles 50 a tick
    await kit.bridge.tick();
    expect(kit.evm.released).toHaveLength(60);
    expect(new Set(kit.evm.released.map((r) => `${r.chain}:${r.nonce}`)).size).toBe(60);
  });
  it('an already released nonce (gateway replay guard) counts as DONE, not an error', async () => {
    kit.evm.releaseGuard.add('baseSepolia:1');
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1)] : []));
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('DONE');
    expect(kit.evm.released).toHaveLength(0);
  });
  it('an EVM outage leaves it SUBMITTED with the error recorded, and the next tick completes it', async () => {
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1)] : []));
    kit.evm.failRelease = 1;
    await kit.bridge.tick();
    expect((await rows())[0]).toMatchObject({ status: 'SUBMITTED', error: 'rpc down' });
    await kit.bridge.tick();
    expect((await rows())[0].status).toBe('DONE');
    expect(kit.evm.released).toHaveLength(1);
  });
  it('an unknown token on NEAR is recorded as FAILED and never released', async () => {
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1, { token_id: 'weird.other.testnet' })] : []));
    await kit.bridge.tick();
    expect((await rows())[0]).toMatchObject({ status: 'FAILED', error: 'UNKNOWN_ASSET' });
    expect(kit.evm.released).toHaveLength(0);
  });
  it('a restart does not release again', async () => {
    kit.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1)] : []));
    await kit.bridge.tick();
    const again = await startWorkerKitSharedDb();
    try {
      again.bridgeNear.setView(BRIDGE, 'get_outbound_range', (a) => (BigInt(a.from as string) <= 1n ? [out(1)] : []));
      again.evm.releaseGuard = kit.evm.releaseGuard;
      await again.bridge.tick();
      expect(again.evm.released).toHaveLength(0);
    } finally { await again.app.close(); await again.pool.end(); }
  });
  it('a view failure on NEAR does not crash the tick', async () => {
    kit.bridgeNear.transportFailures = 1;
    await expect(kit.bridge.tick()).resolves.toEqual({ skipped: false });
  });
});

/** a second worker on the same database, to simulate a restart */
async function startWorkerKitSharedDb() {
  const { createWorker, BridgeWorker } = await import('./worker.module');
  const { FakeChain, createPool } = await import('@andum/shared');
  const { FakeEvm, TEST_DB, TEST_REDIS, ROOT, CORE } = await import('./testkit');
  const pool = createPool(TEST_DB, 2); const bridgeNear = new FakeChain(); const evm = new FakeEvm();
  const app = await createWorker({ chain: new FakeChain(), bridgeNear, evm, env: { DATABASE_URL: TEST_DB, REDIS_URL: TEST_REDIS, NEAR_ROOT: ROOT, NEAR_CORE: CORE, NEAR_BRIDGE: BRIDGE, WORKER_AUTOSTART: false } as any });
  bridgeNear.setView(BRIDGE, 'get_outbound_range', () => []);
  return { app, pool, bridgeNear, evm, bridge: app.get(BridgeWorker) };
}
