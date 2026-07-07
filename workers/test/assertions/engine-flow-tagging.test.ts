/**
 * Unit tests for flow_name tagging in runAssertions.
 *
 * Verifies that assertion results are tagged with the flow identifier passed
 * to runAssertions, and that top-level/default assertions (no flowName) leave
 * flow_name undefined — which is what the dashboard relies on to group (or
 * not group) assertions by flow.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/assertions/engine-flow-tagging.test.ts
 */

import assert from 'assert';
import { runAssertions } from '../../src/assertions/engine';
import { AssertionDefinition, AssertionResult } from '../../src/assertions/types';

// ─── Fake Playwright Page ────────────────────────────────────────────────────
// Implements only the surface area the assertion engine touches in strict mode
// for passing assertions. Returned locators expose isVisible() resolving true.
function makeFakePage(opts: { url?: string; title?: string } = {}) {
  const fakeLocator: any = {
    isVisible: async (_o?: unknown) => true,
    waitFor: async (_o?: unknown) => {},
    first: () => fakeLocator,
    filter: (_o?: unknown) => fakeLocator,
    getByText: (_text: string, _o?: unknown) => fakeLocator,
  };
  return {
    url: () => opts.url ?? 'https://example.com/dashboard',
    title: async () => opts.title ?? 'Dashboard',
    locator: (_selector: string) => fakeLocator,
    getByText: (_text: string, _o?: unknown) => fakeLocator,
    screenshot: async (_o?: unknown) => Buffer.from(''),
  } as any;
}

// All-passing assertion set spanning several types so the test exercises the
// engine's switch branches (page_loaded, url_contains, title_contains,
// no_console_errors, selector_visible, text_visible).
const passingAssertions: AssertionDefinition[] = [
  { type: 'page_loaded' },
  { type: 'url_contains', value: '/dashboard' },
  { type: 'title_contains', value: 'Dashboard' },
  { type: 'no_console_errors' },
  { type: 'selector_visible', selector: '[data-testid=hero]' },
  { type: 'text_visible', value: 'Welcome' },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test_flow_name_attached_to_every_result() {
  const page = makeFakePage();
  const results = await runAssertions(
    page, passingAssertions, [], [], '/tmp/artifacts', 'exec_test', 'strict', 'task', undefined, 'login',
  );
  assert.strictEqual(results.length, passingAssertions.length, 'all assertions should produce a result');
  for (const r of results) {
    assert.strictEqual((r as AssertionResult).flow_name, 'login', `assertion ${r.type} should be tagged with flow_name 'login'`);
  }
  console.log(`✓ flow_name='login' attached to all ${results.length} results`);
}

async function test_flow_name_absent_when_omitted() {
  const page = makeFakePage();
  const results = await runAssertions(
    page, passingAssertions, [], [], '/tmp/artifacts', 'exec_test', 'strict', 'task', undefined,
  );
  assert.strictEqual(results.length, passingAssertions.length, 'all assertions should produce a result');
  for (const r of results) {
    assert.strictEqual((r as AssertionResult).flow_name, undefined, `assertion ${r.type} should have no flow_name`);
  }
  console.log(`✓ flow_name is undefined for all ${results.length} results when omitted`);
}

async function test_different_flow_names_tagged_independently() {
  const page = makeFakePage();
  const flowA = await runAssertions(
    page, [{ type: 'page_loaded' }], [], [], '/tmp/artifacts', 'exec_test', 'strict', 'task', undefined, 'flow-a',
  );
  const flowB = await runAssertions(
    page, [{ type: 'page_loaded' }], [], [], '/tmp/artifacts', 'exec_test', 'strict', 'task', undefined, 'flow-b',
  );
  assert.strictEqual(flowA[0].flow_name, 'flow-a', 'flow-a result tagged correctly');
  assert.strictEqual(flowB[0].flow_name, 'flow-b', 'flow-b result tagged correctly');
  console.log('✓ independent flow runs tagged with their own flow_name');
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_flow_name_attached_to_every_result', fn: test_flow_name_attached_to_every_result },
  { name: 'test_flow_name_absent_when_omitted', fn: test_flow_name_absent_when_omitted },
  { name: 'test_different_flow_names_tagged_independently', fn: test_different_flow_names_tagged_independently },
];

(async () => {
  console.log('\nRunning assertion flow-tagging tests...\n');
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
