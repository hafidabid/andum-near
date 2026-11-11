/** Minimal borsh writer/reader, enough for NEAR delegate actions and transactions. */
export class BorshWriter {
  private chunks: Buffer[] = [];
  u8(v: number) { this.chunks.push(Buffer.from([v & 0xff])); return this; }
  u32(v: number) { const b = Buffer.alloc(4); b.writeUInt32LE(v); this.chunks.push(b); return this; }
  u64(v: bigint | number | string) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.chunks.push(b); return this; }
  u128(v: bigint | number | string) {
    let x = BigInt(v);
    if (x < 0n || x >= 1n << 128n) throw new Error('u128 out of range');
    const b = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
    this.chunks.push(b); return this;
  }
  bytes(b: Uint8Array) { this.chunks.push(Buffer.from(b)); return this; }
  vecU8(b: Uint8Array) { this.u32(b.length); return this.bytes(b); }
  string(s: string) { return this.vecU8(Buffer.from(s, 'utf8')); }
  toBuffer(): Buffer { return Buffer.concat(this.chunks); }
}

export class BorshReader {
  private o = 0;
  constructor(private buf: Uint8Array) {}
  private need(n: number) { if (this.o + n > this.buf.length) throw new Error('borsh: unexpected end'); }
  u8() { this.need(1); return this.buf[this.o++]; }
  u32() { this.need(4); const v = Buffer.from(this.buf.subarray(this.o, this.o + 4)).readUInt32LE(); this.o += 4; return v; }
  u64(): bigint { this.need(8); const v = Buffer.from(this.buf.subarray(this.o, this.o + 8)).readBigUInt64LE(); this.o += 8; return v; }
  u128(): bigint { this.need(16); let x = 0n; for (let i = 15; i >= 0; i--) x = (x << 8n) | BigInt(this.buf[this.o + i]); this.o += 16; return x; }
  bytes(n: number) { this.need(n); const b = this.buf.subarray(this.o, this.o + n); this.o += n; return Buffer.from(b); }
  vecU8() { const n = this.u32(); if (n > 4_000_000) throw new Error('borsh: vec too large'); return this.bytes(n); }
  string() { return this.vecU8().toString('utf8'); }
  get done() { return this.o === this.buf.length; }
  get offset() { return this.o; }
}
