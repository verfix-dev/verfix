/**
 * Unit tests for the Anthropic and Gemini adapters.
 * Focuses on the message format translation logic (no real API calls).
 * Run with: ts-node test/ai/adapters/message-format.test.ts
 */

import assert from 'assert';
import { AnthropicAdapter } from '../../../src/ai/adapters/anthropic';
import { GeminiAdapter } from '../../../src/ai/adapters/gemini';

// ─── fetch mock ───────────────────────────────────────────────────────────────

function mockFetch(
  handler: (url: string, init: RequestInit) => Promise<{ status: number; body: unknown }>,
): () => void {
  const original = (global as any).fetch;
  (global as any).fetch = async (url: string, init: RequestInit) => {
    const { status, body } = await handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
      json: async () => body,
    };
  };
  return () => { (global as any).fetch = original; };
}

// ─── env helpers ──────────────────────────────────────────────────────────────

const AI_KEYS = [
  'AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL',
  'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
];

function resetEnv() {
  for (const k of AI_KEYS) delete process.env[k];
}

// ─── Anthropic tests ──────────────────────────────────────────────────────────

async function test_anthropic_extracts_system_message() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return { status: 200, body: { content: [{ type: 'text', text: 'Hi!' }] } };
  });

  try {
    const adapter = new AnthropicAdapter();
    await adapter.chat([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
    ]);

    assert.strictEqual(capturedBody.system, 'You are a helpful assistant.', 'system extracted');
    assert.ok(
      capturedBody.messages.every((m: any) => m.role !== 'system'),
      'no system role in messages array',
    );
    assert.strictEqual(capturedBody.messages.length, 1, 'only user message in messages');
    assert.strictEqual(capturedBody.messages[0].role, 'user');
    console.log('✓ Anthropic: system message extracted to top-level system field');
  } finally {
    restore();
  }
}

async function test_anthropic_multiple_system_messages_joined() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return { status: 200, body: { content: [{ type: 'text', text: 'OK' }] } };
  });

  try {
    const adapter = new AnthropicAdapter();
    await adapter.chat([
      { role: 'system', content: 'Rule 1: be concise.' },
      { role: 'system', content: 'Rule 2: be accurate.' },
      { role: 'user', content: 'Tell me about AI.' },
    ]);

    assert.ok(capturedBody.system.includes('Rule 1'), 'first system joined');
    assert.ok(capturedBody.system.includes('Rule 2'), 'second system joined');
    console.log('✓ Anthropic: multiple system messages joined with newline');
  } finally {
    restore();
  }
}

async function test_anthropic_json_mode_injects_instruction() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return { status: 200, body: { content: [{ type: 'text', text: '{"x":1}' }] } };
  });

  try {
    const adapter = new AnthropicAdapter();
    await adapter.chat(
      [{ role: 'user', content: 'Give me data.' }],
      { json: true },
    );

    const lastUserMsg = capturedBody.messages[capturedBody.messages.length - 1];
    assert.strictEqual(lastUserMsg.role, 'user');
    assert.ok(
      lastUserMsg.content.includes('valid JSON only'),
      'JSON instruction injected into last user message',
    );
    assert.ok(
      !('response_format' in capturedBody),
      'Anthropic should NOT have response_format field',
    );
    console.log('✓ Anthropic: json:true injects JSON instruction (no response_format)');
  } finally {
    restore();
  }
}

async function test_anthropic_returns_text_from_content_array() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  const restore = mockFetch(async () => ({
    status: 200,
    body: { content: [{ type: 'text', text: 'Hello from Claude!' }] },
  }));

  try {
    const adapter = new AnthropicAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(result, 'Hello from Claude!', 'extracts text from content array');
    console.log('✓ Anthropic: extracts text from content[].text');
  } finally {
    restore();
  }
}

async function test_anthropic_returns_null_on_529() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  const restore = mockFetch(async () => ({
    status: 529,
    body: { error: { message: 'Overloaded' } },
  }));

  try {
    const adapter = new AnthropicAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(result, null, '529 → null');
    console.log('✓ Anthropic: returns null on 529 overload');
  } finally {
    restore();
  }
}

async function test_anthropic_returns_null_when_no_key() {
  resetEnv();
  const adapter = new AnthropicAdapter();
  const result = await adapter.chat([{ role: 'user', content: 'test' }]);
  assert.strictEqual(result, null, 'no key → null');
  console.log('✓ Anthropic: returns null when no key');
}

async function test_anthropic_uses_max_tokens_required_field() {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } };
  });

  try {
    const adapter = new AnthropicAdapter();
    await adapter.chat([{ role: 'user', content: 'Hi' }]);
    // max_tokens must always be present (Anthropic requires it)
    assert.ok('max_tokens' in capturedBody, 'max_tokens is always sent to Anthropic');
    assert.strictEqual(capturedBody.max_tokens, 1024, 'default max_tokens = 1024');
    console.log('✓ Anthropic: max_tokens always sent (required field), default = 1024');
  } finally {
    restore();
  }
}

// ─── Gemini tests ─────────────────────────────────────────────────────────────

async function test_gemini_translates_assistant_to_model_role() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }] },
    };
  });

  try {
    const adapter = new GeminiAdapter();
    await adapter.chat([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ]);

    const roles = capturedBody.contents.map((m: any) => m.role);
    assert.ok(!roles.includes('assistant'), 'no assistant role in Gemini request');
    assert.ok(roles.includes('model'), 'model role present');
    console.log('✓ Gemini: assistant → model role translation');
  } finally {
    restore();
  }
}

async function test_gemini_prepends_system_to_first_user_message() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    };
  });

  try {
    const adapter = new GeminiAdapter();
    await adapter.chat([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Tell me about AI.' },
    ]);

    // System content should be prepended to first user message
    const firstMsg = capturedBody.contents[0];
    assert.strictEqual(firstMsg.role, 'user', 'first message is user');
    assert.ok(
      firstMsg.parts[0].text.startsWith('Be concise.'),
      'system content prepended to first user message',
    );
    assert.ok(
      firstMsg.parts[0].text.includes('Tell me about AI.'),
      'user content preserved after system',
    );
    // No 'system' role in contents
    const systemRoles = capturedBody.contents.filter((m: any) => m.role === 'system');
    assert.strictEqual(systemRoles.length, 0, 'no system role in Gemini contents');
    console.log('✓ Gemini: system message prepended to first user message');
  } finally {
    restore();
  }
}

async function test_gemini_json_mode_sets_responseMimeType() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-test';

  let capturedBody: any = null;
  const restore = mockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body as string);
    return {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: '{"x":1}' }] } }] },
    };
  });

  try {
    const adapter = new GeminiAdapter();
    await adapter.chat([{ role: 'user', content: 'test' }], { json: true });

    assert.strictEqual(
      capturedBody.generationConfig.responseMimeType,
      'application/json',
      'json mode sets responseMimeType',
    );
    console.log('✓ Gemini: json:true sets generationConfig.responseMimeType = application/json');
  } finally {
    restore();
  }
}

async function test_gemini_api_key_is_query_param() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-myKey123';

  let capturedUrl = '';
  const original = (global as any).fetch;
  (global as any).fetch = async (url: string, _init: RequestInit) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    };
  };

  try {
    const adapter = new GeminiAdapter();
    await adapter.chat([{ role: 'user', content: 'Hi' }]);
    assert.ok(capturedUrl.includes('?key='), 'key is a query param');
    assert.ok(capturedUrl.includes('AIza-myKey123'), 'correct key in URL');
    console.log('✓ Gemini: API key sent as query parameter (not auth header)');
  } finally {
    (global as any).fetch = original;
  }
}

async function test_gemini_extracts_text_from_candidates() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-test';

  const restore = mockFetch(async () => ({
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: 'Hello from Gemini!' }] } }] },
  }));

  try {
    const adapter = new GeminiAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(result, 'Hello from Gemini!', 'text extracted from candidates');
    console.log('✓ Gemini: extracts text from candidates[0].content.parts[0].text');
  } finally {
    restore();
  }
}

async function test_gemini_returns_null_on_invalid_key() {
  resetEnv();
  process.env.GEMINI_API_KEY = 'AIza-bad';

  const restore = mockFetch(async () => ({
    status: 400,
    body: { error: { status: 'API_KEY_INVALID', message: 'Invalid API key' } },
  }));

  try {
    const adapter = new GeminiAdapter();
    const result = await adapter.chat([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(result, null, '400 API_KEY_INVALID → null');
    console.log('✓ Gemini: returns null on API_KEY_INVALID (400)');
  } finally {
    restore();
  }
}

async function test_gemini_returns_null_when_no_key() {
  resetEnv();
  const adapter = new GeminiAdapter();
  const result = await adapter.chat([{ role: 'user', content: 'test' }]);
  assert.strictEqual(result, null, 'no key → null');
  console.log('✓ Gemini: returns null when no key');
}

async function test_gemini_default_model() {
  resetEnv();
  const adapter = new GeminiAdapter();
  assert.strictEqual(adapter.getModelName(), 'gemini-3.5-flash', 'default Gemini model');
  console.log('✓ Gemini: default model = gemini-3.5-flash');
}

// ─── Run all ──────────────────────────────────────────────────────────────────

const tests = [
  // Anthropic
  test_anthropic_extracts_system_message,
  test_anthropic_multiple_system_messages_joined,
  test_anthropic_json_mode_injects_instruction,
  test_anthropic_returns_text_from_content_array,
  test_anthropic_returns_null_on_529,
  test_anthropic_returns_null_when_no_key,
  test_anthropic_uses_max_tokens_required_field,
  // Gemini
  test_gemini_translates_assistant_to_model_role,
  test_gemini_prepends_system_to_first_user_message,
  test_gemini_json_mode_sets_responseMimeType,
  test_gemini_api_key_is_query_param,
  test_gemini_extracts_text_from_candidates,
  test_gemini_returns_null_on_invalid_key,
  test_gemini_returns_null_when_no_key,
  test_gemini_default_model,
];

async function runAll() {
  let passed = 0; let failed = 0;
  console.log('\nRunning Anthropic + Gemini adapter tests...\n');
  for (const t of tests) {
    try { await (t as () => Promise<void>)(); passed++; }
    catch (e: any) { console.error(`✗ ${t.name}: ${e.message}`); failed++; }
    resetEnv();
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runAll();
