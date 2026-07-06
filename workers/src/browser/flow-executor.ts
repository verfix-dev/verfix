import { Page, BrowserContext, Locator } from 'playwright';
import { JobPayload, Flow, FlowStep } from '../assertions/types';
import { EventTracker } from '../artifacts/event-tracker';
import { resolveWithHealing } from '../ai/self-healing';

/**
 * Execute all flows defined in the job payload.
 *
 * Target resolution:
 *   - A step's `selector` may be a logical name defined in the config
 *     `selectors` alias map; it is resolved to the real selector first.
 *   - `strict` mode resolves the exact selector deterministically (no healing).
 *   - `assisted` mode falls back to self-healing (aria-label / role / text, then
 *     an AI suggestion) when the exact selector does not resolve — so most
 *     elements can be targeted WITHOUT adding a `data-testid` to project source.
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
      await executeStep(page, { ...step, value: stepValue }, job.selectors || {}, flow.mode || job.mode || 'strict', job.timeout || 10000);
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
      if (step.optional) {
        console.log(`    ⏭ skipped optional step ${stepDesc}: ${err.message}`);
        if (tracker) {
          tracker.pushEvent(
            'action',
            `⏭ skipped optional step ${stepDesc}: ${err.message}`,
            { flow: flow.name, action: step.action, target: step.target, skipped: true, reason: err.message },
            { category: 'info' },
          );
        }
        continue;
      }
      if (tracker) {
        const event = tracker.pushEvent('retry', `❌ ${stepDesc} failed: ${err.message}`, { flow: flow.name, action: step.action, error: err.message }, { category: 'signal', capture_reason: 'retry', signal_flags: ['retry'] });
        await tracker.captureSignalState(page, event.id, 'retry');
      }
      throw err;
    }
  }
}

async function resolveLocator(
  page: Page,
  step: FlowStep,
  knownSelectors: Record<string, string>,
  mode: string,
  timeout: number,
): Promise<Locator> {
  if (!step.target) throw new Error('Step has no target defined');

  if (step.target.testId) {
    const selector = `[data-testid="${step.target.testId}"]`;
    const intent = humanize(step.target.testId);
    return resolveOrHeal(page, selector, mode, intent, timeout);
  }
  if (step.target.selector) {
    // Resolve config `selectors` alias map: a logical name → real selector.
    // Falls through unchanged when the selector isn't an alias.
    const aliased = Object.prototype.hasOwnProperty.call(knownSelectors, step.target.selector);
    const selector = aliased ? knownSelectors[step.target.selector] : step.target.selector;
    const intent = aliased ? humanize(step.target.selector) : undefined;
    return resolveOrHeal(page, selector, mode, intent, timeout);
  }
  if (step.target.text) {
    return page.getByText(step.target.text, { exact: false }).first();
  }
  throw new Error(`Cannot resolve locator for step: ${JSON.stringify(step)}`);
}

/**
 * Resolve a selector, healing semantically in assisted mode. In strict mode the
 * exact selector is returned as-is (deterministic). In assisted mode, if the
 * exact selector doesn't resolve we heal via aria-label / role / text (and an AI
 * suggestion when a key is configured), so a data-testid is usually unnecessary.
 * On heal failure we return the original locator so the caller surfaces a normal
 * selector failure.
 */
async function resolveOrHeal(
  page: Page,
  selector: string,
  mode: string,
  intent: string | undefined,
  timeout: number,
): Promise<Locator> {
  if (mode !== 'assisted') {
    return page.locator(selector).first();
  }
  const healed = await resolveWithHealing(page, selector, mode, intent, Math.min(timeout, 3000));
  return healed.locator ?? page.locator(selector).first();
}

/**
 * Turn a selector/testid/alias token into a human intent hint used for semantic
 * healing, e.g. "login-submit" → "login submit", "signIn" → "sign In". Splitting
 * camelCase and kebab/snake case lets the accessibility-tree matcher find the
 * element by its visible text / aria-label.
 */
function humanize(token: string): string {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .trim();
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

async function executeStep(page: Page, step: FlowStep, knownSelectors: Record<string, string>, mode: string, timeout: number): Promise<void> {
  const t = step.timeout || timeout;

  switch (step.action) {
    case 'click': {
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      await locator.click({ timeout: t });
      console.log(`    click → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'type': {
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
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
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      console.log(`    wait_for_selector → ${JSON.stringify(step.target)}`);
      break;
    }
    default:
      console.warn(`    Unknown step action: ${(step as any).action}`);
  }
}
