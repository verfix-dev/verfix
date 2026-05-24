import { Page, Dialog } from 'playwright';
import { chatCompletion, isAIEnabled } from './provider';
import { resolveWithHealing } from './self-healing';
import { waitForStableDOM } from '../reliability/retry';
import { EventTracker } from '../artifacts/event-tracker';
import * as crypto from 'crypto';

interface ActionHistory {
  step: number;
  thought: string;
  action: string;
  target?: string;
  value?: string;
  result: 'success' | 'error';
  error_msg?: string;
  dom_changed: boolean;
}

interface AIResponse {
  thought: string;
  action: 'click' | 'type' | 'press' | 'navigate' | 'done' | 'fail';
  targetSelector?: string;
  value?: string;
}

const MAX_STEPS = 12;
const ACTION_TIMEOUT = 5000;
const NAV_TIMEOUT = 10000;
const DOM_SETTLE_MS = 500;

export async function runExploration(
  page: Page,
  task: string,
  tracker?: EventTracker,
): Promise<{ passed: boolean; log: string[]; duration_ms: number; error?: string }> {
  const start = Date.now();
  const log: string[] = [];
  const actionHistory: ActionHistory[] = [];

  if (!isAIEnabled()) {
    return {
      passed: false,
      log: ['Exploration mode requires AI to be enabled.'],
      duration_ms: Date.now() - start,
      error: 'AI is disabled.',
    };
  }

  log.push(`Started exploratory mode for task: "${task}"`);

  const dialogHandler = async (dialog: Dialog) => {
    log.push(`[System] Auto-dismissed dialog: "${dialog.message()}"`);
    await dialog.dismiss();
  };
  page.on('dialog', dialogHandler);

  let stepCount = 0;
  let previousDomHash = '';
  let previousUrl = '';

  while (stepCount < MAX_STEPS) {
    stepCount++;
    console.log(`  🤖 Exploratory Step ${stepCount}/${MAX_STEPS}`);
    log.push(`\n--- Step ${stepCount} ---`);

    try {
      const { currentUrl, pageTitle, domSnippet, currentDomHash, stateChanged } = await capturePageState(page, previousDomHash, previousUrl);

      if (actionHistory.length > 0) {
        actionHistory[actionHistory.length - 1].dom_changed = stateChanged;
      }

      const prompt = buildExplorationPrompt(task, pageTitle, currentUrl, actionHistory, domSnippet);
      const response = await chatCompletion([
        { role: 'system', content: 'You are an autonomous browser agent. Output only valid JSON.' },
        { role: 'user', content: prompt }
      ], { json: true, temperature: 0.2, maxTokens: 800 });

      if (!response) throw new Error('AI failed to respond or is disabled.');

      const parsed: AIResponse = JSON.parse(response);
      log.push(`Thought: ${parsed.thought}`);
      
      if (parsed.action === 'done' || parsed.action === 'fail') {
        return await handleCompletion(page, parsed, stepCount, log, start, dialogHandler, tracker);
      }

      logAction(parsed, log);

      const { success: stepSuccess, error: stepError } = await performAction(page, parsed);

      actionHistory.push({
        step: stepCount,
        thought: parsed.thought,
        action: parsed.action,
        target: parsed.targetSelector,
        value: parsed.value,
        result: stepSuccess ? 'success' : 'error',
        error_msg: stepError || undefined,
        dom_changed: false
      });

      await handleStepResult(page, parsed, stepCount, stepSuccess, stepError, log, tracker);

      previousDomHash = currentDomHash;
      previousUrl = currentUrl;

    } catch (e: any) {
      const msg = e.message;
      log.push(`Error during step execution: ${msg}`);
      console.warn(`    ⚠ Exploratory step error: ${msg}`);
      actionHistory.push({
        step: stepCount,
        thought: 'Exception caught',
        action: 'error',
        result: 'error',
        error_msg: msg,
        dom_changed: false
      });
    }
  }

  return await handleMaxSteps(page, stepCount, log, start, dialogHandler, tracker);
}

async function capturePageState(page: Page, previousDomHash: string, previousUrl: string) {
  const domSnippet = await getCompactDOM(page);
  const currentUrl = page.url();
  const pageTitle = await page.title();
  const currentDomHash = crypto.createHash('md5').update(domSnippet).digest('hex');
  const stateChanged = currentDomHash !== previousDomHash || currentUrl !== previousUrl;
  return { currentUrl, pageTitle, domSnippet, currentDomHash, stateChanged };
}

function buildExplorationPrompt(
  task: string,
  pageTitle: string,
  currentUrl: string,
  actionHistory: ActionHistory[],
  domSnippet: string
): string {
  const historyText = actionHistory.length > 0 
    ? actionHistory.map(h => `Step ${h.step}: [${h.result}] ${h.action} ${h.target || ''} ${h.value ? `"${h.value}"` : ''} ${h.error_msg ? `(Error: ${h.error_msg})` : ''} ${h.result === 'success' ? `(State changed: ${h.dom_changed})` : ''}`).join('\n')
    : 'No actions taken yet.';

  return `You are an AI browser exploration agent.
Your goal is: "${task}"

Current Page Title: ${pageTitle}
Current URL: ${currentUrl}

### Action History (avoid repeating failed actions!):
${historyText}

### Current Page State (interactive elements):
\`\`\`html
${domSnippet}
\`\`\`

Decide what to do next to achieve the goal. 
- Avoid repeating failed actions or actions that resulted in "(State changed: false)". If an action had no effect on the page, you MUST try a completely different approach, a different selector, or a different action.
- Evaluate if the goal has been accomplished. IMPORTANT: If the goal has multiple parts (e.g. "open X and Y"), checking X successfully in a past step remains valid even when you navigate to check Y. You do NOT need to see all parts simultaneously in the current state to output "done". Look at the Action History to infer if previous parts of the goal were already satisfied.
- If the entire goal (or all parts of it) is verified across the current state AND the action history, output "done". Do not perform unnecessary actions.
- If any part of the goal is demonstrably false and cannot be fixed by navigation, output "fail".
- Use the "navigate" action ONLY if you need to go to a completely different URL to proceed.
- Use the "press" action if you need to press a keyboard key (like Enter after typing into a search box).

Respond with a JSON object ONLY, in this exact format:
{
  "thought": "your reasoning about the current state, past history, and what to do next",
  "action": "click" | "type" | "press" | "navigate" | "done" | "fail",
  "targetSelector": "CSS selector to click or type into, OR url to navigate to (omit if done/fail/press)",
  "value": "text to type, OR key to press like 'Enter' (omit if not typing/pressing)"
}`;
}

function logAction(parsed: AIResponse, log: string[]) {
  if (parsed.action === 'navigate' && parsed.targetSelector) {
    log.push(`Action: navigate to "${parsed.targetSelector}"`);
  } else if (parsed.action === 'click' && parsed.targetSelector) {
    log.push(`Action: click on "${parsed.targetSelector}"`);
  } else if (parsed.action === 'type' && parsed.targetSelector) {
    log.push(`Action: type "${parsed.value}" into "${parsed.targetSelector}"`);
  } else if (parsed.action === 'press' && parsed.value) {
    log.push(`Action: press "${parsed.value}"`);
  } else {
    log.push(`Action: unknown or malformed (${parsed.action})`);
  }
}

async function performAction(page: Page, parsed: AIResponse): Promise<{ success: boolean; error: string }> {
  let stepSuccess = false;
  let stepError = '';

  if (parsed.action === 'navigate' && parsed.targetSelector) {
    try {
      await page.goto(parsed.targetSelector, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await waitForStableDOM(page, DOM_SETTLE_MS, ACTION_TIMEOUT);
      stepSuccess = true;
    } catch (err: any) {
      stepError = `Navigation failed: ${err.message}`;
    }
  } else if (parsed.action === 'click' && parsed.targetSelector) {
    const res = await resolveWithHealing(page, parsed.targetSelector, 'assisted', parsed.thought, ACTION_TIMEOUT);
    if (!res.locator) {
      stepError = `Could not find target ${parsed.targetSelector}`;
    } else {
      try {
        await res.locator.click({ timeout: ACTION_TIMEOUT });
        await waitForStableDOM(page, DOM_SETTLE_MS, ACTION_TIMEOUT);
        stepSuccess = true;
      } catch (err: any) {
        stepError = `Click failed: ${err.message}`;
      }
    }
  } else if (parsed.action === 'type' && parsed.targetSelector) {
    const res = await resolveWithHealing(page, parsed.targetSelector, 'assisted', parsed.thought, ACTION_TIMEOUT);
    if (!res.locator) {
      stepError = `Could not find target ${parsed.targetSelector}`;
    } else {
      try {
        await res.locator.fill(parsed.value || '', { timeout: ACTION_TIMEOUT });
        await waitForStableDOM(page, DOM_SETTLE_MS, ACTION_TIMEOUT);
        stepSuccess = true;
      } catch (err: any) {
        stepError = `Type failed: ${err.message}`;
      }
    }
  } else if (parsed.action === 'press' && parsed.value) {
    try {
      await page.keyboard.press(parsed.value);
      await waitForStableDOM(page, DOM_SETTLE_MS, ACTION_TIMEOUT);
      stepSuccess = true;
    } catch (err: any) {
      stepError = `Press failed: ${err.message}`;
    }
  } else {
    stepError = `Unknown action or missing target/value: ${parsed.action}`;
  }

  return { success: stepSuccess, error: stepError };
}

async function handleStepResult(
  page: Page,
  parsed: AIResponse,
  stepCount: number,
  stepSuccess: boolean,
  stepError: string,
  log: string[],
  tracker?: EventTracker
) {
  if (!stepSuccess) {
    log.push(`Error: ${stepError}`);
    if (tracker) {
      const event = tracker.pushEvent('retry', `Step ${stepCount} failed: ${stepError}`, { step: stepCount, action: parsed.action, target: parsed.targetSelector }, { category: 'signal', capture_reason: 'retry', signal_flags: ['retry'] });
      await tracker.captureSignalState(page, event.id, 'retry');
    }
  } else {
    if (tracker) {
      const eventType = parsed.action === 'navigate' ? 'navigation' : 'action';
      const msg = `${parsed.action} ${parsed.targetSelector || parsed.value || ''}`.trim();
      const event = tracker.pushEvent(
        eventType, 
        msg, 
        { step: stepCount, action: parsed.action, target: parsed.targetSelector, value: parsed.value, thought: parsed.thought }, 
        { category: 'info', summary: parsed.thought }
      );
      await tracker.captureStateSync(page, event.id, 'step');
    }
  }
}

async function handleCompletion(
  page: Page,
  parsed: AIResponse,
  stepCount: number,
  log: string[],
  start: number,
  dialogHandler: (dialog: Dialog) => Promise<void>,
  tracker?: EventTracker
) {
  const isDone = parsed.action === 'done';
  log.push(`Action: ${isDone ? 'DONE. Goal achieved.' : 'FAIL. Goal cannot be achieved.'}`);
  page.off('dialog', dialogHandler);

  if (tracker) {
    const ev = tracker.pushEvent(
      'ai_reasoning',
      isDone ? 'Exploration completed' : 'Exploration failed',
      { status: isDone ? 'passed' : 'failed', steps: stepCount },
      { category: 'summary', summary: log.join('\n') },
    );
    await tracker.captureStateSync(page, ev.id, isDone ? 'step' : 'failure');
  }

  return { passed: isDone, log, duration_ms: Date.now() - start, error: isDone ? undefined : 'Agent declared failure.' };
}

async function handleMaxSteps(
  page: Page,
  stepCount: number,
  log: string[],
  start: number,
  dialogHandler: (dialog: Dialog) => Promise<void>,
  tracker?: EventTracker
) {
  log.push('\nExploration failed: Maximum steps reached.');
  page.off('dialog', dialogHandler);
  
  if (tracker) {
    const ev = tracker.pushEvent(
      'ai_reasoning',
      'Exploration failed: max steps reached',
      { status: 'failed', steps: stepCount },
      { category: 'summary', summary: log.join('\n') },
    );
    await tracker.captureStateSync(page, ev.id, 'failure');
  }
  
  return { passed: false, log, duration_ms: Date.now() - start, error: 'Max steps reached without success.' };
}

async function getCompactDOM(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const elements: string[] = [];
    const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [data-testid], [aria-label], h1, h2, h3, p, li, td, th, span';
    
    const isVisible = (elem: Element) => {
      if (!(elem instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(elem);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = elem.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    document.querySelectorAll(interactiveSelectors).forEach((el, i) => {
      if (!isVisible(el)) return;
      if (elements.length > 80) return;
      
      const tag = el.tagName.toLowerCase();
      const attrs: string[] = [];
      for (const attr of ['id', 'data-testid', 'aria-label', 'role', 'type', 'name', 'placeholder', 'href']) {
        const val = el.getAttribute(attr);
        if (val) attrs.push(`${attr}="${val}"`);
      }
      let text = (el as HTMLElement).innerText || el.textContent || '';
      text = text.trim().replace(/\s+/g, ' ').slice(0, 100);
      
      if (attrs.length > 0 || text.length > 0) {
        elements.push(`<${tag} ${attrs.join(' ')}>${text}</${tag}>`);
      }
    });
    return elements.join('\n');
  });
}
