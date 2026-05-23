// ─── Single source of truth for all runtime constants ───────────────────────
// Derived from api/main.go (app.Listen(":3001")) and dashboard (port 3000).
// Never hardcode these values elsewhere — import from here.

export const API_PORT = 3001;
export const DASHBOARD_PORT = 3000;

export const API_BASE = process.env.VERIFY_API || `http://localhost:${API_PORT}`;
export const DASHBOARD_BASE = process.env.VERIFY_DASHBOARD || `http://localhost:${DASHBOARD_PORT}`;

export const HEALTH_ENDPOINT = '/api/v1/health';

export const DOCKER_IMAGE = 'ghcr.io/verfix-dev/verfix-server:latest';
export const CONTAINER_NAME = 'verfix';
export const DEFAULT_CONFIG = 'verfix.config.json';

export const VOLUMES = {
  data: 'verfix-data:/var/lib/postgresql/15/main',
  artifacts: 'verfix-artifacts:/app/workers/artifacts',
};

export const AI_MODELS = [
  { name: 'gpt-5.5 (default)', value: 'gpt-5.5' },
  { name: 'gpt-5.4-nano', value: 'gpt-5.4-nano' },
  { name: 'gpt-5.4-mini', value: 'gpt-5.4-mini' },
  { name: 'custom openai model(type your own)', value: '__custom__' },
];

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
