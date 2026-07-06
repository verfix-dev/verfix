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
          const rawErrors = consoleLogs.filter(l => l.type === 'error');
          let patterns: RegExp[];
          try {
            patterns = (assertion.exclude || []).map(p => new RegExp(p));
          } catch (e: any) {
            return { passed: false, error: `Invalid exclude pattern: ${e.message}` };
          }
          const errors = patterns.length > 0
            ? rawErrors.filter(e => !patterns.some(p => p.test(e.text)))
            : rawErrors;
          const excluded_count = rawErrors.length - errors.length;
          const passed = errors.length === 0;
          return {
            passed,
            details: { error_count: errors.length, errors: errors.map(e => e.text), excluded_count },
            error: passed ? undefined : `${errors.length} console error(s), first: "${errors[0].text.slice(0, 200)}"`,
          };
        });
        break;
      }

      case 'network_request_success': {
        const urlPattern = assertion.value || '';
        const acceptStatuses = assertion.acceptStatuses;
        const isAccepted = (status: number) =>
          acceptStatuses && acceptStatuses.length > 0
            ? acceptStatuses.includes(status)
            : status >= 200 && status < 400;
        result = await timed(async () => {
          const matched = networkRequests.filter(r => r.url.includes(urlPattern));
          const allSuccess = matched.length > 0 && matched.every(r => isAccepted(r.status));
          const details = {
            pattern: urlPattern,
            acceptStatuses,
            matched: matched.map(r => ({ url: r.url, method: r.method, status: r.status })),
          };
          if (allSuccess) return { passed: true, details };
          const error = matched.length === 0
            ? `No requests matching "${urlPattern}" were observed`
            : `${matched.length} matched request(s) returned unaccepted status: ${matched.slice(0, 3).map(r => `${r.method} ${r.url} → ${r.status}`).join(', ')}`;
          return { passed: false, details, error };
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
        details: result.details,
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
