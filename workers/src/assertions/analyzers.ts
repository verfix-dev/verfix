import { AssertionDefinition, ConsoleLine, FailureType, NetworkRequest } from './types';

// ─── Failure-analyzer pipeline ────────────────────────────────────────────────
// Deterministic post-failure synthesis: each analyzer is a pure function over
// evidence the run already captured, emitting a typed Finding when — and only
// when — the evidence clearly supports one. Precision over recall: an analyzer
// that isn't sure stays silent; a wrong confident hint is worse than no hint.
// No LLM calls belong anywhere in this pipeline.
//
// Finding `code` values are a governed vocabulary like the failure taxonomy:
// new codes need a GitHub Discussion first.

export interface Finding {
  /** Stable machine-readable cause code (e.g. 'stale_session'). */
  code: string;
  /** One sentence naming the concrete evidence, in hypothesis language. */
  summary: string;
  /** The specific captured data that triggered the finding. */
  evidence: Record<string, unknown>;
  /** Concrete next action, when one clearly follows. */
  suggestion?: string;
}

/** Everything an analyzer may look at. Assembled once per failed assertion. */
export interface EvidenceBundle {
  failure_type: FailureType;
  assertion?: AssertionDefinition;
  error?: string;
  details?: Record<string, unknown>;
  /** Whether this flow restored a saved storage state (useState). */
  state_restored?: boolean;
  /** The page URL at assertion time — used to tell first- from third-party sources. */
  page_url?: string;
  /**
   * Job-wide `exclude` patterns from every no_console_errors assertion —
   * errors the user explicitly excluded must not resurface as findings.
   */
  console_exclude_patterns?: string[];
  console_logs: ConsoleLine[];
  network_requests: NetworkRequest[];
}

export interface Analyzer {
  code: string;
  analyze(bundle: EvidenceBundle): Finding | null;
}

// ─── First-party vs third-party sources ──────────────────────────────────────
// Multi-service apps log errors from their own API on a different port
// (localhost:3000 page, localhost:3611 API) or a sibling subdomain
// (app.example.com page, api.example.com API) — none of that is "third-party".
// Third-party means a genuinely different site (CDN, analytics, vendor widget).

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)$/;

// ponytail: last-two-labels heuristic for the registrable domain — misgroups
// multi-part public suffixes (foo.co.uk vs bar.co.uk). Upgrade to a public
// suffix list if that ceiling is ever hit.
function siteOf(hostname: string): string {
  const labels = hostname.split('.');
  return labels.length <= 2 ? hostname : labels.slice(-2).join('.');
}

/**
 * True only when the source is a genuinely different site from the page.
 * Ports are ignored, loopback hosts are all one local stack, and subdomains
 * of the same registrable domain are first-party. Unknown/unparsable inputs
 * are never claimed to be third-party.
 */
export function isThirdPartySource(pageUrl: string | undefined, sourceUrl: string | undefined): boolean {
  if (!pageUrl || !sourceUrl) return false;
  const page = hostnameOf(pageUrl);
  const source = hostnameOf(sourceUrl);
  if (!page || !source) return false;
  if (page === source) return false;
  if (LOOPBACK.test(page) && LOOPBACK.test(source)) return false;
  return siteOf(page) !== siteOf(source);
}

// Failure types where a silent 401/403 redirect-to-login is a plausible root
// cause — a stale/rejected restored session, not the assertion itself.
const STALE_STATE_FAILURE_TYPES: ReadonlySet<FailureType> = new Set([
  'selector_not_found',
  'selector_not_visible',
  'url_mismatch',
  'timeout',
]);

const AUTH_URL_REGEX = /(auth|token|refresh|session|login|oauth|signin)/i;

// Drops the query string — tokens live there, and findings end up in logs.
function truncateToPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

// When a restored useState session has been invalidated server-side (single-use
// refresh token consumed, expiry, server-side logout), the app silently 401s on
// its auth/refresh call and redirects to login — surfacing as a generic
// selector/url/timeout failure with no hint of the real cause.
const staleSessionAnalyzer: Analyzer = {
  code: 'stale_session',
  analyze(bundle) {
    if (!bundle.state_restored || !STALE_STATE_FAILURE_TYPES.has(bundle.failure_type)) return null;

    const staleRequest = bundle.network_requests.find(
      (r) => (r.status === 401 || r.status === 403) && AUTH_URL_REGEX.test(r.url),
    );
    if (!staleRequest) return null;

    const path = truncateToPath(staleRequest.url);
    return {
      code: 'stale_session',
      summary: `a saved session state was restored for this flow and the server returned ${staleRequest.status} on ${staleRequest.method} ${path} — the saved state may be stale or single-use.`,
      evidence: { status: staleRequest.status, method: staleRequest.method, url: path },
      suggestion: 'Re-run the flow that saves it, or run with --fresh-state.',
    };
  },
};

// Console errors plausibly explain missing/broken UI; for other failure
// classes the correlation is noise, not signal (a network_failure already
// names its own cause).
const CONSOLE_CORRELATION_FAILURE_TYPES: ReadonlySet<FailureType> = new Set([
  'selector_not_found',
  'selector_not_visible',
  'text_mismatch',
  'url_mismatch',
  'timeout',
]);

// Console errors are captured per-run but were treated as independent events —
// nothing connected "an anomalous fetch failure early in the run" to "a missing
// button late in the run". If non-excluded console errors preceded this
// failure, surface the correlation instead of leaving it to the human.
const priorConsoleErrorsAnalyzer: Analyzer = {
  code: 'prior_console_errors',
  analyze(bundle) {
    // Gated to UI-shaped failures; console_error failures are already the headline.
    if (!CONSOLE_CORRELATION_FAILURE_TYPES.has(bundle.failure_type)) return null;

    const patterns: RegExp[] = [];
    for (const p of bundle.console_exclude_patterns ?? []) {
      try {
        patterns.push(new RegExp(p));
      } catch {
        // Invalid pattern already surfaces as a no_console_errors failure.
      }
    }
    const errors = bundle.console_logs
      .filter((l) => l.type === 'error' && !patterns.some((rx) => rx.test(l.text)))
      .map((l) => ({ ...l, third_party: isThirdPartySource(bundle.page_url, l.source_url) }));
    if (errors.length === 0) return null;

    // Inline the strongest evidence: the first first-party error when one
    // exists; a vendor-script error is a much weaker hypothesis.
    const firstParty = errors.filter((e) => !e.third_party);
    const allThirdParty = firstParty.length === 0;
    const first = firstParty[0] ?? errors[0];
    const location = first.source_url ? ` (at ${first.source_url}${first.line ? ':' + first.line : ''})` : '';
    const summary = allThirdParty
      ? `${errors.length} console error(s) from third-party scripts occurred earlier in this run — likely unrelated to your app code, but noted. First: "${first.text.slice(0, 200)}"${location}.`
      : `${errors.length} console error(s) occurred earlier in this run and may be related. First: "${first.text.slice(0, 200)}"${location}.`;
    return {
      code: 'prior_console_errors',
      summary,
      evidence: {
        error_count: errors.length,
        third_party_count: errors.length - firstParty.length,
        first_error: {
          text: first.text,
          timestamp: first.timestamp,
          source_url: first.source_url,
          third_party: first.third_party,
        },
      },
      suggestion: 'Inspect the full log with: verfix show --console (or --timeline to see ordering around the failure).',
    };
  },
};

// Priority order: the first finding is also rendered into fix_hint.
// stale_session first — it names a root cause; prior_console_errors is a
// broader correlation.
const ANALYZERS: Analyzer[] = [staleSessionAnalyzer, priorConsoleErrorsAnalyzer];

const MAX_FINDINGS = 3;

export function runAnalyzers(bundle: EvidenceBundle): Finding[] {
  const findings: Finding[] = [];
  for (const analyzer of ANALYZERS) {
    if (findings.length >= MAX_FINDINGS) break;
    try {
      const finding = analyzer.analyze(bundle);
      if (finding) findings.push(finding);
    } catch (e: any) {
      // An analyzer bug must never fail a run — the run's own result is the product.
      console.warn(`Analyzer "${analyzer.code}" threw and was skipped: ${e?.message || e}`);
    }
  }
  return findings;
}

/** Renders the top finding into the human/agent-readable hint prose. */
export function appendTopFinding(hint: string, findings: Finding[]): string {
  if (findings.length === 0) return hint;
  const top = findings[0];
  return `${hint} Note: ${top.summary}${top.suggestion ? ` ${top.suggestion}` : ''}`;
}
