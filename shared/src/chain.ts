import bs58 from 'bs58';
import { buildRelayTransaction, buildTransaction, DecodedDelegate, decodeSignedDelegate, keypairFromSecret, parseSecretKey } from './near-tx';
import { parseChainError } from './errors';

export interface TxOutcome {
  txHash: string;
  success: boolean;
  /** raw failure text from the chain (contains ANDUM_ERR:CODE for contract failures) */
  failure?: string;
  logs: string[];
}

/** Thrown for network/RPC problems. Callers may retry these; contract failures are never thrown. */
export class ChainTransportError extends Error {}

export interface ChainClient {
  viewFunction<T = unknown>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  getBlockHeight(): Promise<bigint>;
  getChainTimeNs(): Promise<bigint>;
  /** null when the account does not have this key */
  getAccessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null>;
  /** 0n when the account does not exist */
  getBalanceYocto(accountId: string): Promise<bigint>;
  /** wrap a user's signed delegate action in a relayer-signed transaction and wait for the final outcome */
  submitDelegate(signedDelegateB64: string): Promise<TxOutcome>;
  transferNear(toAccountId: string, yocto: bigint): Promise<TxOutcome>;
  /** function call signed by the relayer account itself (e.g. ft_mint for the faucet) */
  callAsRelayer(contractId: string, method: string, args: Record<string, unknown>, gas: bigint, deposit: bigint): Promise<TxOutcome>;
  relayerBalanceYocto(): Promise<bigint>;
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';

// ----------------------------------------------------------------------------- real JSON-RPC client
export interface NearRpcOptions { rpcUrls: string[]; relayerAccount: string; relayerSecretKey: string; fetchImpl?: typeof fetch }

/**
 * NEAR JSON-RPC client. Hand-rolled to keep the relayer's surface small. [VERIFY] on testnet (S-01, S-04).
 * Serialises submissions so the relayer key nonce stays monotonic.
 */
export class NearRpcChain implements ChainClient {
  private nonce: bigint | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly secret: Uint8Array;
  private readonly pub: string;
  private readonly f: typeof fetch;
  constructor(private o: NearRpcOptions) {
    this.secret = parseSecretKey(o.relayerSecretKey);
    this.pub = keypairFromSecret(this.secret).publicKey;
    this.f = o.fetchImpl ?? fetch;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    let lastErr: unknown;
    for (const url of this.o.rpcUrls) {
      try {
        const res = await this.f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'andum', method, params }), signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j: any = await res.json();
        if (j.error) {
          const msg = JSON.stringify(j.error);
          if (/UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|does not exist/.test(msg)) { const e: any = new Error(msg); e.unknown = true; throw e; }
          if (/InvalidNonce/.test(msg)) { const e: any = new Error(msg); e.invalidNonce = true; throw e; }
          throw Object.assign(new Error(msg), { rpcError: true });
        }
        return j.result as T;
      } catch (e: any) {
        if (e.unknown || e.invalidNonce) throw e;
        lastErr = e;
      }
    }
    throw new ChainTransportError(`NEAR RPC failed: ${(lastErr as Error)?.message ?? 'unknown'}`);
  }

  async viewFunction<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(r.result).toString('utf8')) as T;
  }
  async getBlockHeight() { return BigInt((await this.rpc<any>('block', { finality: 'final' })).header.height); }
  async getChainTimeNs() { return BigInt((await this.rpc<any>('block', { finality: 'final' })).header.timestamp_nanosec); }
  async getAccessKeyNonce(accountId: string, publicKey: string) {
    try { return BigInt((await this.rpc<any>('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey })).nonce); }
    catch (e: any) { if (e.unknown) return null; throw e; }
  }
  async getBalanceYocto(accountId: string) {
    try { return BigInt((await this.rpc<any>('query', { request_type: 'view_account', finality: 'final', account_id: accountId })).amount); }
    catch (e: any) { if (e.unknown) return 0n; throw e; }
  }
  relayerBalanceYocto() { return this.getBalanceYocto(this.o.relayerAccount); }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async broadcast(build: (nonce: bigint, blockHash: string) => { base64: string; hash: string }): Promise<TxOutcome> {
    return this.serial(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (this.nonce === null) this.nonce = (await this.getAccessKeyNonce(this.o.relayerAccount, this.pub)) ?? 0n;
        const blockHash = (await this.rpc<any>('block', { finality: 'final' })).header.hash as string;
        const nonce = this.nonce + 1n;
        const { base64, hash } = build(nonce, blockHash);
        try {
          const res = await this.rpc<any>('send_tx', { signed_tx_base64: base64, wait_until: 'FINAL' });
          this.nonce = nonce;
          return outcomeFromRpc(hash, res);
        } catch (e: any) {
          if (e.invalidNonce && attempt === 0) { this.nonce = null; continue; }
          throw e;
        }
      }
      throw new ChainTransportError('could not obtain a valid relayer nonce');
    });
  }

  submitDelegate(signedDelegateB64: string): Promise<TxOutcome> {
    const d: DecodedDelegate = decodeSignedDelegate(signedDelegateB64);
    return this.broadcast((nonce, blockHash) => buildRelayTransaction({ relayerId: this.o.relayerAccount, relayerPublicKey: this.pub, relayerSecretKey: this.secret, nonce, blockHash, receiverId: d.senderId, signedDelegateB64 }));
  }
  transferNear(to: string, yocto: bigint) {
    return this.broadcast((nonce, blockHash) => buildTransaction({ signerId: this.o.relayerAccount, signerPublicKey: this.pub, signerSecretKey: this.secret, nonce, blockHash, receiverId: to, action: { type: 'Transfer', deposit: yocto } }));
  }
  callAsRelayer(contractId: string, method: string, args: Record<string, unknown>, gas: bigint, deposit: bigint) {
    return this.broadcast((nonce, blockHash) => buildTransaction({ signerId: this.o.relayerAccount, signerPublicKey: this.pub, signerSecretKey: this.secret, nonce, blockHash, receiverId: contractId, action: { type: 'FunctionCall', methodName: method, args: Buffer.from(JSON.stringify(args)), gas, deposit } }));
  }
}

export function outcomeFromRpc(txHash: string, res: any): TxOutcome {
  const logs: string[] = [];
  let failure: string | undefined;
  const status = res?.status;
  for (const ro of res?.receipts_outcome ?? []) {
    for (const l of ro?.outcome?.logs ?? []) logs.push(l);
    const st = ro?.outcome?.status;
    if (st && typeof st === 'object' && 'Failure' in st && !failure) failure = JSON.stringify(st.Failure);
  }
  if (status && typeof status === 'object' && 'Failure' in status && !failure) failure = JSON.stringify(status.Failure);
  const txFail = res?.transaction_outcome?.outcome?.status;
  if (txFail && typeof txFail === 'object' && 'Failure' in txFail && !failure) failure = JSON.stringify(txFail.Failure);
  return { txHash, success: !failure, failure, logs };
}

// ----------------------------------------------------------------------------- in-memory fake (tests, local demos)
export interface FakeSubmitCall { kind: 'delegate' | 'transfer' | 'call'; delegate?: DecodedDelegate; to?: string; yocto?: bigint; contract?: string; method?: string; args?: Record<string, unknown> }

export class FakeChain implements ChainClient {
  blockHeight = 1_000n;
  chainTimeNs = BigInt(Date.now()) * 1_000_000n;
  balances = new Map<string, bigint>();
  keyNonces = new Map<string, bigint>(); // `${account}|${pk}`
  views = new Map<string, (args: Record<string, unknown>) => unknown>(); // `${contract}.${method}`
  submitted: FakeSubmitCall[] = [];
  relayerBalance = 50n * 10n ** 24n;
  /** override the outcome of the next submissions */
  onSubmit?: (c: FakeSubmitCall) => Partial<TxOutcome> | undefined;
  transportFailures = 0;
  private counter = 0;

  setView(contract: string, method: string, fn: (args: Record<string, unknown>) => unknown) { this.views.set(`${contract}.${method}`, fn); }
  setKeyNonce(account: string, pk: string, nonce: bigint) { this.keyNonces.set(`${account}|${pk}`, nonce); }

  private maybeFail() { if (this.transportFailures > 0) { this.transportFailures--; throw new ChainTransportError('fake transport failure'); } }

  async viewFunction<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    this.maybeFail();
    const fn = this.views.get(`${contractId}.${method}`);
    if (!fn) throw new Error(`no fake view for ${contractId}.${method}`);
    return fn(args) as T;
  }
  async getBlockHeight() { this.maybeFail(); return this.blockHeight; }
  async getChainTimeNs() { return this.chainTimeNs; }
  async getAccessKeyNonce(a: string, pk: string) { this.maybeFail(); return this.keyNonces.get(`${a}|${pk}`) ?? null; }
  async getBalanceYocto(a: string) { return this.balances.get(a) ?? 0n; }
  async relayerBalanceYocto() { return this.relayerBalance; }

  private outcome(call: FakeSubmitCall): TxOutcome {
    this.maybeFail();
    this.submitted.push(call);
    const o = this.onSubmit?.(call);
    return { txHash: `FAKE${String(++this.counter).padStart(8, '0')}`, success: true, logs: [], ...(o ?? {}) };
  }
  async submitDelegate(b64: string) {
    const d = decodeSignedDelegate(b64);
    const out = this.outcome({ kind: 'delegate', delegate: d });
    if (out.success) this.keyNonces.set(`${d.senderId}|${d.publicKey}`, d.nonce);
    return out;
  }
  async transferNear(to: string, yocto: bigint) {
    const out = this.outcome({ kind: 'transfer', to, yocto });
    if (out.success) this.balances.set(to, (this.balances.get(to) ?? 0n) + yocto);
    return out;
  }
  async callAsRelayer(contract: string, method: string, args: Record<string, unknown>) { return this.outcome({ kind: 'call', contract, method, args }); }
}

/** helper for services: map a failed outcome to its ANDUM code */
export const outcomeErrorCode = (o: TxOutcome) => parseChainError(o.failure);
export { bs58 };
