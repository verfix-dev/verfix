/**
 * Unit tests for failure-time page-state facts (#55): collectPageState's
 * merge of the in-page probe with prior-anomaly counts, its never-throw
 * guarantees, and runAssertions attaching page_state to failed results.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/artifacts/page-state.test.ts
 */

import assert from 'assert';
import { collectPageState, PageState } from '../../src/artifacts/page-state';
import { runAssertions } from '../../src/assertions/engine';
import { ConsoleLine, NetworkRequest } from '../../src/assertions/types';

const PROBE_FIXTURE = {
  url: 'http://localhost:3000/checkout',
  title: 'Checkout',
  open_dialogs: [
    { kind: 'dialog', selector: 'div#welcome.modal', name: 'Welcome to Cleara', viewport_coverage: 0.42 },
  ],
  visible_elements: [{ role: 'button', name: 'Get started' }],
  visible_elements_truncated: false,
};

function fakePage(evaluate: () => Promise<unknown>): any {
  return { url: () => 'http://localhost:3000/checkout', evaluate };
}

function log(type: string, text: string): ConsoleLine {
  return { type, text, timestamp: new Date().toISOString() };
}

function req(status: number): NetworkRequest {
  return { url: 'http://localhost:3000/api/x', method: 'GET', status, timing_ms: 5, timestamp: new Date().toISOString() };
}

async function test_probe_merged_with_anomaly_counts() {
  const state = await collectPageState(
    fakePage(async () => PROBE_FIXTURE),
    [log('error', 'boom'), log('log', 'fine'), log('error', 'excluded noise')],
    [req(200), req(500), req(0)],
    ['excluded'],
  );
  assert.ok(state, 'probe fixture should produce a PageState');
  assert.strictEqual(state!.open_dialogs[0].name, 'Welcome to Cleara');
  assert.strictEqual(state!.prior_console_errors, 1, 'excluded error must not count');
  assert.strictEqual(state!.prior_failed_requests, 2, '>=400 and status 0 both count');
}

async function test_invalid_exclude_pattern_is_skipped_not_fatal() {
  const state = await collectPageState(
    fakePage(async () => PROBE_FIXTURE),
    [log('error', 'boom')],
    [],
    ['[unclosed'],
  );
  assert.ok(state);
  assert.strictEqual(state!.prior_console_errors, 1);
}

async function test_returns_null_when_probe_throws() {
  const state = await collectPageState(
    fakePage(async () => { throw new Error('Target page closed'); }),
    [], [],
  );
  assert.strictEqual(state, null);
}

async function test_returns_null_when_page_has_no_evaluate() {
  const state = await collectPageState({} as any, [], []);
  assert.strictEqual(state, null);
}

async function test_returns_null_when_probe_stalls() {
  const state = await collectPageState(
    fakePage(() => new Promise(() => { /* never resolves */ })),
    [], [],
  );
  assert.strictEqual(state, null, 'stalled probe must time out to null, not hang the run');
}

// ─── runAssertions attachment ────────────────────────────────────────────────

function fakeAssertionPage(opts: { visible: boolean; probe?: unknown }): any {
  return {
    url: () => 'http://localhost:3000/',
    title: async () => '',
    locator: (_s: string) => ({ isVisible: async () => opts.visible }),
    getByText: () => ({ filter: () => ({ first: () => ({ isVisible: async () => opts.visible }) }) }),
    screenshot: async () => Buffer.from(''),
    evaluate: async () => opts.probe ?? PROBE_FIXTURE,
  };
}

async function test_failed_assertion_carries_page_state() {
  const results = await runAssertions(
    fakeAssertionPage({ visible: false }),
    [{ type: 'selector_visible', selector: '#gone' }],
    [], [], '/tmp', 'exec_test', 'strict',
  );
  const state = results[0].page_state as PageState;
  assert.ok(state, 'failed assertion must carry page_state');
  assert.strictEqual(state.open_dialogs[0].name, 'Welcome to Cleara');
}

async function test_passed_assertion_has_no_page_state() {
  const results = await runAssertions(
    fakeAssertionPage({ visible: true }),
    [{ type: 'selector_visible', selector: '#here' }],
    [], [], '/tmp', 'exec_test', 'strict',
  );
  assert.strictEqual(results[0].passed, true);
  assert.strictEqual(results[0].page_state, undefined, 'passing runs pay zero cost and carry no page_state');
}

async function main() {
  const tests = [
    test_probe_merged_with_anomaly_counts,
    test_invalid_exclude_pattern_is_skipped_not_fatal,
    test_returns_null_when_probe_throws,
    test_returns_null_when_page_has_no_evaluate,
    test_returns_null_when_probe_stalls,
    test_failed_assertion_carries_page_state,
    test_passed_assertion_has_no_page_state,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`✅ ${t.name}`);
    } catch (e: any) {
      failed++;
      console.error(`❌ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
