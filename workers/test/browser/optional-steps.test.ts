/**
 * Unit tests for `optional` flow steps: a step marked optional should be
 * skipped (not abort the flow) when its locator never resolves, while the
 * same step without `optional` still throws — preserving strict-mode
 * determinism for every other step.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/browser/optional-steps.test.ts
 */

import assert from 'assert';
import { executeFlow } from '../../src/browser/flow-executor';
import { Flow, JobPayload } from '../../src/assertions/types';

function makeFakePage(opts: { missingSelector: string }) {
  const missingLocator = {
    waitFor: async () => { throw new Error(`Timeout waiting for selector "${opts.missingSelector}"`); },
    click: async () => {},
    fill: async () => {},
    first: function () { return this; },
  };
  const foundLocator = {
    waitFor: async () => {},
    click: async () => {},
    fill: async () => {},
    first: function () { return this; },
  };
  return {
    locator: (selector: string) => (selector === opts.missingSelector ? missingLocator : foundLocator),
    getByText: () => foundLocator,
  } as any;
}

const job: JobPayload = { id: 'exec_test', task: 't', url: 'https://example.com', mode: 'strict' };

async function test_optional_step_is_skipped_not_fatal() {
  const page = makeFakePage({ missingSelector: '#logout-confirm' });
  const flow: Flow = {
    name: 'login',
    steps: [
      { action: 'click', target: { selector: '#logout-confirm' }, optional: true, timeout: 500 },
      { action: 'click', target: { selector: '#submit' }, timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job); // should not throw
  console.log('✓ optional step that fails to resolve is skipped, flow continues');
}

async function test_non_optional_step_still_throws() {
  const page = makeFakePage({ missingSelector: '#logout-confirm' });
  const flow: Flow = {
    name: 'login',
    steps: [
      { action: 'click', target: { selector: '#logout-confirm' }, timeout: 500 },
    ],
  };
  await assert.rejects(() => executeFlow(page, flow, job), /Timeout waiting for selector/);
  console.log('✓ the same failing step without optional still aborts the flow');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_optional_step_is_skipped_not_fatal', fn: test_optional_step_is_skipped_not_fatal },
  { name: 'test_non_optional_step_still_throws', fn: test_non_optional_step_still_throws },
];

(async () => {
  console.log('\nRunning optional-steps tests...\n');
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
