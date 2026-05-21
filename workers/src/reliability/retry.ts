import { Page } from 'playwright';

const RETRYABLE_ERRORS = [
  'Navigation timeout',
  'Target closed',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_ABORTED',
];

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export function isRetryable(error: Error): boolean {
  return RETRYABLE_ERRORS.some(msg => error.message.includes(msg));
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
