/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Open your package" and "Create a package" send people (the interactive prototype). */
  readonly VITE_PROTOTYPE_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
