/** NEP-297 event parsing (ANDUM-PLAN 3.6). Unknown standards and malformed lines are ignored. */
export interface ParsedEvent { standard: string; event: string; data: Record<string, unknown>; logIndex: number }
const KNOWN = new Set(['andum', 'andum-bridge', 'nep171']);

export function parseEventLogs(logs: string[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  logs.forEach((line, i) => {
    if (typeof line !== 'string' || !line.startsWith('EVENT_JSON:')) return;
    try {
      const j = JSON.parse(line.slice('EVENT_JSON:'.length));
      if (!j || typeof j.standard !== 'string' || !KNOWN.has(j.standard) || typeof j.event !== 'string' || !Array.isArray(j.data)) return;
      j.data.forEach((d: unknown, k: number) => {
        if (d && typeof d === 'object') out.push({ standard: j.standard, event: j.event, data: d as Record<string, unknown>, logIndex: i * 100 + k });
      });
    } catch { /* ignore malformed */ }
  });
  return out;
}

export function packageIdsFromEvents(events: ParsedEvent[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    const id = e.data['package_id'] ?? (e.standard === 'nep171' ? undefined : undefined);
    if (typeof id === 'string' && /^\d+$/.test(id)) ids.add(id);
    if (e.standard === 'nep171' && Array.isArray(e.data['token_ids'])) for (const t of e.data['token_ids'] as unknown[]) if (typeof t === 'string' && /^\d+$/.test(t)) ids.add(t);
  }
  return [...ids];
}
