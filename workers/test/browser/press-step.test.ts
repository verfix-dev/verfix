/**
 * Unit tests for the `press` flow step: pressing a key on a specific target
 * locator vs. at the page level (no target given).
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/browser/press-step.test.ts
 */

import assert from 'assert';
import { executeFlow } from '../../src/browser/flow-executor';
import { Flow, JobPayload } from '../../src/assertions/types';

function makeFakePage() {
  const pressedOnLocator: string[] = [];
  const pressedOnPage: string[] = [];
  const locator = {
    waitFor: async () => {},
    press: async (key: string) => { pressedOnLocator.push(key); },
    first: function () { return this; },
  };
  const page = {
    locator: () => locator,
    getByText: () => locator,
    keyboard: { press: async (key: string) => { pressedOnPage.push(key); } },
  } as any;
  return { page, pressedOnLocator, pressedOnPage };
}

const job: JobPayload = { id: 'exec_test', task: 't', url: 'https://example.com', mode: 'strict' };

async function test_press_with_target_presses_on_locator() {
  const { page, pressedOnLocator, pressedOnPage } = makeFakePage();
  const flow: Flow = {
    name: 'search',
    steps: [
      { action: 'press', target: { selector: '#search-input' }, key: 'Enter', timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(pressedOnLocator, ['Enter']);
  assert.deepStrictEqual(pressedOnPage, []);
  console.log('✓ press with a target presses the key on that locator');
}

async function test_press_without_target_presses_on_page() {
  const { page, pressedOnLocator, pressedOnPage } = makeFakePage();
  const flow: Flow = {
    name: 'shortcuts',
    steps: [
      { action: 'press', key: 'Escape', timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(pressedOnPage, ['Escape']);
  assert.deepStrictEqual(pressedOnLocator, []);
  console.log('✓ press without a target presses the key at the page level');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_press_with_target_presses_on_locator', fn: test_press_with_target_presses_on_locator },
  { name: 'test_press_without_target_presses_on_page', fn: test_press_without_target_presses_on_page },
];

(async () => {
  console.log('\nRunning press-step tests...\n');
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
