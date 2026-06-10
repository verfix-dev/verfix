/**
 * Unit tests for config migration logic.
 * Tests the detectLegacyConfig() and migrateLegacyEnv() functions.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectLegacyConfig, migrateLegacyEnv } from '../src/config/migration';
import { loadAIConfig, saveAIConfig, parseEnvFile, updateAIConfigInFile } from '../src/config/loader';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-test-'));
}

function writeEnvFile(dir: string, content: string): void {
  const envDir = path.join(dir, '.verfix');
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(path.join(envDir, '.env'), content, 'utf-8');
}

function writeConfigFile(dir: string, content: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'verfix.config.json'), JSON.stringify(content, null, 2), 'utf-8');
}

// ─── detectLegacyConfig ───────────────────────────────────────────────────────

function test_no_env_file_returns_not_migrated() {
  const tmpDir = makeTempDir();
  try {
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, false, 'No env file → not migrated');
    console.log('✓ No env file → not migrated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_new_format_returns_not_migrated() {
  const tmpDir = makeTempDir();
  try {
    // New format: has AI_PROVIDER
    writeEnvFile(tmpDir, 'AI_PROVIDER=openai\nOPENAI_API_KEY=sk-abc\nAI_MODEL=gpt-4o\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, false, 'New format (has AI_PROVIDER) → not migrated');
    console.log('✓ New format env file → not migrated');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_legacy_openai_model_detects_openai() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=sk-proj-abc123\nAI_MODEL=gpt-4o-mini\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, true, 'Should detect legacy format');
    assert.strictEqual(result.provider, 'openai', 'gpt-4o-mini → openai');
    assert.strictEqual(result.model, 'gpt-4o-mini');
    assert.strictEqual(result.apiKey, 'sk-proj-abc123');
    assert.ok(result.notice, 'Should have a notice');
    console.log('✓ Legacy OpenAI model → detects openai provider');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_legacy_anthropic_model_detects_anthropic() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=sk-ant-abc123\nAI_MODEL=claude-sonnet-4-5\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.provider, 'anthropic', 'claude-... → anthropic');
    console.log('✓ Legacy Anthropic model → detects anthropic provider');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_legacy_gemini_model_detects_gemini() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=AIzaSyBcXyz\nAI_MODEL=gemini-2.5-pro\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.provider, 'gemini', 'gemini-... → gemini');
    console.log('✓ Legacy Gemini model → detects gemini provider');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_legacy_unknown_model_returns_null_provider() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=some-key\nAI_MODEL=some-unknown-model\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, true, 'Should detect legacy format even with unknown model');
    assert.strictEqual(result.provider, undefined, 'Unknown model → provider undefined');
    console.log('✓ Legacy unknown model → provider undefined, migration still flagged');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_legacy_no_model_returns_null_provider() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=sk-proj-abc\n');
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.provider, undefined);
    assert.strictEqual(result.model, undefined);
    console.log('✓ Legacy key with no model → provider undefined');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

// ─── migrateLegacyEnv ─────────────────────────────────────────────────────────

function test_migrate_legacy_env_writes_new_format() {
  const tmpDir = makeTempDir();
  try {
    // Start with old format
    writeEnvFile(tmpDir, 'AI_API_KEY=sk-proj-abc\nAI_MODEL=gpt-4o\n');

    migrateLegacyEnv(tmpDir, 'openai', 'sk-proj-abc', 'gpt-4o', 'OPENAI_API_KEY');

    const env = parseEnvFile(tmpDir);
    assert.strictEqual(env['AI_PROVIDER'], 'openai', 'Should write AI_PROVIDER');
    assert.strictEqual(env['OPENAI_API_KEY'], 'sk-proj-abc', 'Should write provider-specific key');
    assert.strictEqual(env['AI_MODEL'], 'gpt-4o', 'Should preserve AI_MODEL');
    assert.strictEqual(env['AI_API_KEY'], undefined, 'Should NOT have old AI_API_KEY');
    console.log('✓ migrateLegacyEnv() writes new format correctly');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_after_migration_no_longer_detected_as_legacy() {
  const tmpDir = makeTempDir();
  try {
    writeEnvFile(tmpDir, 'AI_API_KEY=sk-proj-abc\nAI_MODEL=gpt-4o\n');
    migrateLegacyEnv(tmpDir, 'openai', 'sk-proj-abc', 'gpt-4o', 'OPENAI_API_KEY');

    // After migration, should no longer be detected as legacy
    const result = detectLegacyConfig(tmpDir);
    assert.strictEqual(result.migrated, false, 'After migration → not detected as legacy');
    console.log('✓ After migration → no longer detected as legacy');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

// ─── loadAIConfig / saveAIConfig ──────────────────────────────────────────────

function test_save_and_load_ai_config() {
  const tmpDir = makeTempDir();
  try {
    saveAIConfig(tmpDir, 'anthropic', 'claude-sonnet-4-5', 'sk-ant-test123');

    const config = loadAIConfig(tmpDir);
    assert.ok(config, 'Should load AI config');
    assert.strictEqual(config!.provider, 'anthropic');
    assert.strictEqual(config!.model, 'claude-sonnet-4-5');

    const env = parseEnvFile(tmpDir);
    assert.strictEqual(env['AI_PROVIDER'], 'anthropic');
    assert.strictEqual(env['ANTHROPIC_API_KEY'], 'sk-ant-test123');
    assert.strictEqual(env['AI_MODEL'], 'claude-sonnet-4-5');
    console.log('✓ saveAIConfig() / loadAIConfig() round-trip works');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_load_ai_config_no_env_returns_null() {
  const tmpDir = makeTempDir();
  try {
    const config = loadAIConfig(tmpDir);
    assert.strictEqual(config, null, 'No env file → null');
    console.log('✓ loadAIConfig() returns null when no env file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

// ─── updateAIConfigInFile ─────────────────────────────────────────────────────

function test_update_ai_block_in_config_file() {
  const tmpDir = makeTempDir();
  const configPath = path.join(tmpDir, 'verfix.config.json');
  try {
    // Existing config without ai block
    writeConfigFile(tmpDir, { baseUrl: 'http://localhost:3000', mode: 'assisted', flows: [] });

    updateAIConfigInFile(configPath, 'gemini', 'gemini-2.5-pro');

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepStrictEqual(updated.ai, { provider: 'gemini', model: 'gemini-2.5-pro' });
    assert.strictEqual(updated.baseUrl, 'http://localhost:3000', 'baseUrl should be preserved');
    assert.deepStrictEqual(updated.flows, [], 'flows should be preserved');
    console.log('✓ updateAIConfigInFile() adds ai block without overwriting other fields');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function test_update_ai_block_overwrites_existing_ai() {
  const tmpDir = makeTempDir();
  const configPath = path.join(tmpDir, 'verfix.config.json');
  try {
    writeConfigFile(tmpDir, { ai: { provider: 'openai', model: 'gpt-4o' }, flows: [] });

    updateAIConfigInFile(configPath, 'anthropic', 'claude-sonnet-4-5');

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepStrictEqual(updated.ai, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
    assert.deepStrictEqual(updated.flows, []);
    console.log('✓ updateAIConfigInFile() overwrites existing ai block');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_no_env_file_returns_not_migrated,
  test_new_format_returns_not_migrated,
  test_legacy_openai_model_detects_openai,
  test_legacy_anthropic_model_detects_anthropic,
  test_legacy_gemini_model_detects_gemini,
  test_legacy_unknown_model_returns_null_provider,
  test_legacy_no_model_returns_null_provider,
  test_migrate_legacy_env_writes_new_format,
  test_after_migration_no_longer_detected_as_legacy,
  test_save_and_load_ai_config,
  test_load_ai_config_no_env_returns_null,
  test_update_ai_block_in_config_file,
  test_update_ai_block_overwrites_existing_ai,
];

let passed = 0;
let failed = 0;

console.log('\nRunning config migration tests...\n');

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
