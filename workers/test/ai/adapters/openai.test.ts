/**
 * Unit tests for the OpenAI adapter.
 * Uses Node built-in assert + mocked fetch. No test runner needed.
 * Run with: ts-node test/ai/adapters/openai.test.ts
 */

import assert from 'assert';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai';

// ─── fetch mock infrastructure ────────────────────────────────────────────────

type MockResponse = {
  status: number;
  body?: unknown;
};

function mockFetch(responses: MockResponse[]): () => void {
  let callIndex = 0;
  const original = (global as any).fetch;

  (global as any).fetch = async (_url: string, _init: RequestInit) => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status >= 400 ? 'Error' : 'OK',
      json: async () => resp.body,
    } as Response;
  };

  // Return restore function
  return () => { (global as any).fetch = original; };
}

// ─── env helpers ──────────────────────────────────────────────────────────────

const AI_KEYS = ['AI_PROVIDER', 'AI_API_KEY', 'OPENAI_API_KEY', 'AI_MODEL', 'AI_BASE_URL'];

function resetEnv() {
  for (const k of AI_KEYS) delete process.env[k];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function test_isEnabled_false_when_no_key() {
  resetEnv();
  const adapter = new OpenAIAdapter();
  assert.strictEqual(adapter.isEnabled(), false, 'isEnabled() should be false without key');
  console.log('✓ isEnabled() false when no key');
}

function test_isEnabled_true_with_OPENAI_API_KEY() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';
  const adapter = new OpenAIAdapter();
  assert.strictEqual(adapter.isEnabled(), true, 'isEnabled() with OPENAI_API_KEY');
  console.log('✓ isEnabled() true with OPENAI_API_KEY');
}

function test_isEnabled_true_with_legacy_AI_API_KEY() {
  resetEnv();
  process.env.AI_API_KEY = 'sk-legacy';
  const adapter = new OpenAIAdapter();
  assert.strictEqual(adapter.isEnabled(), true, 'isEnabled() with legacy AI_API_KEY');
  console.log('✓ isEnabled() true with legacy AI_API_KEY');
}

function test_getModelName_default() {
  resetEnv();
  const adapter = new OpenAIAdapter();
  assert.strictEqual(adapter.getModelName(), 'gpt-4o-mini', 'default model');
  console.log('✓ getModelName() default = gpt-4o-mini');
}

function test_getModelName_from_env() {
  resetEnv();
  process.env.AI_MODEL = 'gpt-4o';
  const adapter = new OpenAIAdapter();
  assert.strictEqual(adapter.getModelName(), 'gpt-4o', 'model from env');
  console.log('✓ getModelName() reads AI_MODEL env var');
}

async function test_chat_returns_null_when_no_key() {
  resetEnv();
  const adapter = new OpenAIAdapter();
  const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
  assert.strictEqual(result, null, 'chat() returns null when no key');
  console.log('✓ chat() returns null when no key');
}

async function test_chat_returns_null_on_401() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-invalid';
  const restore = mockFetch([{ status: 401, body: { error: { message: 'Invalid API key' } } }]);
  try {
    const adapter = new OpenAIAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
    assert.strictEqual(result, null, '401 → null');
    console.log('✓ chat() returns null on 401');
  } finally {
    restore();
  }
}

async function test_chat_returns_null_on_429() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';
  const restore = mockFetch([{ status: 429, body: { error: { message: 'Rate limited' } } }]);
  try {
    const adapter = new OpenAIAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
    assert.strictEqual(result, null, '429 → null');
    console.log('✓ chat() returns null on 429');
  } finally {
    restore();
  }
}

async function test_chat_returns_content_on_200() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';
  const restore = mockFetch([{
    status: 200,
    body: {
      choices: [{ message: { content: 'Hello world' } }],
    },
  }]);
  try {
    const adapter = new OpenAIAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
    assert.strictEqual(result, 'Hello world', '200 → content string');
    console.log('✓ chat() returns content on 200');
  } finally {
    restore();
  }
}

async function test_chat_returns_null_on_network_error() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';
  const original = (global as any).fetch;
  (global as any).fetch = async () => { throw new Error('Network failure'); };
  try {
    const adapter = new OpenAIAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
    assert.strictEqual(result, null, 'network error → null');
    console.log('✓ chat() returns null on network error');
  } finally {
    (global as any).fetch = original;
  }
}

async function test_chat_retries_with_max_completion_tokens_on_o1_400() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.AI_MODEL = 'o1-mini';

  let callCount = 0;
  const original = (global as any).fetch;
  (global as any).fetch = async (_url: string, _init: RequestInit) => {
    callCount++;
    const body = JSON.parse(_init.body as string);
    if (callCount === 1) {
      // First call: 400 with max_tokens error → trigger retry
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: { message: "This model doesn't support 'max_tokens'. Use 'max_completion_tokens' instead." },
        }),
      };
    }
    // Second call: success
    assert.ok('max_completion_tokens' in body, 'retry should use max_completion_tokens');
    assert.ok(!('max_tokens' in body), 'retry should NOT have max_tokens');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Pong' } }] }),
    };
  };

  try {
    const adapter = new OpenAIAdapter();
    const result = await adapter.chat(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 100 },
    );
    assert.strictEqual(result, 'Pong', 'retry result');
    assert.strictEqual(callCount, 2, 'exactly 2 fetch calls');
    console.log('✓ chat() retries with max_completion_tokens for o1/o3 models');
  } finally {
    (global as any).fetch = original;
  }
}

async function test_json_mode_sends_response_format() {
  resetEnv();
  process.env.OPENAI_API_KEY = 'sk-test';

  let capturedBody: any = null;
  const original = (global as any).fetch;
  (global as any).fetch = async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"x":1}' } }] }),
    };
  };

  try {
    const adapter = new OpenAIAdapter();
    await adapter.chat([{ role: 'user', content: 'test' }], { json: true });
    assert.deepStrictEqual(
      capturedBody.response_format,
      { type: 'json_object' },
      'json mode sends response_format',
    );
    console.log('✓ json:true sends response_format: { type: json_object }');
  } finally {
    (global as any).fetch = original;
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const tests = [
  test_isEnabled_false_when_no_key,
  test_isEnabled_true_with_OPENAI_API_KEY,
  test_isEnabled_true_with_legacy_AI_API_KEY,
  test_getModelName_default,
  test_getModelName_from_env,
  test_chat_returns_null_when_no_key,
  test_chat_returns_null_on_401,
  test_chat_returns_null_on_429,
  test_chat_returns_content_on_200,
  test_chat_returns_null_on_network_error,
  test_chat_retries_with_max_completion_tokens_on_o1_400,
  test_json_mode_sends_response_format,
];

async function runAll() {
  let passed = 0; let failed = 0;
  console.log('\nRunning OpenAI adapter tests...\n');
  for (const t of tests) {
    try { await (t as () => Promise<void>)(); passed++; }
    catch (e: any) { console.error(`✗ ${t.name}: ${e.message}`); failed++; }
    resetEnv();
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runAll();
