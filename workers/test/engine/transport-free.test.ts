/**
 * Guards the engine's transport-agnostic boundary: importing src/engine must
 * never pull in Redis/BullMQ (or dotenv side effects), or local CLI mode would
 * drag Redis client code and connection attempts back in.
 */

import assert from 'assert';

// Ensure no Redis env vars are set — the engine must load without any.
delete process.env.REDIS_HOST;
delete process.env.REDIS_PORT;

import { runVerification, shutdownEngine } from '../../src/engine';

function test_engine_exports() {
  assert.strictEqual(typeof runVerification, 'function');
  assert.strictEqual(typeof shutdownEngine, 'function');
  console.log('✓ engine module loads and exports runVerification/shutdownEngine');
}

function test_no_transport_modules_loaded() {
  const loaded = Object.keys(require.cache);
  const offenders = loaded.filter(p => /node_modules[\\/](ioredis|bullmq|dotenv)[\\/]/.test(p));
  assert.deepStrictEqual(
    offenders,
    [],
    `engine import pulled in transport modules:\n${offenders.join('\n')}`,
  );
  console.log('✓ importing the engine loads no ioredis/bullmq/dotenv modules');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

const tests = [
  test_engine_exports,
  test_no_transport_modules_loaded,
];

let passed = 0;
let failed = 0;

console.log('\nRunning engine transport-boundary tests...\n');

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
