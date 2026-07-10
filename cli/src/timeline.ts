/**
 * Merges a run's step events, console lines, and network requests into a
 * single time-sorted view — the data `verfix show --timeline` prints, and
 * the same merged view a planned console-error-correlation analyzer needs
 * (see tracking issue). Pure function, no filesystem access, so it's cheap
 * to unit-test and reuse.
 */
import type { ExecutionEvent, ConsoleLine, NetworkRequest } from '@verfix/engine';

export type TimelineEntry =
  | ({ t: string; kind: 'step' } & ExecutionEvent)
  | ({ t: string; kind: 'console' } & ConsoleLine)
  | ({ t: string; kind: 'network' } & NetworkRequest);

export interface BuildTimelineOptions {
  /** Only keep entries within this many seconds of the last entry's timestamp. */
  lastSeconds?: number;
  /** Case-insensitive substring filter over each entry's text field (see textOf). */
  filter?: string;
}

/** The text field `--filter` matches against, consistent with --console/--network today. */
export function textOf(entry: TimelineEntry): string {
  switch (entry.kind) {
    case 'network':
      return entry.url ?? '';
    case 'console':
      return `${entry.text ?? ''} ${entry.source_url ?? ''}`;
    case 'step': {
      const meta = (entry.metadata ?? {}) as Record<string, unknown>;
      return [entry.message, meta.flow, meta.action, meta.target]
        .filter((v) => typeof v === 'string')
        .join(' ');
    }
  }
}

/**
 * Merge step events, console lines, and network requests into one
 * time-sorted array. Entries with an unparsable timestamp sort last (kept,
 * not dropped — better to surface a data-quality issue than hide it).
 */
export function buildTimeline(
  events: ExecutionEvent[] | undefined | null,
  consoleLines: ConsoleLine[] | undefined | null,
  networkRequests: NetworkRequest[] | undefined | null,
  opts: BuildTimelineOptions = {},
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...(events ?? []).map((e): TimelineEntry => ({ ...e, t: e.timestamp, kind: 'step' })),
    ...(consoleLines ?? []).map((c): TimelineEntry => ({ ...c, t: c.timestamp, kind: 'console' })),
    ...(networkRequests ?? []).map((n): TimelineEntry => ({ ...n, t: n.timestamp, kind: 'network' })),
  ];

  const timeOf = (e: TimelineEntry): number => {
    const ms = Date.parse(e.t);
    return Number.isNaN(ms) ? Infinity : ms;
  };

  entries.sort((a, b) => timeOf(a) - timeOf(b));

  let result = entries;

  if (opts.lastSeconds !== undefined && result.length > 0) {
    const finite = result.map(timeOf).filter((ms) => Number.isFinite(ms));
    if (finite.length > 0) {
      const lastMs = Math.max(...finite);
      const cutoff = lastMs - opts.lastSeconds * 1000;
      result = result.filter((e) => timeOf(e) >= cutoff);
    }
  }

  if (opts.filter) {
    const needle = opts.filter.toLowerCase();
    result = result.filter((e) => textOf(e).toLowerCase().includes(needle));
  }

  return result;
}
