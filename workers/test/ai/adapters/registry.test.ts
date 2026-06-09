/**
 * Unit tests for the provider registry (detectProviderId + resolveAdapter).
 * Uses Node built-in assert. Run with: ts-node test/ai/adapters/registry.test.ts
 */

import assert from 'assert'

// Snapshot original env so we can restore after each test
const originalEnv = { ...process.env }

function resetEnv() {
  // Remove all AI-related keys between tests
  const AI_KEYS = [
    'AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL',
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
  ]
  for (const k of AI_KEYS) delete process.env[k]
}

// Import AFTER clearing so Jest-style module caching doesn't interfere
import { detectProviderId, resolveAdapter, _resetAdapterCache } from '../../../src/ai/adapters/registry'

// ─── detectProviderId ─────────────────────────────────────────────────────────

function test_explicit_AI_PROVIDER_openai() {
  resetEnv()
  process.env.AI_PROVIDER = 'openai'
  assert.strictEqual(detectProviderId(), 'openai', 'explicit openai')
  console.log('✓ AI_PROVIDER=openai → openai')
}

function test_explicit_AI_PROVIDER_anthropic() {
  resetEnv()
  process.env.AI_PROVIDER = 'anthropic'
  assert.strictEqual(detectProviderId(), 'anthropic', 'explicit anthropic')
  console.log('✓ AI_PROVIDER=anthropic → anthropic')
}

function test_explicit_AI_PROVIDER_gemini() {
  resetEnv()
  process.env.AI_PROVIDER = 'gemini'
  assert.strictEqual(detectProviderId(), 'gemini', 'explicit gemini')
  console.log('✓ AI_PROVIDER=gemini → gemini')
}

function test_explicit_AI_PROVIDER_openrouter() {
  resetEnv()
  process.env.AI_PROVIDER = 'openrouter'
  assert.strictEqual(detectProviderId(), 'openrouter', 'explicit openrouter')
  console.log('✓ AI_PROVIDER=openrouter → openrouter')
}

function test_unknown_AI_PROVIDER_falls_back_to_detection() {
  resetEnv()
  process.env.AI_PROVIDER = 'madeup_provider'
  process.env.AI_API_KEY = 'sk-ant-test123'
  // Falls through to heuristic
  assert.strictEqual(detectProviderId(), 'anthropic', 'unknown AI_PROVIDER → heuristic')
  console.log('✓ Unknown AI_PROVIDER falls back to key heuristic')
}

function test_heuristic_anthropic_key() {
  resetEnv()
  process.env.AI_API_KEY = 'sk-ant-api03-testkey'
  assert.strictEqual(detectProviderId(), 'anthropic', 'sk-ant- → anthropic')
  console.log('✓ AI_API_KEY=sk-ant-... → anthropic (heuristic)')
}

function test_heuristic_gemini_key() {
  resetEnv()
  process.env.AI_API_KEY = 'AIzaSyBcTestKey'
  assert.strictEqual(detectProviderId(), 'gemini', 'AIza → gemini')
  console.log('✓ AI_API_KEY=AIza... → gemini (heuristic)')
}

function test_heuristic_openrouter_key() {
  resetEnv()
  process.env.AI_API_KEY = 'sk-or-v1-testkey'
  assert.strictEqual(detectProviderId(), 'openrouter', 'sk-or- → openrouter')
  console.log('✓ AI_API_KEY=sk-or-... → openrouter (heuristic)')
}

function test_heuristic_openai_key() {
  resetEnv()
  process.env.AI_API_KEY = 'sk-proj-testkey'
  assert.strictEqual(detectProviderId(), 'openai', 'sk- → openai')
  console.log('✓ AI_API_KEY=sk-proj-... → openai (heuristic)')
}

function test_provider_specific_key_without_AI_PROVIDER() {
  resetEnv()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-specific'
  assert.strictEqual(detectProviderId(), 'anthropic', 'ANTHROPIC_API_KEY → anthropic')
  console.log('✓ ANTHROPIC_API_KEY set without AI_PROVIDER → anthropic')
}

function test_gemini_specific_key_without_AI_PROVIDER() {
  resetEnv()
  process.env.GEMINI_API_KEY = 'AIza-specific'
  assert.strictEqual(detectProviderId(), 'gemini', 'GEMINI_API_KEY → gemini')
  console.log('✓ GEMINI_API_KEY set without AI_PROVIDER → gemini')
}

function test_openrouter_specific_key_without_AI_PROVIDER() {
  resetEnv()
  process.env.OPENROUTER_API_KEY = 'sk-or-specific'
  assert.strictEqual(detectProviderId(), 'openrouter', 'OPENROUTER_API_KEY → openrouter')
  console.log('✓ OPENROUTER_API_KEY set without AI_PROVIDER → openrouter')
}

function test_no_keys_defaults_to_openai() {
  resetEnv()
  assert.strictEqual(detectProviderId(), 'openai', 'no keys → openai default')
  console.log('✓ No keys set → openai (safe default)')
}

function test_AI_PROVIDER_beats_heuristic() {
  resetEnv()
  // Even though AI_API_KEY prefix would suggest anthropic...
  process.env.AI_API_KEY = 'sk-ant-test'
  // ...explicit AI_PROVIDER wins
  process.env.AI_PROVIDER = 'openai'
  assert.strictEqual(detectProviderId(), 'openai', 'explicit wins over heuristic')
  console.log('✓ Explicit AI_PROVIDER beats key heuristic')
}

// ─── resolveAdapter caching ───────────────────────────────────────────────────

function test_adapter_is_cached() {
  resetEnv()
  _resetAdapterCache()
  process.env.AI_PROVIDER = 'openai'
  const a = resolveAdapter()
  const b = resolveAdapter()
  assert.strictEqual(a, b, 'adapter should be same reference (cached)')
  _resetAdapterCache()
  console.log('✓ resolveAdapter() returns cached instance on repeated calls')
}

function test_reset_clears_cache() {
  resetEnv()
  _resetAdapterCache()
  process.env.AI_PROVIDER = 'openai'
  const a = resolveAdapter()
  _resetAdapterCache()
  process.env.AI_PROVIDER = 'anthropic'
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
  const b = resolveAdapter()
  assert.notStrictEqual(a, b, 'after reset, new adapter should differ')
  assert.strictEqual(b.id, 'anthropic', 'new adapter should be anthropic')
  _resetAdapterCache()
  console.log('✓ _resetAdapterCache() clears cache, resolves new adapter on next call')
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_explicit_AI_PROVIDER_openai,
  test_explicit_AI_PROVIDER_anthropic,
  test_explicit_AI_PROVIDER_gemini,
  test_explicit_AI_PROVIDER_openrouter,
  test_unknown_AI_PROVIDER_falls_back_to_detection,
  test_heuristic_anthropic_key,
  test_heuristic_gemini_key,
  test_heuristic_openrouter_key,
  test_heuristic_openai_key,
  test_provider_specific_key_without_AI_PROVIDER,
  test_gemini_specific_key_without_AI_PROVIDER,
  test_openrouter_specific_key_without_AI_PROVIDER,
  test_no_keys_defaults_to_openai,
  test_AI_PROVIDER_beats_heuristic,
  test_adapter_is_cached,
  test_reset_clears_cache,
]

let passed = 0, failed = 0
console.log('\nRunning registry tests...\n')
for (const t of tests) {
  try { t(); passed++ }
  catch (e: any) { console.error(`✗ ${t.name}: ${e.message}`); failed++ }
}
console.log(`\n${passed} passed, ${failed} failed\n`)
// Restore original env
Object.assign(process.env, originalEnv)
if (failed > 0) process.exit(1)
