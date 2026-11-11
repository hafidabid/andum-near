export interface Asset {
  id: string; symbol: string; name: string; kind: 'currency' | 'gold' | 'stock'; decimals: number; bridgeable: boolean;
  faucet: { perCall: string; daily: string };
}
const U = 10n ** 6n;
const cur = (id: string, symbol: string, name: string): Asset => ({ id, symbol, name, kind: 'currency', decimals: 6, bridgeable: true, faucet: { perCall: String(10_000n * U), daily: String(100_000n * U) } });
const oth = (id: string, symbol: string, name: string, kind: 'gold' | 'stock'): Asset => ({ id, symbol, name, kind, decimals: 6, bridgeable: false, faucet: { perCall: String(100n * U), daily: String(1_000n * U) } });

/** Asset registry (ANDUM-PLAN 3.2). Addresses come from deployments/*.json, never invented here. */
export const ASSETS: Asset[] = [
  cur('usdc', 'USDC', 'US dollar stablecoin'), cur('idrx', 'IDRX', 'Indonesian rupiah'), cur('myr', 'MYR', 'Malaysian ringgit'),
  cur('sgd', 'SGD', 'Singapore dollar'), cur('thb', 'THB', 'Thai baht'), cur('eur', 'EUR', 'Euro'), cur('jpy', 'JPY', 'Japanese yen'),
  oth('xau', 'g gold', 'Tokenized gold', 'gold'), oth('aapl', 'AAPL', 'Apple Inc. stock', 'stock'),
  oth('nvda', 'NVDA', 'Nvidia stock', 'stock'), oth('tsla', 'TSLA', 'Tesla stock', 'stock'),
];
export const getAsset = (id: string) => ASSETS.find((a) => a.id === id);
/** token account id for an asset on NEAR, e.g. `usdc.andum-hack.testnet` */
export const nearTokenAccount = (assetId: string, root: string) => `${assetId}.${root}`;
export const assetIdFromTokenAccount = (account: string, root: string) =>
  account.endsWith(`.${root}`) ? account.slice(0, -root.length - 1) : null;
