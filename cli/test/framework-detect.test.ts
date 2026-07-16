/**
 * Unit tests for framework-aware init (Roadmap Phase 5): framework detection
 * from package.json, and how it feeds into resolveConfig's base URL/flow
 * scaffolding defaults.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectFramework } from '../src/framework-detect';
import { resolveConfig } from '../src/init-noninteractive';

const AI_ENV_VARS = [
  'VERFIX_AI_KEY', 'VERFIX_AI_PROVIDER', 'VERFIX_AI_MODEL', 'VERFIX_MODE', 'VERFIX_BASE_URL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
];

/** Run fn with all AI/base-url env vars scrubbed, restoring them afterwards. */
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

/** Create a throwaway dir with the given package.json contents. */
function makeProjectDir(pkg: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-framework-test-'));
  if (pkg) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8');
  }
  return dir;
}

function test_detects_nextjs() {
  const dir = makeProjectDir({ dependencies: { next: '14.0.0', react: '18.0.0' } });
  try {
    const detected = detectFramework(dir);
    assert.ok(detected, 'expected Next.js to be detected');
    assert.strictEqual(detected!.name, 'Next.js');
    assert.strictEqual(detected!.defaultUrl, 'http://localhost:3000');
    assert.strictEqual(detected!.scaffoldFlow.steps[0].url, '/');
    const assertionTypes = detected!.scaffoldFlow.assertions.map((a) => a.type);
    assert.ok(assertionTypes.includes('page_loaded'));
    assert.ok(assertionTypes.includes('no_console_errors'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✓ detectFramework() detects Next.js from dependencies.next');
}

function test_detects_vite_from_dev_dependencies() {
  const dir = makeProjectDir({ devDependencies: { vite: '5.0.0' } });
  try {
    const detected = detectFramework(dir);
    assert.ok(detected, 'expected Vite to be detected');
    assert.strictEqual(detected!.name, 'Vite');
    assert.strictEqual(detected!.defaultUrl, 'http://localhost:5173');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✓ detectFramework() detects Vite from devDependencies.vite');
}

function test_unknown_framework_returns_null() {
  const dir = makeProjectDir({ dependencies: { express: '4.0.0' } });
  try {
    assert.strictEqual(detectFramework(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✓ detectFramework() returns null for an unrecognized dependency set');
}

function test_missing_package_json_returns_null() {
  const dir = makeProjectDir(null);
  try {
    assert.strictEqual(detectFramework(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✓ detectFramework() returns null when package.json is missing');
}

function test_malformed_package_json_returns_null() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-framework-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json', 'utf-8');
    assert.strictEqual(detectFramework(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('✓ detectFramework() returns null (not throw) for malformed package.json');
}

function test_resolveConfig_defaults_baseurl_from_detected_framework() {
  withScrubbedEnv(() => {
    const dir = makeProjectDir({ dependencies: { next: '14.0.0' } });
    try {
      const config = resolveConfig({ yes: true }, dir);
      assert.strictEqual(config.baseUrl, 'http://localhost:3000');
      assert.ok(config.framework);
      assert.strictEqual(config.framework!.name, 'Next.js');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log('✓ resolveConfig() defaults baseUrl to the detected framework\'s conventional URL');
}

function test_resolveConfig_explicit_baseurl_wins_over_detection() {
  withScrubbedEnv(() => {
    const dir = makeProjectDir({ devDependencies: { vite: '5.0.0' } });
    try {
      const config = resolveConfig({ yes: true, baseUrl: 'http://localhost:9999' }, dir);
      assert.strictEqual(config.baseUrl, 'http://localhost:9999');
      // Detection still runs (so the scaffold flow is still available) even
      // though the URL default was overridden.
      assert.ok(config.framework);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log('✓ resolveConfig() lets an explicit --base-url win over framework detection');
}

function test_resolveConfig_env_var_wins_over_detection() {
  withScrubbedEnv(() => {
    process.env.VERFIX_BASE_URL = 'http://localhost:8888';
    const dir = makeProjectDir({ dependencies: { next: '14.0.0' } });
    try {
      const config = resolveConfig({ yes: true }, dir);
      assert.strictEqual(config.baseUrl, 'http://localhost:8888');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log('✓ resolveConfig() lets VERFIX_BASE_URL win over framework detection');
}

function test_resolveConfig_no_framework_behaves_as_today() {
  withScrubbedEnv(() => {
    const dir = makeProjectDir({ dependencies: { express: '4.0.0' } });
    try {
      const config = resolveConfig({ yes: true }, dir);
      assert.strictEqual(config.baseUrl, 'http://localhost:3000');
      assert.strictEqual(config.framework, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log('✓ resolveConfig() falls back to today\'s default when no framework is detected');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_detects_nextjs,
  test_detects_vite_from_dev_dependencies,
  test_unknown_framework_returns_null,
  test_missing_package_json_returns_null,
  test_malformed_package_json_returns_null,
  test_resolveConfig_defaults_baseurl_from_detected_framework,
  test_resolveConfig_explicit_baseurl_wins_over_detection,
  test_resolveConfig_env_var_wins_over_detection,
  test_resolveConfig_no_framework_behaves_as_today,
];

let passed = 0;
let failed = 0;

console.log('\nRunning framework-detect unit tests...\n');

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
