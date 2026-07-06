/**
 * Unit tests for the additive assertion options: `acceptStatuses` on
 * network_request_success, `exclude` on no_console_errors, and the richer
 * error/fix_hint text both assertions now carry on failure.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/assertions/assertion-options.test.ts
 */

import assert from 'assert';
import { runAssertions } from '../../src/assertions/engine';
import { AssertionDefinition, ConsoleLine, NetworkRequest } from '../../src/assertions/types';

function makeFakePage(opts: { url?: string } = {}) {
  return {
    url: () => opts.url ?? 'https://example.com/',
    title: async () => '',
    locator: (_selector: string) => ({ isVisible: async () => true }),
    getByText: (_text: string, _o?: unknown) => ({ isVisible: async () => true }),
    screenshot: async (_o?: unknown) => Buffer.from(''),
  } as any;
}

function req(url: string, method: string, status: number): NetworkRequest {
  return { url, method, status, timing_ms: 10, timestamp: new Date().toISOString() };
}

// ─── network_request_success / acceptStatuses ─────────────────────────────

async function test_default_range_rejects_409() {
  const assertions: AssertionDefinition[] = [{ type: 'network_request_success', value: '/api/auth/login' }];
  const requests = [req('https://x/api/auth/login', 'POST', 409)];
  const [result] = await runAssertions(makeFakePage(), assertions, [], requests, '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false, 'default range should reject 409');
  assert.ok(result.error?.includes('409'), `error should mention 409, got: ${result.error}`);
  assert.ok(result.fix_hint?.includes('acceptStatuses'), `fix_hint should mention acceptStatuses, got: ${result.fix_hint}`);
  console.log('✓ default acceptStatuses range rejects 409, error/fix_hint name it');
}

async function test_accept_statuses_allows_409() {
  const assertions: AssertionDefinition[] = [
    { type: 'network_request_success', value: '/api/auth/login', acceptStatuses: [200, 409] },
  ];
  const requests = [req('https://x/api/auth/login', 'POST', 409)];
  const [result] = await runAssertions(makeFakePage(), assertions, [], requests, '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, true, 'acceptStatuses=[200,409] should accept a 409');
  console.log('✓ acceptStatuses=[200,409] accepts a 409 response');
}

async function test_accept_statuses_still_rejects_500() {
  const assertions: AssertionDefinition[] = [
    { type: 'network_request_success', value: '/api/auth/login', acceptStatuses: [200, 409] },
  ];
  const requests = [req('https://x/api/auth/login', 'POST', 500)];
  const [result] = await runAssertions(makeFakePage(), assertions, [], requests, '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false, 'acceptStatuses=[200,409] should still reject a 500');
  console.log('✓ acceptStatuses=[200,409] still rejects an unlisted 500');
}

async function test_no_matches_fails_with_clear_error() {
  const assertions: AssertionDefinition[] = [{ type: 'network_request_success', value: '/api/never-called' }];
  const [result] = await runAssertions(makeFakePage(), assertions, [], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false);
  assert.ok(result.error?.includes('No requests matching'), `error should say no requests matched, got: ${result.error}`);
  console.log('✓ zero matched requests fails with a "no requests matching" error');
}

// ─── no_console_errors / exclude ────────────────────────────────────────────

function log(text: string): ConsoleLine {
  return { type: 'error', text, timestamp: new Date().toISOString() };
}

async function test_no_console_errors_fails_by_default() {
  const assertions: AssertionDefinition[] = [{ type: 'no_console_errors' }];
  const logs = [log('Failed to load resource: 409')];
  const [result] = await runAssertions(makeFakePage(), assertions, logs, [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false);
  assert.ok(result.error?.includes('409'), `error should include the console text, got: ${result.error}`);
  assert.ok(result.fix_hint?.includes('exclude'), `fix_hint should mention exclude, got: ${result.fix_hint}`);
  console.log('✓ console error fails by default, error/fix_hint surface the text');
}

async function test_exclude_pattern_suppresses_matching_error() {
  const assertions: AssertionDefinition[] = [{ type: 'no_console_errors', exclude: ['409'] }];
  const logs = [log('Failed to load resource: 409'), log('Uncaught TypeError: real bug')];
  const [result] = await runAssertions(makeFakePage(), assertions, logs, [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false, 'the non-matching real error should still fail the assertion');
  assert.strictEqual((result.details as any).error_count, 1);
  assert.strictEqual((result.details as any).excluded_count, 1);
  console.log('✓ exclude pattern suppresses only the matching console error');
}

async function test_exclude_pattern_can_suppress_all_errors() {
  const assertions: AssertionDefinition[] = [{ type: 'no_console_errors', exclude: ['409'] }];
  const logs = [log('Failed to load resource: 409')];
  const [result] = await runAssertions(makeFakePage(), assertions, logs, [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, true, 'assertion should pass once all errors are excluded');
  console.log('✓ exclude pattern can suppress every console error, passing the assertion');
}

async function test_invalid_exclude_pattern_fails_clearly() {
  const assertions: AssertionDefinition[] = [{ type: 'no_console_errors', exclude: ['('] }];
  const [result] = await runAssertions(makeFakePage(), assertions, [log('boom')], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false);
  assert.ok(result.error?.includes('Invalid exclude pattern'), `error should flag the bad pattern, got: ${result.error}`);
  console.log('✓ an invalid exclude regex fails the assertion with a clear error');
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_default_range_rejects_409', fn: test_default_range_rejects_409 },
  { name: 'test_accept_statuses_allows_409', fn: test_accept_statuses_allows_409 },
  { name: 'test_accept_statuses_still_rejects_500', fn: test_accept_statuses_still_rejects_500 },
  { name: 'test_no_matches_fails_with_clear_error', fn: test_no_matches_fails_with_clear_error },
  { name: 'test_no_console_errors_fails_by_default', fn: test_no_console_errors_fails_by_default },
  { name: 'test_exclude_pattern_suppresses_matching_error', fn: test_exclude_pattern_suppresses_matching_error },
  { name: 'test_exclude_pattern_can_suppress_all_errors', fn: test_exclude_pattern_can_suppress_all_errors },
  { name: 'test_invalid_exclude_pattern_fails_clearly', fn: test_invalid_exclude_pattern_fails_clearly },
];

(async () => {
  console.log('\nRunning assertion-options tests...\n');
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (e: any) {
      console.error(`✗ ${t.name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
