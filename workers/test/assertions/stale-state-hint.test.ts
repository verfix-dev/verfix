/**
 * Unit tests for appendStaleStateHint (workers/src/assertions/failure-hints.ts).
 *
 * Context: when a restored `useState` session has been invalidated
 * server-side (single-use refresh token consumed, expiry, server-side
 * logout), the app silently 401s on its auth/refresh call and redirects to
 * login — surfacing as a bare selector_not_found/selector_not_visible/
 * url_mismatch/timeout with no clue the saved session was the real cause.
 * This helper appends a deterministic note to the fix_hint when that pattern
 * is detected, without introducing a new failure `type` (taxonomy frozen).
 *
 * Run with: ts-node test/assertions/stale-state-hint.test.ts
 */

import assert from 'assert';
import { appendStaleStateHint } from '../../src/assertions/failure-hints';
import { NetworkRequest } from '../../src/assertions/types';

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

const BASE_HINT = 'Selector "#dashboard" not found in DOM. Add a stable data-testid or update the selector.';

// ─── Positive case: stale/rejected restored session ─────────────────────────
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'http://localhost:3000/api/auth/refresh?token=secret', method: 'POST', status: 401 }),
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'selector_not_found', true, networkRequests);

  assert.ok(hint.startsWith(BASE_HINT), 'original hint should be preserved as a prefix');
  assert.ok(
    hint.includes('a saved session state was restored for this flow and the server returned 401 on POST http://localhost:3000/api/auth/refresh'),
    `expected stale-state note in hint, got: ${hint}`,
  );
  assert.ok(hint.includes('--fresh-state'), 'hint should mention the --fresh-state escape hatch');
  assert.ok(!hint.includes('token=secret'), 'query string (and its token) must not leak into the hint');
  assert.ok(!hint.includes('?'), 'URL in hint should be truncated to origin+pathname, no query string');
  console.log('PASS: positive case appends stale-state note with query string stripped');
}

// ─── Negative case: stateRestored false ──────────────────────────────────────
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'http://localhost:3000/api/auth/refresh', method: 'POST', status: 401 }),
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'selector_not_found', false, networkRequests);
  assert.strictEqual(hint, BASE_HINT, 'no state restored -> hint unchanged');
  console.log('PASS: stateRestored=false leaves hint unchanged');
}

// ─── Negative case: stateRestored undefined (top-level/default assertions) ──
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'http://localhost:3000/api/auth/refresh', method: 'POST', status: 401 }),
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'selector_not_found', undefined, networkRequests);
  assert.strictEqual(hint, BASE_HINT, 'stateRestored=undefined -> hint unchanged');
  console.log('PASS: stateRestored=undefined leaves hint unchanged');
}

// ─── Negative case: no auth-ish 4xx in network log ───────────────────────────
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'http://localhost:3000/api/products', method: 'GET', status: 500 }),
    req({ url: 'http://localhost:3000/api/checkout', method: 'POST', status: 403 }), // 403 but not auth-ish URL
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'selector_not_found', true, networkRequests);
  assert.strictEqual(hint, BASE_HINT, 'no matching auth-ish 401/403 -> hint unchanged');
  console.log('PASS: no auth-ish failing request leaves hint unchanged');
}

// ─── Negative case: failure type not in the eligible set ────────────────────
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'http://localhost:3000/api/auth/session', method: 'GET', status: 401 }),
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'text_mismatch', true, networkRequests);
  assert.strictEqual(hint, BASE_HINT, 'text_mismatch failure type -> hint unchanged');
  console.log('PASS: ineligible failure type (text_mismatch) leaves hint unchanged');
}

// ─── Positive case: 403 on a token-ish endpoint, selector_not_visible ────────
{
  const networkRequests: NetworkRequest[] = [
    req({ url: 'https://api.example.com/oauth/token', method: 'POST', status: 403 }),
  ];
  const hint = appendStaleStateHint(BASE_HINT, 'selector_not_visible', true, networkRequests);
  assert.ok(hint.includes('returned 403 on POST https://api.example.com/oauth/token'), `expected 403 oauth note, got: ${hint}`);
  console.log('PASS: 403 on oauth-ish endpoint appends note for selector_not_visible');
}

console.log('\nAll stale-state-hint tests passed.');
