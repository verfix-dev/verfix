import { Page } from 'playwright';
import { ASSERTION_TYPES, AssertionDefinition, AssertionResult, ConsoleLine, NetworkRequest } from './types';
import { inferFailureType, renderFixHint } from './failure-hints';
import { resolveWithHealing } from '../ai/self-healing';
import { EventTracker } from '../artifacts/event-tracker';

// Utility to time an async assertion
async function timed(fn: () => Promise<{ passed: boolean; details?: Record<string, unknown>; error?: string }>): Promise<{ passed: boolean; duration_ms: number; details?: Record<string, unknown>; error?: string }> {
  const start = Date.now();
  const result = await fn();
  return { ...result, duration_ms: Date.now() - start };
}

export async function runAssertions(
  page: Page,
  assertions: AssertionDefinition[],
  consoleLogs: ConsoleLine[],
  networkRequests: NetworkRequest[],
  artifactsDir: string,
  executionId: string,
  mode: string = 'strict',
  task: string = '',
  tracker?: EventTracker,
  flowName?: string,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  for (const assertion of assertions) {
    let result: Omit<AssertionResult, 'type'>;

    switch (assertion.type) {
      case 'page_loaded':
        result = await timed(async () => {
          // Page already navigated; check it didn't crash
          const url = page.url();
          const passed = url !== 'about:blank' && !url.startsWith('chrome-error://');
          return { passed, details: { url } };
        });
        break;

      case 'selector_visible': {
        const selector = assertion.selector || '';
        result = await timed(async () => {
          // In assisted mode, use self-healing selector resolution
          if (mode === 'assisted') {
            const resolution = await resolveWithHealing(
              page, selector, mode, task, assertion.timeout || 5000,
            );
            return {
              passed: resolution.locator !== null,
              details: {
                selector,
                healed: resolution.healed,
                attempts: resolution.attempts.map(a => ({
                  strategy: a.strategy,
                  selector: a.selector,
                  found: a.found,
                  duration_ms: a.duration_ms,
                })),
                resolved_selector: resolution.healed
                  ? resolution.attempts.find(a => a.found)?.selector
                  : selector,
              },
              error: resolution.locator ? undefined : `Selector not found after ${resolution.attempts.length} attempt(s)`,
            };
          }

          // Strict mode: direct lookup, no healing
          try {
            const locator = page.locator(selector);
            const visible = await locator.isVisible({ timeout: assertion.timeout || 5000 });
            return { passed: visible, details: { selector } };
          } catch (e: any) {
            return { passed: false, error: e.message, details: { selector } };
          }
        });
        break;
      }

      case 'text_visible': {
        const text = assertion.value || '';
        result = await timed(async () => {
          try {
            const visible = await page.getByText(text, { exact: false }).isVisible({ timeout: assertion.timeout || 5000 });
            return { passed: visible, details: { text } };
          } catch (e: any) {
            return { passed: false, error: e.message, details: { text } };
          }
        });
        break;
      }

      case 'url_contains': {
        const value = assertion.value || '';
        result = await timed(async () => {
          const currentUrl = page.url();
          const passed = currentUrl.includes(value);
          return { passed, details: { expected: value, actual: currentUrl } };
        });
        break;
      }

      case 'title_contains': {
        const value = assertion.value || '';
        result = await timed(async () => {
          const title = await page.title();
          const passed = title.toLowerCase().includes(value.toLowerCase());
          return { passed, details: { expected: value, actual: title } };
        });
        break;
      }

      case 'no_console_errors': {
        result = await timed(async () => {
          const errors = consoleLogs.filter(l => l.type === 'error');
          return {
            passed: errors.length === 0,
            details: { error_count: errors.length, errors: errors.map(e => e.text) },
          };
        });
        break;
      }

      case 'network_request_success': {
        const urlPattern = assertion.value || '';
        result = await timed(async () => {
          const matched = networkRequests.filter(r => r.url.includes(urlPattern));
          const allSuccess = matched.length > 0 && matched.every(r => r.status >= 200 && r.status < 400);
          return {
            passed: allSuccess,
            details: {
              pattern: urlPattern,
              matched: matched.map(r => ({ url: r.url, status: r.status })),
            },
          };
        });
        break;
      }

      default:
        result = {
          passed: false,
          duration_ms: 0,
          error: `Unknown assertion type: ${(assertion as any).type}. Valid types: ${ASSERTION_TYPES.join(', ')}`,
        };
    }

    let failure_type: AssertionResult['failure_type'];
    let fix_hint: string | undefined;
    if (!result.passed) {
      failure_type = inferFailureType(assertion, result);
      fix_hint = renderFixHint(failure_type, {
        assertion_type: assertion.type,
        selector: assertion.selector,
        value: assertion.value,
        expected: (result.details as any)?.expected ?? assertion.value,
        actual: (result.details as any)?.actual,
        error: result.error,
      });
    }

    let screenshot_on_failure: string | undefined;

    // Emit event into the observability timeline
    if (tracker) {
      if (result.passed) {
        const event = tracker.pushEvent(
          'assertion_passed',
          `${assertion.type} passed`,
          { assertion: assertion.type, duration_ms: result.duration_ms, ...result.details },
          { category: 'info' },
        );
        await tracker.captureStateSync(page, event.id, 'step');
      } else {
        const event = tracker.pushEvent(
          'assertion_failed',
          `${assertion.type} failed: ${result.error || 'check did not pass'}`,
          { assertion: assertion.type, failure_type, fix_hint, ...result.details },
          { category: 'signal', capture_reason: 'failure', signal_flags: ['failure'] },
        );
        await tracker.captureStateSync(page, event.id, 'failure');
        screenshot_on_failure = event.screenshot;
      }
    } else if (!result.passed) {
      const failPath = `${artifactsDir}/${executionId}_fail_${assertion.type}.png`;
      try {
        await page.screenshot({ path: failPath, fullPage: false });
        screenshot_on_failure = failPath;
      } catch {
        // Page might be closed
      }
    }

    const assertionResult = { type: assertion.type, ...result, screenshot_on_failure, failure_type, fix_hint, flow_name: flowName };
    results.push(assertionResult);

    // Enhanced logging
    const healedTag = (result.details as any)?.healed ? ' (🔧 healed)' : '';
    console.log(`  [${result.passed ? '✅' : '❌'}] ${assertion.type} (${result.duration_ms}ms)${healedTag}${result.error ? ` — ${result.error}` : ''}`);
  }

  return results;
}
