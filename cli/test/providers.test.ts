/**
 * Unit tests for the provider registry and provider validation logic.
 * Run with: npm test (after adding a test runner)
 * These tests use Node's built-in assert module and can be run directly.
 */

import assert from 'assert';
import {
  PROVIDER_REGISTRY,
  getAllProviders,
  getProviderChoices,
  detectProviderFromModel,
  isValidModel,
  getProvider,
} from '../src/providers/registry';
import type { ProviderId } from '../src/providers/types';

// ─── Registry completeness ────────────────────────────────────────────────────

function test_all_providers_exist() {
  const expected: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter'];
  for (const id of expected) {
    assert.ok(PROVIDER_REGISTRY[id], `Provider '${id}' should exist in registry`);
  }
  console.log('✓ All 4 providers exist in registry');
}

function test_providers_have_required_fields() {
  const providers = getAllProviders();
  assert.strictEqual(providers.length, 4, 'Should have exactly 4 providers');

  for (const p of providers) {
    assert.ok(p.id, `Provider should have id`);
    assert.ok(p.displayName, `Provider '${p.id}' should have displayName`);
    assert.ok(p.envVar, `Provider '${p.id}' should have envVar`);
    assert.ok(p.keyPattern instanceof RegExp, `Provider '${p.id}' should have keyPattern as RegExp`);
    assert.ok(p.keyPatternHint, `Provider '${p.id}' should have keyPatternHint`);
    assert.ok(typeof p.freeformModel === 'boolean', `Provider '${p.id}' should have freeformModel boolean`);
    assert.ok(p.baseUrl, `Provider '${p.id}' should have baseUrl`);
    assert.ok(p.authHeader, `Provider '${p.id}' should have authHeader`);
  }
  console.log('✓ All providers have required fields');
}

function test_provider_choices_for_inquirer() {
  const choices = getProviderChoices();
  assert.strictEqual(choices.length, 4);
  for (const c of choices) {
    assert.ok(c.name, 'Choice should have name');
    assert.ok(c.value, 'Choice should have value');
  }
  console.log('✓ getProviderChoices() returns correct shape');
}

// ─── Key validation ───────────────────────────────────────────────────────────

function test_openai_key_validation() {
  const def = PROVIDER_REGISTRY.openai;
  assert.ok(def.keyPattern.test('sk-abc123'), 'sk-abc123 should be valid');
  assert.ok(def.keyPattern.test('sk-proj-EV1UalAM'), 'sk-proj-... should be valid');
  assert.ok(!def.keyPattern.test('sk-ant-abc'), 'sk-ant- should fail OpenAI pattern');
  assert.ok(!def.keyPattern.test('AIzaSomething'), 'AIza... should fail OpenAI pattern');
  assert.ok(!def.keyPattern.test(''), 'empty should fail');
  assert.ok(!def.keyPattern.test('not-a-key'), 'random string should fail');
  console.log('✓ OpenAI key validation');
}

function test_anthropic_key_validation() {
  const def = PROVIDER_REGISTRY.anthropic;
  assert.ok(def.keyPattern.test('sk-ant-api03-xxx'), 'sk-ant-... should be valid');
  assert.ok(!def.keyPattern.test('sk-proj-abc'), 'sk-proj- should fail Anthropic pattern');
  assert.ok(!def.keyPattern.test('AIzaSomething'), 'AIza should fail Anthropic pattern');
  console.log('✓ Anthropic key validation');
}

function test_gemini_key_validation() {
  const def = PROVIDER_REGISTRY.gemini;
  assert.ok(def.keyPattern.test('AIzaSyBcXyz'), 'AIza... should be valid');
  assert.ok(!def.keyPattern.test('sk-abc'), 'sk- prefix should fail Gemini');
  assert.ok(!def.keyPattern.test('sk-ant-abc'), 'sk-ant- should fail Gemini');
  console.log('✓ Gemini key validation');
}

function test_openrouter_key_validation() {
  const def = PROVIDER_REGISTRY.openrouter;
  assert.ok(def.keyPattern.test('sk-or-v1-abc'), 'sk-or-... should be valid');
  assert.ok(!def.keyPattern.test('sk-abc'), 'sk- without or- should fail');
  assert.ok(!def.keyPattern.test('sk-ant-abc'), 'sk-ant- should fail OpenRouter');
  console.log('✓ OpenRouter key validation');
}

// ─── Model detection heuristic ────────────────────────────────────────────────

function test_detect_provider_from_model() {
  assert.strictEqual(detectProviderFromModel('gpt-4o'), 'openai', 'gpt-4o → openai');
  assert.strictEqual(detectProviderFromModel('gpt-4-turbo'), 'openai', 'gpt-4-turbo → openai');
  assert.strictEqual(detectProviderFromModel('gpt-4.1-mini'), 'openai', 'gpt-4.1-mini → openai');
  assert.strictEqual(detectProviderFromModel('o1-mini'), 'openai', 'o1-mini → openai');

  assert.strictEqual(detectProviderFromModel('claude-3-5-haiku'), 'anthropic', 'claude-... → anthropic');
  assert.strictEqual(detectProviderFromModel('claude-sonnet-4'), 'anthropic', 'claude-sonnet → anthropic');

  assert.strictEqual(detectProviderFromModel('gemini-2.5-pro'), 'gemini', 'gemini-... → gemini');
  assert.strictEqual(detectProviderFromModel('gemini-1.5-flash'), 'gemini', 'gemini-1.5 → gemini');

  assert.strictEqual(detectProviderFromModel('unknown-model-xyz'), null, 'unknown → null');
  assert.strictEqual(detectProviderFromModel(''), null, 'empty → null');
  console.log('✓ detectProviderFromModel() heuristic works');
}

// ─── isValidModel ─────────────────────────────────────────────────────────────

function test_is_valid_model() {
  // OpenAI has a curated list
  assert.ok(isValidModel('openai', 'gpt-4o-mini'), 'gpt-4o-mini should be valid for openai');
  assert.ok(isValidModel('openai', 'gpt-4.1-mini'), 'gpt-4.1-mini should be valid for openai');
  assert.ok(!isValidModel('openai', 'claude-3-5-haiku'), 'claude model should NOT be valid for openai');
  assert.ok(!isValidModel('openai', 'gemini-2.5-pro'), 'gemini model should NOT be valid for openai');

  // Anthropic has a curated list
  assert.ok(isValidModel('anthropic', 'claude-sonnet-4-5'), 'claude-sonnet-4-5 valid for anthropic');
  assert.ok(!isValidModel('anthropic', 'gpt-4o'), 'gpt-4o should NOT be valid for anthropic');

  // OpenRouter is freeform — any model is valid
  assert.ok(isValidModel('openrouter', 'openai/gpt-4o-mini'), 'any model valid for openrouter');
  assert.ok(isValidModel('openrouter', 'anthropic/claude-3'), 'any model valid for openrouter');
  assert.ok(isValidModel('openrouter', 'some-random-model'), 'any model valid for openrouter');

  console.log('✓ isValidModel() respects provider boundaries');
}

// ─── getProvider ──────────────────────────────────────────────────────────────

function test_get_provider() {
  const openai = getProvider('openai');
  assert.strictEqual(openai.id, 'openai');
  assert.strictEqual(openai.displayName, 'OpenAI');

  let threw = false;
  try {
    getProvider('nonexistent' as ProviderId);
  } catch {
    threw = true;
  }
  assert.ok(threw, 'getProvider() should throw for unknown id');
  console.log('✓ getProvider() works correctly');
}

// ─── Model list completeness ───────────────────────────────────────────────────

function test_model_lists_have_recommended() {
  // Each provider with a curated list should have at least one recommended model
  const curated: ProviderId[] = ['openai', 'anthropic', 'gemini'];
  for (const id of curated) {
    const def = PROVIDER_REGISTRY[id];
    assert.ok(def.models.length > 0, `${id} should have at least one model`);
    const recommended = def.models.filter((m) => m.recommended);
    assert.ok(recommended.length >= 1, `${id} should have at least one recommended model`);
  }

  // OpenRouter should have empty static model list (freeform)
  assert.strictEqual(PROVIDER_REGISTRY.openrouter.models.length, 0, 'OpenRouter should have no static models');
  assert.ok(PROVIDER_REGISTRY.openrouter.freeformModel, 'OpenRouter should have freeformModel=true');
  console.log('✓ Model lists have recommended markers');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_all_providers_exist,
  test_providers_have_required_fields,
  test_provider_choices_for_inquirer,
  test_openai_key_validation,
  test_anthropic_key_validation,
  test_gemini_key_validation,
  test_openrouter_key_validation,
  test_detect_provider_from_model,
  test_is_valid_model,
  test_get_provider,
  test_model_lists_have_recommended,
];

let passed = 0;
let failed = 0;

console.log('\nRunning provider registry tests...\n');

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
