/**
 * Unit tests for the failure-analyzer pipeline (workers/src/assertions/analyzers.ts)
 * and its first analyzer, stale_session (formerly appendStaleStateHint).
 *
 * The pipeline runs deterministic analyzers over evidence the run already
 * captured and emits typed findings; the top finding is also rendered into
 * fix_hint. stale_session context: when a restored `useState` session has been
 * invalidated server-side (single-use refresh token consumed, expiry,
 * server-side logout), the app silently 401s on its auth/refresh call and
 * redirects to login — surfacing as a bare selector_not_found/
 * selector_not_visible/url_mismatch/timeout with no clue the saved session was
 * the real cause. No new failure `type` is introduced (taxonomy frozen).
 *
 * Run with: ts-node test/assertions/analyzers.test.ts
 */

import assert from 'assert';
import { appendTopFinding, EvidenceBundle, runAnalyzers } from '../../src/assertions/analyzers';
import { FailureType, NetworkRequest } from '../../src/assertions/types';

function req(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    url: 'https://example.com/',
    method: 'GET',
    status: 200,
    timing_ms: 10,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function bundle(overrides: Partial<EvidenceBundle> & { failure_type: FailureType }): EvidenceBundle {
  return {
    console_logs: [],
    network_requests: [],
    ...overrides,
  };
}

const BASE_HINT = 'Selector "#dashboard" not found in DOM. Add a stable data-testid or update the selector.';

// ─── Positive case: stale/rejected restored session ─────────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    state_restored: true,
    network_requests: [
      req({ url: 'http://localhost:3000/api/auth/refresh?token=secret', method: 'POST', status: 401 }),
    ],
  }));
  assert.strictEqual(findings.length, 1, 'expected exactly one finding');
  assert.strictEqual(findings[0].code, 'stale_session');
  assert.deepStrictEqual(findings[0].evidence, {
    status: 401,
    method: 'POST',
    url: 'http://localhost:3000/api/auth/refresh',
  });

  const hint = appendTopFinding(BASE_HINT, findings);
  assert.ok(hint.startsWith(BASE_HINT), 'original hint should be preserved as a prefix');
  assert.ok(
    hint.includes('Note: a saved session state was restored for this flow and the server returned 401 on POST http://localhost:3000/api/auth/refresh'),
    `expected stale-state note in hint, got: ${hint}`,
  );
  assert.ok(hint.includes('--fresh-state'), 'hint should mention the --fresh-state escape hatch');
  assert.ok(!hint.includes('token=secret'), 'query string (and its token) must not leak into the hint');
  assert.ok(!hint.includes('?'), 'URL in hint should be truncated to origin+pathname, no query string');
  console.log('PASS: stale_session finding emitted and rendered with query string stripped');
}

// ─── Negative case: state_restored false ─────────────────────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    state_restored: false,
    network_requests: [req({ url: 'http://localhost:3000/api/auth/refresh', method: 'POST', status: 401 })],
  }));
  assert.strictEqual(findings.length, 0, 'no state restored -> no findings');
  console.log('PASS: state_restored=false yields no findings');
}

// ─── Negative case: state_restored undefined (top-level/default assertions) ──
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    network_requests: [req({ url: 'http://localhost:3000/api/auth/refresh', method: 'POST', status: 401 })],
  }));
  assert.strictEqual(findings.length, 0, 'state_restored=undefined -> no findings');
  console.log('PASS: state_restored=undefined yields no findings');
}

// ─── Negative case: no auth-ish 4xx in network log ───────────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    state_restored: true,
    network_requests: [
      req({ url: 'http://localhost:3000/api/products', method: 'GET', status: 500 }),
      req({ url: 'http://localhost:3000/api/checkout', method: 'POST', status: 403 }), // 403 but not auth-ish URL
    ],
  }));
  assert.strictEqual(findings.length, 0, 'no matching auth-ish 401/403 -> no findings');
  console.log('PASS: no auth-ish failing request yields no findings');
}

// ─── Negative case: failure type not in the eligible set ────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'text_mismatch',
    state_restored: true,
    network_requests: [req({ url: 'http://localhost:3000/api/auth/session', method: 'GET', status: 401 })],
  }));
  assert.strictEqual(findings.length, 0, 'text_mismatch failure type -> no findings');
  console.log('PASS: ineligible failure type (text_mismatch) yields no findings');
}

// ─── Positive case: 403 on a token-ish endpoint, selector_not_visible ────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_visible',
    state_restored: true,
    network_requests: [req({ url: 'https://api.example.com/oauth/token', method: 'POST', status: 403 })],
  }));
  const hint = appendTopFinding(BASE_HINT, findings);
  assert.ok(hint.includes('returned 403 on POST https://api.example.com/oauth/token'), `expected 403 oauth note, got: ${hint}`);
  console.log('PASS: 403 on oauth-ish endpoint emits finding for selector_not_visible');
}

// ─── Pipeline: empty findings leave the hint untouched ───────────────────────
{
  assert.strictEqual(appendTopFinding(BASE_HINT, []), BASE_HINT, 'no findings -> hint unchanged');
  console.log('PASS: appendTopFinding with no findings leaves hint unchanged');
}

// ─── prior_console_errors: earlier errors correlate to a later failure ───────
import { ConsoleLine } from '../../src/assertions/types';

function line(overrides: Partial<ConsoleLine>): ConsoleLine {
  return { type: 'error', text: 'boom', timestamp: new Date().toISOString(), ...overrides };
}

{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    console_logs: [
      line({ text: 'Session validation failed: TypeError: Failed to fetch', source_url: 'http://localhost:3000/app.js', line: 42 }),
      line({ type: 'warning', text: 'deprecated API' }), // warnings never count
    ],
  }));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].code, 'prior_console_errors');
  assert.strictEqual((findings[0].evidence as any).error_count, 1);
  const hint = appendTopFinding(BASE_HINT, findings);
  assert.ok(hint.includes('1 console error(s) occurred earlier in this run and may be related'), `got: ${hint}`);
  assert.ok(hint.includes('Session validation failed: TypeError: Failed to fetch'), 'first error text inlined');
  assert.ok(hint.includes('at http://localhost:3000/app.js:42'), 'source location included');
  assert.ok(hint.includes('verfix show --console'), 'points at the full log');
  console.log('PASS: prior console errors emit a correlation finding with the first error inlined');
}

// ─── prior_console_errors: user excludes are honored ────────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    console_exclude_patterns: ['Failed to fetch', '\\[invalid regex'],
    console_logs: [line({ text: 'Session validation failed: TypeError: Failed to fetch' })],
  }));
  assert.strictEqual(findings.length, 0, 'excluded error must not resurface as a finding');
  console.log('PASS: excluded console errors do not resurface (invalid patterns skipped safely)');
}

// ─── prior_console_errors: console_error failures skip the analyzer ─────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'console_error',
    console_logs: [line({ text: 'boom' })],
  }));
  assert.strictEqual(findings.length, 0, 'console_error failure -> errors are already the headline');
  console.log('PASS: console_error failure type skips prior_console_errors');
}

// ─── prior_console_errors: silent with no errors ─────────────────────────────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'timeout',
    console_logs: [line({ type: 'log', text: 'all fine' })],
  }));
  assert.strictEqual(findings.length, 0, 'no error-level lines -> no finding');
  console.log('PASS: no console errors yields no finding');
}

// ─── Ordering: stale_session outranks prior_console_errors in fix_hint ──────
{
  const findings = runAnalyzers(bundle({
    failure_type: 'selector_not_found',
    state_restored: true,
    network_requests: [req({ url: 'http://localhost:3000/api/auth/refresh', method: 'POST', status: 401 })],
    console_logs: [line({ text: 'Failed to fetch' })],
  }));
  assert.strictEqual(findings.length, 2, 'both analyzers fire');
  assert.strictEqual(findings[0].code, 'stale_session', 'root-cause analyzer ranks first');
  assert.strictEqual(findings[1].code, 'prior_console_errors');
  const hint = appendTopFinding(BASE_HINT, findings);
  assert.ok(hint.includes('saved session state'), 'fix_hint renders the top (stale_session) finding');
  console.log('PASS: stale_session outranks prior_console_errors; both present in findings[]');
}

console.log('\nAll analyzer tests passed.');
