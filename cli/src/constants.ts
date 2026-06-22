import os from 'os';
import path from 'path';

// ─── Single source of truth for static runtime constants ────────────────────
// Dynamic ports are resolved via cli/src/runtime.ts.

export const HEALTH_ENDPOINT = '/api/v1/health';

export const DOCKER_IMAGE = 'ghcr.io/verfix-dev/verfix-server:latest';
export const CONTAINER_NAME = 'verfix';
export const DEFAULT_CONFIG = 'verfix.config.json';

export const VOLUMES = {
  data: 'verfix-data:/var/lib/postgresql/15/main',
  artifacts: 'verfix-artifacts:/app/workers/artifacts',
};

export type BrowserMode = 'host' | 'container';

/**
 * Where the browser (Playwright + Chromium) runs.
 * - 'host': Workers + browser on the host machine. All localhost ports accessible natively.
 *           Default on macOS and Windows where --network=host doesn't reach the real host.
 * - 'container': Workers + browser inside Docker. Default on Linux where --network=host works.
 *
 * Override: VERFIX_BROWSER_MODE=host|container
 */
export function getBrowserMode(): BrowserMode {
  const override = process.env.VERFIX_BROWSER_MODE;
  if (override === 'host' || override === 'container') return override;
  return os.platform() === 'linux' ? 'container' : 'host';
}

// ─── Host-mode paths ─────────────────────────────────────────────────────────
// When workers run on the host, these paths store extracted worker code,
// artifacts, and the worker PID file.
export const VERFIX_HOME = path.join(os.homedir(), '.verfix');
export const HOST_WORKER_DIR = path.join(VERFIX_HOME, 'worker');
export const HOST_ARTIFACTS_DIR = path.join(VERFIX_HOME, 'artifacts');
export const HOST_WORKER_PID_FILE = path.join(VERFIX_HOME, 'worker.pid');



export const SCAFFOLD_FLOWS: Record<string, { steps: any[]; assertions: any[] }> = {
  login: {
    steps: [
      { action: 'navigate', url: '/login' },
      { action: 'type', selector: '[data-testid=email]', value: 'test@example.com' },
      { action: 'type', selector: '[data-testid=password]', value: 'password123' },
      { action: 'click', selector: '[data-testid=submit]' },
    ],
    assertions: [
      { type: 'url_contains', value: '/dashboard' },
      { type: 'no_console_errors' },
    ],
  },
  'dashboard-load': {
    steps: [
      { action: 'navigate', url: '/dashboard' },
    ],
    assertions: [
      { type: 'page_loaded' },
      { type: 'selector_visible', selector: '[data-testid=dashboard]' },
      { type: 'no_console_errors' },
    ],
  },
  signup: {
    steps: [
      { action: 'navigate', url: '/signup' },
      { action: 'type', selector: '[data-testid=name]', value: 'Test User' },
      { action: 'type', selector: '[data-testid=email]', value: 'newuser@example.com' },
      { action: 'type', selector: '[data-testid=password]', value: 'password123' },
      { action: 'click', selector: '[data-testid=submit]' },
    ],
    assertions: [
      { type: 'url_contains', value: '/dashboard' },
      { type: 'no_console_errors' },
    ],
  },
  checkout: {
    steps: [
      { action: 'navigate', url: '/checkout' },
      { action: 'type', selector: '[data-testid=card-number]', value: '4242424242424242' },
      { action: 'click', selector: '[data-testid=pay-button]' },
    ],
    assertions: [
      { type: 'text_visible', value: 'Order confirmed' },
      { type: 'no_console_errors' },
    ],
  },
};

// FailureType values read from workers/src/assertions/types.ts
// Used for generating AGENTS.md at init time
export const FAILURE_TYPES = [
  { type: 'selector_not_found', description: 'A CSS/testId selector matched zero elements in the DOM' },
  { type: 'selector_not_visible', description: 'Element exists but is hidden (display:none, visibility:hidden, or zero size)' },
  { type: 'text_mismatch', description: 'Expected text was not found on the page' },
  { type: 'url_mismatch', description: 'Current URL does not contain the expected substring' },
  { type: 'console_error', description: 'One or more console.error() calls were detected' },
  { type: 'network_failure', description: 'A required network request returned non-2xx status' },
  { type: 'timeout', description: 'An operation exceeded the configured timeout duration' },
  { type: 'assertion_failed', description: 'Generic fallback — check fix_hint for details' },
];
