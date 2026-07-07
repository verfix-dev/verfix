/**
 * Unit tests for the form-interaction flow steps: `select_option`,
 * `check` / `uncheck`, `hover`, and `upload_file`.
 *
 * Uses a lightweight fake Playwright Page. No browser is launched.
 * Run with: ts-node test/browser/form-steps.test.ts
 */

import assert from 'assert';
import { executeFlow } from '../../src/browser/flow-executor';
import { Flow, JobPayload } from '../../src/assertions/types';

function makeFakePage() {
  const calls: Array<{ method: string; arg?: unknown }> = [];
  const locator = {
    waitFor: async () => {},
    selectOption: async (value: string) => { calls.push({ method: 'selectOption', arg: value }); },
    check: async () => { calls.push({ method: 'check' }); },
    uncheck: async () => { calls.push({ method: 'uncheck' }); },
    hover: async () => { calls.push({ method: 'hover' }); },
    setInputFiles: async (files: unknown) => { calls.push({ method: 'setInputFiles', arg: files }); },
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

async function test_upload_file_inline_content_builds_buffer() {
  const { page, calls } = makeFakePage();
  const flow: Flow = {
    name: 'import',
    steps: [
      {
        action: 'upload_file',
        target: { selector: 'input[type=file]' },
        file: { name: 'note.csv', content: 'a,b\n1,2', mimeType: 'text/csv' },
        timeout: 500,
      },
    ],
  };
  await executeFlow(page, flow, job);
  const arg = calls[0].arg as { name: string; mimeType: string; buffer: Buffer };
  assert.strictEqual(calls[0].method, 'setInputFiles');
  assert.strictEqual(arg.name, 'note.csv');
  assert.strictEqual(arg.mimeType, 'text/csv');
  assert.strictEqual(arg.buffer.toString('utf8'), 'a,b\n1,2');
  console.log('✓ upload_file with inline content materializes a named buffer');
}

async function test_upload_file_base64_decodes_binary() {
  const { page, calls } = makeFakePage();
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  const flow: Flow = {
    name: 'avatar',
    steps: [
      {
        action: 'upload_file',
        target: { selector: 'input[type=file]' },
        file: { name: 'a.png', content: payload.toString('base64'), encoding: 'base64', mimeType: 'image/png' },
        timeout: 500,
      },
    ],
  };
  await executeFlow(page, flow, job);
  const arg = calls[0].arg as { buffer: Buffer };
  assert.ok(payload.equals(arg.buffer), 'base64 content should decode to the original bytes');
  console.log('✓ upload_file decodes base64 content to binary');
}

async function test_upload_file_missing_fixture_fails_clearly() {
  const { page } = makeFakePage();
  const flow: Flow = {
    name: 'import',
    steps: [
      { action: 'upload_file', target: { selector: 'input[type=file]' }, file: 'fixtures/does-not-exist.csv', timeout: 500 },
    ],
  };
  let err: Error | undefined;
  try { await executeFlow(page, flow, job); } catch (e: any) { err = e; }
  assert.ok(err, 'missing fixture should fail the flow');
  assert.ok(/file not found/.test(err!.message), `error should say file not found, got: ${err!.message}`);
  assert.ok(/inline/.test(err!.message), `error should point at the inline alternative, got: ${err!.message}`);
  console.log('✓ upload_file with a missing fixture path fails with a pointer to inline content');
}

async function test_upload_file_without_file_field_fails() {
  const { page } = makeFakePage();
  const flow: Flow = {
    name: 'import',
    steps: [
      { action: 'upload_file', target: { selector: 'input[type=file]' }, timeout: 500 },
    ],
  };
  let err: Error | undefined;
  try { await executeFlow(page, flow, job); } catch (e: any) { err = e; }
  assert.ok(err && /requires "file"/.test(err.message), `should demand a file field, got: ${err?.message}`);
  console.log('✓ upload_file without a file field fails with a clear message');
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [
  { name: 'test_select_option_passes_value_to_locator', fn: test_select_option_passes_value_to_locator },
  { name: 'test_check_and_uncheck_call_matching_methods', fn: test_check_and_uncheck_call_matching_methods },
  { name: 'test_hover_calls_hover_on_locator', fn: test_hover_calls_hover_on_locator },
  { name: 'test_optional_form_step_is_skipped_on_failure', fn: test_optional_form_step_is_skipped_on_failure },
  { name: 'test_upload_file_inline_content_builds_buffer', fn: test_upload_file_inline_content_builds_buffer },
  { name: 'test_upload_file_base64_decodes_binary', fn: test_upload_file_base64_decodes_binary },
  { name: 'test_upload_file_missing_fixture_fails_clearly', fn: test_upload_file_missing_fixture_fails_clearly },
  { name: 'test_upload_file_without_file_field_fails', fn: test_upload_file_without_file_field_fails },
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
