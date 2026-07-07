/**
 * Unit tests for the form-interaction flow steps: `select_option`,
 * `check` / `uncheck`, and `hover`.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/browser/form-steps.test.ts
 */

import assert from 'assert';
import { executeFlow } from '../../src/browser/flow-executor';
import { Flow, JobPayload } from '../../src/assertions/types';

function makeFakePage() {
  const calls: Array<{ method: string; arg?: string }> = [];
  const locator = {
    waitFor: async () => {},
    selectOption: async (value: string) => { calls.push({ method: 'selectOption', arg: value }); },
    check: async () => { calls.push({ method: 'check' }); },
    uncheck: async () => { calls.push({ method: 'uncheck' }); },
    hover: async () => { calls.push({ method: 'hover' }); },
    first: function () { return this; },
  };
  const page = {
    locator: () => locator,
    getByText: () => locator,
  } as any;
  return { page, calls };
}

const job: JobPayload = { id: 'exec_test', task: 't', url: 'https://example.com', mode: 'strict' };

async function test_select_option_passes_value_to_locator() {
  const { page, calls } = makeFakePage();
  const flow: Flow = {
    name: 'filters',
    steps: [
      { action: 'select_option', target: { selector: '#country' }, value: 'India', timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls, [{ method: 'selectOption', arg: 'India' }]);
  console.log('✓ select_option calls selectOption with the step value');
}

async function test_check_and_uncheck_call_matching_methods() {
  const { page, calls } = makeFakePage();
  const flow: Flow = {
    name: 'consent',
    steps: [
      { action: 'check', target: { selector: '#tos' }, timeout: 500 },
      { action: 'uncheck', target: { selector: '#newsletter' }, timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls.map(c => c.method), ['check', 'uncheck']);
  console.log('✓ check/uncheck call the matching locator methods');
}

async function test_hover_calls_hover_on_locator() {
  const { page, calls } = makeFakePage();
  const flow: Flow = {
    name: 'menu',
    steps: [
      { action: 'hover', target: { selector: '#user-menu' }, timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls.map(c => c.method), ['hover']);
  console.log('✓ hover calls hover on the locator');
}

async function test_optional_form_step_is_skipped_on_failure() {
  const { page, calls } = makeFakePage();
  (page.locator as any) = () => ({
    waitFor: async () => { throw new Error('not found'); },
    first: function () { return this; },
  });
  const flow: Flow = {
    name: 'optional-consent',
    steps: [
      { action: 'check', target: { selector: '#maybe-banner' }, optional: true, timeout: 200 },
    ],
  };
  await executeFlow(page, flow, job); // must not throw
  assert.deepStrictEqual(calls, []);
  console.log('✓ optional form step is skipped, not fatal, when its target is missing');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_select_option_passes_value_to_locator', fn: test_select_option_passes_value_to_locator },
  { name: 'test_check_and_uncheck_call_matching_methods', fn: test_check_and_uncheck_call_matching_methods },
  { name: 'test_hover_calls_hover_on_locator', fn: test_hover_calls_hover_on_locator },
  { name: 'test_optional_form_step_is_skipped_on_failure', fn: test_optional_form_step_is_skipped_on_failure },
];

(async () => {
  console.log('\nRunning form-steps tests...\n');
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
