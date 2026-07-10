/**
 * Unit tests for the `selector_count` assertion: exact-match count of
 * elements found by a selector, mapping onto the frozen failure taxonomy
 * (0 matches → selector_not_found; nonzero-but-wrong count → assertion_failed
 * with expected/actual counts in `details`).
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/assertions/selector-count.test.ts
 */

import assert from 'assert';
import { runAssertions } from '../../src/assertions/engine';
import { AssertionDefinition } from '../../src/assertions/types';

function makeFakePage(matchCount: number) {
  return {
    url: () => 'https://example.com/',
    title: async () => '',
    locator: (_selector: string) => ({ count: async () => matchCount }),
    screenshot: async (_o?: unknown) => Buffer.from(''),
  } as any;
}

async function test_exact_count_passes() {
  const assertions: AssertionDefinition[] = [{ type: 'selector_count', selector: '.todo-item', count: 3 }];
  const [result] = await runAssertions(makeFakePage(3), assertions, [], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, true, 'matching count should pass');
  assert.strictEqual((result.details as any).actual_count, 3);
  console.log('✓ selector_count passes when the actual count equals the expected count');
}

async function test_zero_matches_maps_to_selector_not_found() {
  const assertions: AssertionDefinition[] = [{ type: 'selector_count', selector: '.todo-item', count: 3 }];
  const [result] = await runAssertions(makeFakePage(0), assertions, [], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.failure_type, 'selector_not_found', 'zero matches should map to selector_not_found');
  assert.ok(result.fix_hint?.includes('.todo-item'), `fix_hint should name the selector, got: ${result.fix_hint}`);
  console.log('✓ zero matches maps to selector_not_found with a selector-naming fix_hint');
}

async function test_wrong_nonzero_count_maps_to_assertion_failed() {
  const assertions: AssertionDefinition[] = [{ type: 'selector_count', selector: '.todo-item', count: 3 }];
  const [result] = await runAssertions(makeFakePage(5), assertions, [], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.failure_type, 'assertion_failed', 'nonzero-but-wrong count should map to assertion_failed');
  assert.strictEqual((result.details as any).expected_count, 3);
  assert.strictEqual((result.details as any).actual_count, 5);
  assert.ok(
    result.fix_hint?.includes('3') && result.fix_hint?.includes('5'),
    `fix_hint should include both expected and actual counts, got: ${result.fix_hint}`,
  );
  console.log('✓ a nonzero-but-wrong count maps to assertion_failed with expected/actual counts in details and fix_hint');
}

async function test_details_carry_selector_and_counts_on_success() {
  const assertions: AssertionDefinition[] = [{ type: 'selector_count', selector: '.todo-item', count: 2 }];
  const [result] = await runAssertions(makeFakePage(2), assertions, [], [], '/tmp', 'exec', 'strict', '');
  assert.strictEqual((result.details as any).selector, '.todo-item');
  assert.strictEqual((result.details as any).expected_count, 2);
  console.log('✓ details carry selector and expected/actual counts on success too');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_exact_count_passes', fn: test_exact_count_passes },
  { name: 'test_zero_matches_maps_to_selector_not_found', fn: test_zero_matches_maps_to_selector_not_found },
  { name: 'test_wrong_nonzero_count_maps_to_assertion_failed', fn: test_wrong_nonzero_count_maps_to_assertion_failed },
  { name: 'test_details_carry_selector_and_counts_on_success', fn: test_details_carry_selector_and_counts_on_success },
];

(async () => {
  console.log('\nRunning selector-count tests...\n');
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
