/** The interactive prototype. Override with VITE_PROTOTYPE_URL when it moves. */
export const PROTOTYPE_URL: string =
  import.meta.env.VITE_PROTOTYPE_URL ?? 'https://claude.ai/artifact/G9gMYQZnW81AAf2bkJAs7m'

export function prototypeHref(hash: string): string {
  return `${PROTOTYPE_URL}${hash}`
}
