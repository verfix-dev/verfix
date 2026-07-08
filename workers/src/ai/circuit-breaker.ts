/**
 * AI circuit breaker: keeps a misbehaving AI provider off the critical path.
 *
 * Ways it opens, all per-run:
 *   1. Consecutive 429s (e.g. an exhausted free-tier key), reported by the
 *      adapters via reportRateLimit().
 *   2. Consecutive failures of any kind — 5xx storms, request timeouts,
 *      invalid keys — reported by the provider layer via reportAIOutcome().
 *   3. Time budget — AI calls (healing included) share a per-run wall-clock
 *      budget (AI_TIME_BUDGET_MS, default 20s). Once spent, further calls
 *      short-circuit: a slow-but-succeeding provider must not double a run's
 *      duration for marginal healing value.
 *
 * Without it every AI call — self-healing per step, post-failure analysis —
 * would retry, fail, and log on its own, adding latency and noise to a run
 * whose deterministic fallback already works. When open, chatCompletion()
 * short-circuits to null (the normal "AI unavailable" signal) for the
 * remainder of the run.
 *
 * State is per-run: the engine resets it at the start of every verification,
 * so a long-lived server worker never carries an open breaker across jobs.
 */

const CONSECUTIVE_429_THRESHOLD = 3;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const AI_TIME_BUDGET_MS = parseInt(process.env.AI_TIME_BUDGET_MS || '20000');

let consecutive429 = 0;
let consecutiveFailures = 0;
let timeSpentMs = 0;
let open = false;

function openBreaker(reason: string): void {
  if (open) return;
  open = true;
  console.warn(`  ⚠ AI disabled for the rest of this run: ${reason}. Continuing with deterministic behavior only.`);
}

export function reportRateLimit(provider: string): void {
  if (open) return;
  consecutive429++;
  if (consecutive429 >= CONSECUTIVE_429_THRESHOLD) {
    openBreaker(`${consecutive429} consecutive rate-limit responses from ${provider}`);
  }
}

/** Called by the provider layer after every AI call with its result + duration.
 *  Catches what reportRateLimit can't: 5xx storms, timeouts, invalid keys, and
 *  a slow provider eating the run's AI time budget. */
export function reportAIOutcome(ok: boolean, elapsedMs: number): void {
  timeSpentMs += elapsedMs;
  if (ok) {
    reportAISuccess();
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      openBreaker(`${consecutiveFailures} consecutive AI failures (rate limit, server error, or timeout)`);
    }
  }
  if (timeSpentMs >= AI_TIME_BUDGET_MS) {
    openBreaker(`AI time budget exhausted (${Math.round(timeSpentMs / 1000)}s spent of ${Math.round(AI_TIME_BUDGET_MS / 1000)}s — set AI_TIME_BUDGET_MS to allow more)`);
  }
}

export function reportAISuccess(): void {
  consecutive429 = 0;
  consecutiveFailures = 0;
}

export function isAIBreakerOpen(): boolean {
  return open;
}

/** Reset per-run state. Called by the engine at the start of every verification. */
export function resetAIBreaker(): void {
  consecutive429 = 0;
  consecutiveFailures = 0;
  timeSpentMs = 0;
  open = false;
}
