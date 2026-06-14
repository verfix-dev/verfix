import { Page } from 'playwright';

// ─── Error Classification ─────────────────────────────────────────────────────
//
// Errors are classified into categories that drive two systems:
//
// 1. **Retry logic** (this module): Transient errors trigger automatic retries
//    with exponential backoff. Deterministic errors fail immediately.
//
// 2. **Flaky detection** (api/main.go handleFlaky): The backend considers a URL
//    "flaky" only when its failed executions show *diverse* error signatures.
//    If every failure has the same error_message, the failures are deterministic
//    (consistent bug or infrastructure issue) — NOT flaky.
//
// Error Categories:
//
// • TRANSIENT – Infrastructure/network issues that may self-resolve. These are
//   retried automatically. When the same transient error occurs consistently
//   across all failures for a URL, the backend correctly identifies it as a
//   deterministic infrastructure problem (not flaky).
//
// • DETERMINISTIC – Errors that indicate a real bug or permanent configuration
//   issue. These are NOT retried because repeating the same action will produce
//   the same result.
//
// • UNKNOWN – Unclassified errors. These are not retried by default but their
//   error_message is stored so the flaky detection system can compare them.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Transient errors that may self-resolve on retry.
 * These represent infrastructure-level issues, not application bugs.
 */
const RETRYABLE_ERRORS = [
  'Navigation timeout',       // Slow server or network hiccup
  'Target closed',            // Browser tab/context crashed unexpectedly
  'net::ERR_CONNECTION_REFUSED', // Server temporarily unreachable
  'net::ERR_ABORTED',         // Request cancelled by browser/network
] as const;

/**
 * Deterministic errors that will never self-resolve. Retrying these is
 * wasteful — they indicate a real bug, misconfiguration, or permanent state.
 */
const DETERMINISTIC_ERRORS = [
  'net::ERR_NAME_NOT_RESOLVED', // DNS failure — domain doesn't exist
  'net::ERR_CERT_',             // SSL certificate errors (prefix match)
  'net::ERR_SSL_',              // SSL protocol errors (prefix match)
  'Execution context was destroyed', // Page navigated away during action
] as const;

export type ErrorCategory = 'transient' | 'deterministic' | 'unknown';

/**
 * Classify an error by its message to determine retry and flaky behavior.
 *
 * - `transient`: The error is retryable and may self-resolve.
 * - `deterministic`: The error indicates a permanent failure; do not retry.
 * - `unknown`: Unclassified. Stored as-is for flaky detection comparison.
 */
export function classifyError(error: Error): ErrorCategory {
  const msg = error.message;
  if (RETRYABLE_ERRORS.some(pattern => msg.includes(pattern))) {
    return 'transient';
  }
  if (DETERMINISTIC_ERRORS.some(pattern => msg.includes(pattern))) {
    return 'deterministic';
  }
  return 'unknown';
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export function isRetryable(error: Error): boolean {
  return classifyError(error) === 'transient';
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
): Promise<{ result: T; retryCount: number }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (e: any) {
      lastError = e;
      if (attempt < policy.maxRetries && isRetryable(e)) {
        const wait = policy.backoffMs * Math.pow(2, attempt);
        console.warn(`  Attempt ${attempt + 1} failed (${e.message}). Retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

/**
 * Wait for DOM to stabilize (no mutations for 500ms) instead of a fixed timeout.
 */
export async function waitForStableDOM(page: Page, stabilityMs = 500, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (stabilityMs: number) => {
      return new Promise<boolean>(resolve => {
        let timer: ReturnType<typeof setTimeout> = setTimeout(() => resolve(true), stabilityMs);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => resolve(true), stabilityMs);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      });
    },
    stabilityMs,
    { timeout },
  ).catch(() => {
    // If DOM never stabilizes within timeout, continue anyway
    console.warn('DOM did not stabilize within timeout, continuing...');
  });
}
