/**
 * Unit tests for the AI rate-limit circuit breaker: opens after consecutive
 * 429s, short-circuits chatCompletion, resets per run, and a success in
 * between clears the streak.
 *
 * Run with: ts-node test/ai/circuit-breaker.test.ts
 */

import assert from 'assert';
import {
  reportRateLimit, reportAISuccess, reportAIOutcome, isAIBreakerOpen, resetAIBreaker,
} from '../../src/ai/circuit-breaker';

function test_opens_after_three_consecutive_429s() {
  resetAIBreaker();
  reportRateLimit('Gemini');
  reportRateLimit('Gemini');
  assert.strictEqual(isAIBreakerOpen(), false, 'two 429s should not open the breaker');
  reportRateLimit('Gemini');
  assert.strictEqual(isAIBreakerOpen(), true, 'three consecutive 429s should open the breaker');
  console.log('✓ breaker opens after 3 consecutive rate-limit reports');
}

function test_success_resets_the_streak() {
  resetAIBreaker();
  reportRateLimit('OpenAI');
  reportRateLimit('OpenAI');
  reportAISuccess();
  reportRateLimit('OpenAI');
  reportRateLimit('OpenAI');
  assert.strictEqual(isAIBreakerOpen(), false, 'a success between 429s should reset the streak');
  console.log('✓ a successful AI call resets the consecutive-429 streak');
}

function test_reset_closes_an_open_breaker() {
  resetAIBreaker();
  reportRateLimit('Anthropic');
  reportRateLimit('Anthropic');
  reportRateLimit('Anthropic');
  assert.strictEqual(isAIBreakerOpen(), true);
  resetAIBreaker();
  assert.strictEqual(isAIBreakerOpen(), false, 'per-run reset must close the breaker');
  console.log('✓ resetAIBreaker closes an open breaker (per-run isolation)');
}

function test_opens_after_three_consecutive_failures_of_any_kind() {
  resetAIBreaker();
  reportAIOutcome(false, 100); // 5xx, timeout, invalid key — provider layer can't tell
  reportAIOutcome(false, 100);
  assert.strictEqual(isAIBreakerOpen(), false, 'two failures should not open the breaker');
  reportAIOutcome(false, 100);
  assert.strictEqual(isAIBreakerOpen(), true, 'three consecutive failures should open the breaker');
  console.log('✓ breaker opens after 3 consecutive non-429 failures (5xx/timeout)');
}

function test_success_outcome_resets_failure_streak() {
  resetAIBreaker();
  reportAIOutcome(false, 100);
  reportAIOutcome(false, 100);
  reportAIOutcome(true, 100);
  reportAIOutcome(false, 100);
  reportAIOutcome(false, 100);
  assert.strictEqual(isAIBreakerOpen(), false, 'a success between failures should reset the streak');
  console.log('✓ a successful outcome resets the consecutive-failure streak');
}

function test_opens_when_time_budget_exhausted_even_on_success() {
  resetAIBreaker();
  reportAIOutcome(true, 25000); // one slow-but-successful call past the 20s default budget
  assert.strictEqual(isAIBreakerOpen(), true, 'exhausted time budget should open the breaker even when calls succeed');
  resetAIBreaker();
  assert.strictEqual(isAIBreakerOpen(), false, 'per-run reset must also reset the spent budget');
  reportAIOutcome(true, 1000);
  assert.strictEqual(isAIBreakerOpen(), false, 'fresh run starts with a fresh budget');
  console.log('✓ the per-run AI time budget opens the breaker regardless of call success');
}

async function test_chat_completion_short_circuits_when_open() {
  resetAIBreaker();
  reportRateLimit('x'); reportRateLimit('x'); reportRateLimit('x');
  // No API key is configured in tests, but an open breaker must return null
  // before the adapter is even consulted — this must not hang or throw.
  const { chatCompletion } = await import('../../src/ai/provider');
  const res = await chatCompletion([{ role: 'user', content: 'hi' }]);
  assert.strictEqual(res, null, 'open breaker should short-circuit to null');
  console.log('✓ chatCompletion short-circuits to null while the breaker is open');
  resetAIBreaker();
}

(async () => {
  console.log('\nRunning circuit-breaker tests...\n');
  let passed = 0;
  let failed = 0;
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [
    { name: 'test_opens_after_three_consecutive_429s', fn: test_opens_after_three_consecutive_429s },
    { name: 'test_success_resets_the_streak', fn: test_success_resets_the_streak },
    { name: 'test_reset_closes_an_open_breaker', fn: test_reset_closes_an_open_breaker },
    { name: 'test_opens_after_three_consecutive_failures_of_any_kind', fn: test_opens_after_three_consecutive_failures_of_any_kind },
    { name: 'test_success_outcome_resets_failure_streak', fn: test_success_outcome_resets_failure_streak },
    { name: 'test_opens_when_time_budget_exhausted_even_on_success', fn: test_opens_when_time_budget_exhausted_even_on_success },
    { name: 'test_chat_completion_short_circuits_when_open', fn: test_chat_completion_short_circuits_when_open },
  ];
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
