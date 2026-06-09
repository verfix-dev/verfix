/**
 * Shared HTTP utilities for AI provider adapters.
 *
 * - fetchWithTimeout: wraps fetch() with an AbortController timeout
 * - resolveBaseUrl: rewrites localhost → host.docker.internal in bridge-mode Docker
 *
 * Both utilities are used by every adapter implementation. Centralising them here
 * avoids duplicating the Docker detection logic that was previously in provider.ts.
 */

import fs from 'fs';

// ─── Docker detection ─────────────────────────────────────────────────────────
//
// Two runtime modes depending on how the container was started:
//
// ── VERFIX_HOST_NETWORK=1 (Linux, --network=host) ────────────────────────────
// The container shares the host network namespace. 'localhost' inside the
// container IS the host's localhost. No URL rewriting needed.
//
// ── Bridge mode (Mac / Windows Docker Desktop) ───────────────────────────────
// Docker runs in a VM. 'localhost' resolves to the container itself.
// We rewrite to 'host.docker.internal' which points to the host machine.
// Docker Desktop injects this DNS entry automatically; on Linux it requires
// '--add-host=host.docker.internal:host-gateway'.

const IS_HOST_NETWORK = process.env.VERFIX_HOST_NETWORK === '1';
const IS_DOCKER =
  !IS_HOST_NETWORK &&
  (process.env.IN_DOCKER === '1' || fs.existsSync('/.dockerenv'));

/**
 * Rewrite `http(s)://localhost` or `://127.0.0.1` to `host.docker.internal`
 * when running in Docker bridge mode.
 *
 * No-op in host-network mode, outside Docker, or for non-localhost URLs.
 */
export function resolveBaseUrl(url: string): string {
  if (!url || IS_HOST_NETWORK || !IS_DOCKER) return url;
  return url.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Wraps the global `fetch()` with an AbortController-based timeout.
 * Throws with an ABORT_ERR-style error if the timeout fires.
 *
 * @param url - Target URL
 * @param init - Standard RequestInit (headers, body, method, etc.)
 * @param timeoutMs - Milliseconds before the request is aborted (default: 30 000)
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a JSON response safely.
 * Returns null if the body is not valid JSON instead of throwing.
 */
export async function parseJsonSafe(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
