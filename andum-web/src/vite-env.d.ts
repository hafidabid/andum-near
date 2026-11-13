/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Andum API (backend/). */
  readonly VITE_API_BASE?: string
  /** NEAR JSON-RPC endpoints, comma separated. */
  readonly VITE_NEAR_RPC?: string
  readonly VITE_NEAR_ROOT?: string
  readonly VITE_NEAR_CORE?: string
  readonly VITE_EXPLORER?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
