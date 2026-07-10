import { AssertionDefinition, AssertionType, FailureType } from './types';

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
    case 'selector_count':
      return (result.details as any)?.actual_count === 0 ? 'selector_not_found' : 'assertion_failed';
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
    case 'assertion_failed': {
      if (context.assertion_type === 'selector_count') {
        const expected = context.details?.expected_count;
        const actual = context.details?.actual_count;
        return context.selector && expected !== undefined && actual !== undefined
          ? `Expected ${expected} elements matching "${context.selector}" but found ${actual} — check for duplicate rendering or stale list state.`
          : 'Element count did not match. Check for duplicate rendering or stale list state.';
      }
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
    }
    default:
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
  }
}
