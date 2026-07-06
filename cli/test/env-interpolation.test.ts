/**
 * Unit tests for ${VAR} env-var substitution in config values.
 * Tests interpolateEnv() / interpolateStep() / interpolateAssertions().
 */

import assert from 'assert';
import { interpolateEnv, interpolateStep, interpolateAssertions, MissingEnvVarError } from '../src/config/interpolate';

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function test_substitutes_single_var() {
  withEnv({ TEST_PASSWORD: 'secret123' }, () => {
    const result = interpolateEnv('${TEST_PASSWORD}', 'flows[0].steps[0].value');
    assert.strictEqual(result, 'secret123');
  });
  console.log('✓ substitutes a single ${VAR}');
}

function test_substitutes_multiple_vars_in_one_string() {
  withEnv({ USER: 'alice', DOMAIN: 'example.com' }, () => {
    const result = interpolateEnv('${USER}@${DOMAIN}', 'field');
    assert.strictEqual(result, 'alice@example.com');
  });
  console.log('✓ substitutes multiple ${VAR}s in one string');
}

function test_leaves_non_templated_strings_untouched() {
  const result = interpolateEnv('plain string, no vars', 'field');
  assert.strictEqual(result, 'plain string, no vars');
  console.log('✓ leaves non-templated strings untouched');
}

function test_unset_var_throws_missing_env_var_error() {
  assert.throws(
    () => interpolateEnv('${DEFINITELY_NOT_SET_XYZ}', 'flows[0].steps[0].value'),
    (e: any) => e instanceof MissingEnvVarError && e.varName === 'DEFINITELY_NOT_SET_XYZ',
  );
  console.log('✓ unset var throws MissingEnvVarError naming the variable');
}

function test_interpolate_step_resolves_value_and_url() {
  withEnv({ BASE_PATH: '/dashboard' }, () => {
    const step = interpolateStep({ action: 'navigate', url: '${BASE_PATH}/home' }, 'flows[0].steps[0]');
    assert.strictEqual(step.url, '/dashboard/home');
  });
  console.log('✓ interpolateStep resolves ${VAR} in url');
}

function test_interpolate_assertions_resolves_value() {
  withEnv({ EXPECTED_TITLE: 'Dashboard' }, () => {
    const [assertion] = interpolateAssertions([{ type: 'title_contains', value: '${EXPECTED_TITLE}' }], 'assertions')!;
    assert.strictEqual(assertion.value, 'Dashboard');
  });
  console.log('✓ interpolateAssertions resolves ${VAR} in assertion value');
}

const tests: Array<{ name: string; fn: () => void }> = [
  { name: 'test_substitutes_single_var', fn: test_substitutes_single_var },
  { name: 'test_substitutes_multiple_vars_in_one_string', fn: test_substitutes_multiple_vars_in_one_string },
  { name: 'test_leaves_non_templated_strings_untouched', fn: test_leaves_non_templated_strings_untouched },
  { name: 'test_unset_var_throws_missing_env_var_error', fn: test_unset_var_throws_missing_env_var_error },
  { name: 'test_interpolate_step_resolves_value_and_url', fn: test_interpolate_step_resolves_value_and_url },
  { name: 'test_interpolate_assertions_resolves_value', fn: test_interpolate_assertions_resolves_value },
];

(() => {
  console.log('\nRunning env-interpolation tests...\n');
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (e: any) {
      console.error(`✗ ${t.name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
