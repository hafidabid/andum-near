/** Custom link rules (ANDUM-PLAN 7.4.1). */
export const RESERVED_SLUGS = ['new','admin','api','help','app','p','assets','approve','packages','login'];
export type SlugProblem = 'SLUG_INVALID' | 'SLUG_RESERVED';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(slug: string): { ok: true } | { ok: false; reason: SlugProblem } {
  if (typeof slug !== 'string' || slug.length < 3 || slug.length > 32 || !SLUG_RE.test(slug)) return { ok: false, reason: 'SLUG_INVALID' };
  if (RESERVED_SLUGS.includes(slug) || slug.startsWith('andum')) return { ok: false, reason: 'SLUG_RESERVED' };
  return { ok: true };
}

/** Lowercase and strip illegal characters the way the web input does. */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

export function suggestSlug(slug: string, n = 2): string {
  const suffix = `-${n}`;
  return slug.slice(0, 32 - suffix.length).replace(/-+$/, '') + suffix;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
