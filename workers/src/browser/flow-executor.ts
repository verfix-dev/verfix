import * as fs from 'fs';
import * as path from 'path';
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
    const rawValue = step.value || step.url || (step.action === 'press' ? step.key : '') || '';
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

  // `frame` scopes the step's target inside an <iframe>. Resolution is
  // deterministic there — AI healing operates on the top-level page only.
  // ponytail: one frame level (no nested iframes); chain frameLocators to upgrade.
  const frame = step.frame ? page.frameLocator(step.frame) : undefined;

  if (step.target.testId) {
    const selector = `[data-testid="${step.target.testId}"]`;
    if (frame) return frame.locator(selector).first();
    const intent = humanize(step.target.testId);
    return resolveOrHeal(page, selector, mode, intent, timeout);
  }
  if (step.target.selector) {
    // Resolve config `selectors` alias map: a logical name → real selector.
    // Falls through unchanged when the selector isn't an alias.
    const aliased = Object.prototype.hasOwnProperty.call(knownSelectors, step.target.selector);
    const selector = aliased ? knownSelectors[step.target.selector] : step.target.selector;
    if (frame) return frame.locator(selector).first();
    const intent = aliased ? humanize(step.target.selector) : undefined;
    return resolveOrHeal(page, selector, mode, intent, timeout);
  }
  if (step.target.text) {
    return (frame ?? page).getByText(step.target.text, { exact: false }).first();
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
    case 'wait_for_url': {
      const fragment = step.value || '';
      if (!fragment) throw new Error('wait_for_url step requires "value" (a URL substring to wait for)');
      // Substring semantics, same as the url_contains assertion.
      await page.waitForURL(u => u.toString().includes(fragment), { timeout: t });
      console.log(`    wait_for_url "${fragment}" → ${page.url()}`);
      break;
    }
    case 'wait_for_network_idle': {
      await page.waitForLoadState('networkidle', { timeout: t });
      console.log('    wait_for_network_idle');
      break;
    }
    case 'select_option': {
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      // Playwright matches the string against the option's value or label.
      await locator.selectOption(step.value || '', { timeout: t });
      console.log(`    select_option "${step.value}" → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'check':
    case 'uncheck': {
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      if (step.action === 'check') await locator.check({ timeout: t });
      else await locator.uncheck({ timeout: t });
      console.log(`    ${step.action} → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'upload_file': {
      if (!step.file) throw new Error('upload_file step requires "file": a fixture path or inline { name, content }');
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      // File inputs are routinely hidden behind styled buttons/drop zones —
      // require the input to exist, not to be visible (setInputFiles works
      // on hidden inputs).
      await locator.waitFor({ state: 'attached', timeout: t });
      if (typeof step.file === 'string') {
        const filePath = path.resolve(process.cwd(), step.file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`upload_file: file not found: ${filePath} — commit a fixture at that path, or use inline { "name", "content" } so the run has no filesystem dependency`);
        }
        await locator.setInputFiles(filePath, { timeout: t });
        console.log(`    upload_file "${step.file}" → ${JSON.stringify(step.target)}`);
      } else {
        const buffer = Buffer.from(step.file.content, step.file.encoding === 'base64' ? 'base64' : 'utf8');
        await locator.setInputFiles(
          { name: step.file.name, mimeType: step.file.mimeType || 'application/octet-stream', buffer },
          { timeout: t },
        );
        console.log(`    upload_file inline "${step.file.name}" (${buffer.length} bytes) → ${JSON.stringify(step.target)}`);
      }
      break;
    }
    case 'hover': {
      const locator = await resolveLocator(page, step, knownSelectors, mode, t);
      await locator.waitFor({ state: 'visible', timeout: t });
      await locator.hover({ timeout: t });
      console.log(`    hover → ${JSON.stringify(step.target)}`);
      break;
    }
    case 'press': {
      const key = step.key || step.value || '';
      if (step.target) {
        const locator = await resolveLocator(page, step, knownSelectors, mode, t);
        await locator.waitFor({ state: 'visible', timeout: t });
        await locator.press(key, { timeout: t });
      } else {
        await page.keyboard.press(key);
      }
      console.log(`    press "${key}"${step.target ? ` → ${JSON.stringify(step.target)}` : ''}`);
      break;
    }
    default:
      console.warn(`    Unknown step action: ${(step as any).action}`);
  }
}
