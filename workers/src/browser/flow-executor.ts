import { Page, BrowserContext } from 'playwright';
import { JobPayload, Flow, FlowStep } from '../assertions/types';
import { EventTracker } from '../artifacts/event-tracker';

/**
 * Execute all flows defined in the job payload.
 * Flows resolve targets in priority order:
 *   1. data-testid  (most stable)
 *   2. aria-label
 *   3. raw selector
 *   4. text content
 */
export async function executeFlows(page: Page, job: JobPayload, tracker?: EventTracker): Promise<void> {
  if (!job.flows || job.flows.length === 0) return;

  for (const flow of job.flows) {
    await executeFlow(page, flow, job, tracker);
  }
}

export async function executeFlow(page: Page, flow: Flow, job: JobPayload, tracker?: EventTracker): Promise<void> {
  console.log(`  ▶ Running flow: "${flow.name}"`);
  for (const step of flow.steps) {
    const rawValue = step.value || step.url || '';
    const stepValue = step.action === 'navigate'
      ? resolveNavigateUrl(rawValue, job.url)
      : rawValue;
    const stepDesc = `${step.action} ${JSON.stringify(step.target || stepValue || '')}`;
    try {
      await executeStep(page, { ...step, value: stepValue }, job.selectors || {}, job.timeout || 10000);
      if (tracker) {
        const eventType = step.action === 'navigate' ? 'navigation' : 'action';
        const event = tracker.pushEvent(
          eventType,
          `${step.action} ${stepValue || ''}`.trim(),
          { flow: flow.name, action: step.action, target: step.target, value: stepValue },
          { category: 'info' },
        );
        await tracker.captureStateSync(page, event.id, 'step');
      }
    } catch (err: any) {
      if (tracker) {
        const event = tracker.pushEvent('retry', `❌ ${stepDesc} failed: ${err.message}`, { flow: flow.name, action: step.action, error: err.message }, { category: 'signal', capture_reason: 'retry', signal_flags: ['retry'] });
        await tracker.captureSignalState(page, event.id, 'retry');
      }
      throw err;
    }
  }
}

async function resolveLocator(page: Page, step: FlowStep, knownSelectors: Record<string, string>, timeout: number) {
  if (!step.target) throw new Error('Step has no target defined');

  if (step.target.testId) {
    return page.locator(`[data-testid="${step.target.testId}"]`).first();
  }
  if (step.target.selector) {
    return page.locator(step.target.selector).first();
  }
  if (step.target.text) {
    return page.getByText(step.target.text, { exact: false }).first();
  }
  throw new Error(`Cannot resolve locator for step: ${JSON.stringify(step)}`);
}

function resolveNavigateUrl(value: string, baseUrl: string | undefined): string {
  if (!value) return value;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value;
  if (!baseUrl) return value;

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

async function executeStep(page: Page, step: FlowStep, knownSelectors: Record<string, string>, timeout: number): Promise<void> {
  const t = step.timeout || timeout;

  switch (step.action) {
    case 'click': {
      const locator = await resolveLocator(page, step, knownSelectors, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      await locator.click({ timeout: t });
      console.log(`    click → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'type': {
      const locator = await resolveLocator(page, step, knownSelectors, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      await locator.fill(step.value || '', { timeout: t });
      console.log(`    type "${step.value}" → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'navigate': {
      const targetUrl = step.value || step.url || '';
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: t });
      console.log(`    navigate → ${targetUrl}`);
      break;
    }
    case 'wait_for_selector': {
      const locator = await resolveLocator(page, step, knownSelectors, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      console.log(`    wait_for_selector → ${JSON.stringify(step.target)}`);
      break;
    }
    default:
      console.warn(`    Unknown step action: ${(step as any).action}`);
  }
}
