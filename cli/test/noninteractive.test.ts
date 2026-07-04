/**
 * Unit tests for non-interactive init options, config resolution, key masking,
 * and provider auto-detection.
 */

import assert from 'assert';
// We need to import the functions to test. Since some internal helper functions 
// are not exported, we can either export them from the source file or test the behavior.
// Let's modify init-noninteractive.ts to export functions we want to test.
import {
  detectProviderFromKey,
  getDefaultModel,
  maskApiKey,
  resolveConfig,
} from '../src/init-noninteractive';

const AI_ENV_VARS = [
  'VERFIX_AI_KEY', 'VERFIX_AI_PROVIDER', 'VERFIX_AI_MODEL', 'VERFIX_MODE',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
];

/** Run fn with all AI-related env vars scrubbed, restoring them afterwards. */
function withScrubbedEnv(fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const v of AI_ENV_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  try { fn(); } finally {
    for (const v of AI_ENV_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  }
}

function test_detect_provider_from_key() {
  // Test OpenAI patterns
  assert.strictEqual(detectProviderFromKey('sk-abc1234'), 'openai');
  assert.strictEqual(detectProviderFromKey('sk-proj-xyz123'), 'openai');

  // Test Anthropic patterns
  assert.strictEqual(detectProviderFromKey('sk-ant-api03-abc'), 'anthropic');

  // Test Gemini patterns
  assert.strictEqual(detectProviderFromKey('AIzaSyBcXyz'), 'gemini');
  assert.strictEqual(detectProviderFromKey('AQ.Ab123'), 'gemini');
  assert.strictEqual(detectProviderFromKey('gemini-api-key-here'), 'gemini');

  // Test OpenRouter patterns
  assert.strictEqual(detectProviderFromKey('sk-or-v1-abc'), 'openrouter');

  // Unknown patterns
  assert.strictEqual(detectProviderFromKey('invalid-key-format'), null);
  assert.strictEqual(detectProviderFromKey(''), null);

  console.log('✓ detectProviderFromKey() auto-detection matches all keys');
}

function test_get_default_model() {
  // Test default model selection per provider
  assert.strictEqual(getDefaultModel('openrouter'), 'openrouter/auto');
  assert.strictEqual(getDefaultModel('openai'), 'gpt-5.4-mini'); // recommended in registry
  assert.strictEqual(getDefaultModel('anthropic'), 'claude-sonnet-4-6'); // recommended in registry
  assert.strictEqual(getDefaultModel('gemini'), 'gemini-3.5-pro'); // recommended in registry

  console.log('✓ getDefaultModel() resolves correct defaults');
}

function test_mask_api_key() {
  // Test Anthropic pattern masking
  assert.strictEqual(maskApiKey('sk-ant-api03-abcdefg1234'), 'sk-ant-****1234');
  // Test OpenRouter
  assert.strictEqual(maskApiKey('sk-or-v1-abcdefg1234'), 'sk-or-****1234');
  // Test OpenAI
  assert.strictEqual(maskApiKey('sk-abcdefg1234'), 'sk-****1234');
  // Test Gemini
  assert.strictEqual(maskApiKey('gemini-abcdefg1234'), 'gemini-****1234');
  // Short keys
  assert.strictEqual(maskApiKey('12345'), '****');
  // Generic fallback
  assert.strictEqual(maskApiKey('AIzaSyBcXyzabcdefg1234'), 'AIza****1234');

  console.log('✓ maskApiKey() safely masks keys without leaking intermediate bytes');
}

function test_strict_needs_no_key() {
  withScrubbedEnv(() => {
    // Default mode is strict and resolves with zero credentials
    const config = resolveConfig({ yes: true });
    assert.strictEqual(config.mode, 'strict');
    assert.strictEqual(config.apiKey, '');
  });

  console.log('✓ resolveConfig() defaults to strict and needs no AI key');
}

function test_ai_modes_require_key() {
  withScrubbedEnv(() => {
    // assisted/exploratory without a key must throw
    for (const mode of ['assisted', 'exploratory']) {
      assert.throws(() => resolveConfig({ yes: true, mode }), /AI API key is required/);
    }
    // dry-run is exempt
    const dryRun = resolveConfig({ yes: true, mode: 'assisted', dryRun: true });
    assert.strictEqual(dryRun.mode, 'assisted');
  });

  console.log('✓ resolveConfig() requires an AI key only for assisted/exploratory');
}

function test_key_with_default_mode_still_configures_ai() {
  withScrubbedEnv(() => {
    // A supplied key is still picked up even though strict doesn't need it
    const config = resolveConfig({ yes: true, aiKey: 'sk-ant-api03-abc' });
    assert.strictEqual(config.mode, 'strict');
    assert.strictEqual(config.provider, 'anthropic');
    assert.strictEqual(config.apiKey, 'sk-ant-api03-abc');
  });

  console.log('✓ resolveConfig() still auto-configures AI when a key is supplied in strict mode');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_detect_provider_from_key,
  test_get_default_model,
  test_mask_api_key,
  test_strict_needs_no_key,
  test_ai_modes_require_key,
  test_key_with_default_mode_still_configures_ai,
];

let passed = 0;
let failed = 0;

console.log('\nRunning non-interactive setup unit tests...\n');

for (const t of tests) {
  try {
    t();
    passed++;
  } catch (e: any) {
    console.error(`✗ ${t.name}: ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
