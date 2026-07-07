/**
 * Unit tests for the `wait_for_url` / `wait_for_network_idle` flow steps and
 * the `frame` field (iframe-scoped target resolution).
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/browser/wait-and-frame.test.ts
 */

import assert from 'assert';
import { executeFlow } from '../../src/browser/flow-executor';
import { Flow, JobPayload } from '../../src/assertions/types';

function makeFakePage(currentUrl = 'https://example.com/dashboard') {
  const calls: Array<{ method: string; arg?: unknown }> = [];
  const locator = {
    waitFor: async () => {},
    click: async () => { calls.push({ method: 'click' }); },
    first: function () { return this; },
  };
  const frameLocatorCalls: string[] = [];
  const page = {
    url: () => currentUrl,
    locator: (sel: string) => { calls.push({ method: 'page.locator', arg: sel }); return locator; },
    getByText: () => locator,
    frameLocator: (sel: string) => {
      frameLocatorCalls.push(sel);
      return {
        locator: (inner: string) => { calls.push({ method: 'frame.locator', arg: inner }); return locator; },
        getByText: () => locator,
      };
    },
    waitForURL: async (predicate: (u: URL) => boolean, _o?: unknown) => {
      calls.push({ method: 'waitForURL' });
      if (!predicate(new URL(currentUrl))) throw new Error(`Timeout waiting for URL, current: ${currentUrl}`);
    },
    waitForLoadState: async (state: string, _o?: unknown) => { calls.push({ method: 'waitForLoadState', arg: state }); },
  } as any;
  return { page, calls, frameLocatorCalls };
}

const job: JobPayload = { id: 'exec_test', task: 't', url: 'https://example.com', mode: 'strict' };

async function test_wait_for_url_passes_on_matching_substring() {
  const { page, calls } = makeFakePage('https://example.com/dashboard?tab=1');
  const flow: Flow = {
    name: 'nav',
    steps: [{ action: 'wait_for_url', value: '/dashboard', timeout: 500 }],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls.map(c => c.method), ['waitForURL']);
  console.log('✓ wait_for_url matches the current URL by substring');
}

async function test_wait_for_url_fails_on_non_matching_url() {
  const { page } = makeFakePage('https://example.com/login');
  const flow: Flow = {
    name: 'nav',
    steps: [{ action: 'wait_for_url', value: '/dashboard', timeout: 500 }],
  };
  let err: Error | undefined;
  try { await executeFlow(page, flow, job); } catch (e: any) { err = e; }
  assert.ok(err, 'non-matching URL should fail the step');
  console.log('✓ wait_for_url fails when the URL never matches');
}

async function test_wait_for_url_requires_value() {
  const { page } = makeFakePage();
  const flow: Flow = { name: 'nav', steps: [{ action: 'wait_for_url', timeout: 500 }] };
  let err: Error | undefined;
  try { await executeFlow(page, flow, job); } catch (e: any) { err = e; }
  assert.ok(err && /requires "value"/.test(err.message), `should demand value, got: ${err?.message}`);
  console.log('✓ wait_for_url without a value fails with a clear message');
}

async function test_wait_for_network_idle_waits_on_load_state() {
  const { page, calls } = makeFakePage();
  const flow: Flow = { name: 'idle', steps: [{ action: 'wait_for_network_idle', timeout: 500 }] };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls, [{ method: 'waitForLoadState', arg: 'networkidle' }]);
  console.log('✓ wait_for_network_idle waits for the networkidle load state');
}

async function test_frame_scopes_selector_resolution() {
  const { page, calls, frameLocatorCalls } = makeFakePage();
  const flow: Flow = {
    name: 'payment',
    steps: [
      { action: 'click', frame: 'iframe[title=card]', target: { selector: '#pay' }, timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(frameLocatorCalls, ['iframe[title=card]'], 'frameLocator should be used for the iframe');
  assert.deepStrictEqual(calls.map(c => c.method), ['frame.locator', 'click'], 'target must resolve inside the frame, not the page');
  console.log('✓ frame field resolves the target inside the iframe');
}

async function test_frame_scopes_testid_resolution() {
  const { page, calls } = makeFakePage();
  const flow: Flow = {
    name: 'payment',
    steps: [
      { action: 'click', frame: 'iframe', target: { testId: 'submit' }, timeout: 500 },
    ],
  };
  await executeFlow(page, flow, job);
  assert.deepStrictEqual(calls[0], { method: 'frame.locator', arg: '[data-testid="submit"]' });
  console.log('✓ frame field applies to testId targets too');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_wait_for_url_passes_on_matching_substring', fn: test_wait_for_url_passes_on_matching_substring },
  { name: 'test_wait_for_url_fails_on_non_matching_url', fn: test_wait_for_url_fails_on_non_matching_url },
  { name: 'test_wait_for_url_requires_value', fn: test_wait_for_url_requires_value },
  { name: 'test_wait_for_network_idle_waits_on_load_state', fn: test_wait_for_network_idle_waits_on_load_state },
  { name: 'test_frame_scopes_selector_resolution', fn: test_frame_scopes_selector_resolution },
  { name: 'test_frame_scopes_testid_resolution', fn: test_frame_scopes_testid_resolution },
];

(async () => {
  console.log('\nRunning wait-and-frame tests...\n');
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
