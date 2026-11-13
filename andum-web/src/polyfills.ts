// The shared NEP-366 codec was written for Node and uses the global Buffer. Provide one that is a real Uint8Array of this realm
// (noble rejects byte arrays from another realm, which is what Node's Buffer is inside jsdom).
import { Buffer } from 'buffer'

const g = globalThis as unknown as { Buffer?: typeof Buffer }
if (typeof g.Buffer !== 'function' || !(g.Buffer.from('') instanceof Uint8Array)) g.Buffer = Buffer
