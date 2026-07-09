import { AssertionDefinition, AssertionType, FailureType, NetworkRequest } from './types';

export type FailureContext = {
  assertion_type: AssertionType;
  selector?: string;
  value?: string;
  expected?: string;
  actual?: string;
  error?: string;
  details?: Record<string, unknown>;
};

const TIMEOUT_REGEX = /timeout|timed out|waiting for/i;

function isTimeoutError(error?: string): boolean {
  if (!error) return false;
  return TIMEOUT_REGEX.test(error);
}

export function inferFailureType(
  assertion: AssertionDefinition,
  result: { passed: boolean; error?: string; details?: Record<string, unknown> },
): FailureType {
  if (result.passed) return 'assertion_failed';

  const errorText = result.error || '';
  if (isTimeoutError(errorText)) return 'timeout';

  switch (assertion.type) {
    case 'selector_visible':
      if (/not found|no node|no element/i.test(errorText)) return 'selector_not_found';
      if (!result.error) return 'selector_not_visible';
      return 'selector_not_found';
    case 'text_visible':
      return 'text_mismatch';
    case 'url_contains':
      return 'url_mismatch';
    case 'title_contains':
      return 'text_mismatch';
    case 'no_console_errors':
      return 'console_error';
    case 'network_request_success':
      return 'network_failure';
    case 'page_loaded':
      return 'assertion_failed';
    case 'exploration_result':
      return 'assertion_failed';
    default:
      return 'assertion_failed';
  }
}

export function renderFixHint(type: FailureType, context: FailureContext): string {
  switch (type) {
    case 'selector_not_found':
      return context.selector
        ? `Selector "${context.selector}" not found in DOM. Add a stable data-testid or update the selector.`
        : 'Selector not found in DOM. Add a stable data-testid or update the selector.';
    case 'selector_not_visible':
      return context.selector
        ? `Selector "${context.selector}" exists but is not visible. Check CSS/conditional rendering or wait for state to settle.`
        : 'Element exists but is not visible. Check CSS/conditional rendering or wait for state to settle.';
    case 'text_mismatch':
      return context.expected && context.actual
        ? `Expected text "${context.expected}" but saw "${context.actual}". Verify content or wait for data to render.`
        : 'Expected text did not match. Verify content or wait for data to render. If the text appears in multiple places, add "selector" to text_visible to scope the search.';
    case 'url_mismatch':
      return context.expected && context.actual
        ? `Expected URL to contain "${context.expected}" but got "${context.actual}". Check routing/redirects and wait for navigation.`
        : 'Navigation did not reach the expected URL. Check routing/redirects and wait for navigation.';
    case 'console_error': {
      if (!context.error) return 'Console errors detected. Fix JS errors or mock failing dependencies.';
      const suggested = context.details?.suggested_exclude as string | undefined;
      const thirdParty = context.details?.third_party as boolean | undefined;
      const origin = thirdParty
        ? ' This error originates from a third-party script, not your app code.'
        : '';
      const excludeAdvice = suggested
        ? ` If expected, add "exclude": ["${suggested}"] to the no_console_errors assertion in verfix.config.json.`
        : ' Fix JS errors, or add "exclude" patterns to no_console_errors if the error is expected.';
      return `Console errors detected — ${context.error}.${origin}${excludeAdvice}`;
    }
    case 'network_failure':
      return context.error
        ? `${context.error} Check backend availability, or add "acceptStatuses" to network_request_success if this status is expected.`
        : 'Network request failed or returned non-2xx. Check backend availability or mock API responses.';
    case 'timeout':
      return 'Operation timed out. Increase timeout or wait for network/DOM to settle before asserting.';
    case 'assertion_failed':
    default:
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
  }
}

// Failure types where a silent 401/403 redirect-to-login is a plausible root
// cause — a stale/rejected restored session, not the assertion itself.
const STALE_STATE_FAILURE_TYPES: ReadonlySet<FailureType> = new Set([
  'selector_not_found',
  'selector_not_visible',
  'url_mismatch',
  'timeout',
]);

const AUTH_URL_REGEX = /(auth|token|refresh|session|login|oauth|signin)/i;

// Drops the query string — tokens live there, and fix_hints end up in logs.
function truncateToPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

// When a restored useState session has been invalidated server-side (single-use
// refresh token consumed, expiry, server-side logout), the app silently 401s on
// its auth/refresh call and redirects to login — surfacing as a generic
// selector/url/timeout failure with no hint of the real cause. If this flow
// restored a saved state and the network log shows a 401/403 against an
// auth-ish endpoint, append that context to the hint deterministically.
export function appendStaleStateHint(
  hint: string,
  failureType: FailureType,
  stateRestored: boolean | undefined,
  networkRequests: NetworkRequest[],
): string {
  if (!stateRestored || !STALE_STATE_FAILURE_TYPES.has(failureType)) return hint;

  const staleRequest = networkRequests.find(
    (r) => (r.status === 401 || r.status === 403) && AUTH_URL_REGEX.test(r.url),
  );
  if (!staleRequest) return hint;

  const path = truncateToPath(staleRequest.url);
  return `${hint} Note: a saved session state was restored for this flow and the server returned ${staleRequest.status} on ${staleRequest.method} ${path} — the saved state may be stale or single-use. Re-run the flow that saves it, or run with --fresh-state.`;
}
