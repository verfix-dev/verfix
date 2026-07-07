/**
 * AI rate-limit circuit breaker.
 *
 * Under persistent 429s (e.g. an exhausted free-tier key) every AI call —
 * self-healing per step, post-failure analysis — would otherwise retry, fail,
 * and log on its own, adding latency and noise to a run whose deterministic
 * fallback already works. After N consecutive rate-limit responses the breaker
 * opens and chatCompletion() short-circuits to null (the normal "AI
 * unavailable" signal) for the remainder of the run.
 *
 * State is per-run: the engine resets it at the start of every verification,
 * so a long-lived server worker never carries an open breaker across jobs.
 */

const CONSECUTIVE_429_THRESHOLD = 3;

let consecutive429 = 0;
let open = false;

export function reportRateLimit(provider: string): void {
  if (open) return;
  consecutive429++;
  if (consecutive429 >= CONSECUTIVE_429_THRESHOLD) {
    open = true;
    console.warn(
      `  ⚠ AI disabled for the rest of this run: ${consecutive429} consecutive rate-limit responses from ${provider}. ` +
      'Continuing with deterministic behavior only.',
    );
  }
}

export function reportAISuccess(): void {
  consecutive429 = 0;
}

export function isAIBreakerOpen(): boolean {
  return open;
}

/** Reset per-run state. Called by the engine at the start of every verification. */
export function resetAIBreaker(): void {
  consecutive429 = 0;
  open = false;
}
