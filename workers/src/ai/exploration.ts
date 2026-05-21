/**
 * Exploration Runtime — Phase 4C.
 * A fundamentally different execution path optimizing for discovery and flexibility.
 * Not meant for production CI/CD; built for ad-hoc QA and AI-agent workflows.
 */

import { Page, Dialog, Locator } from 'playwright';
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

  // Handle unexpected dialogs automatically to prevent hanging
  const dialogHandler = async (dialog: Dialog) => {
    log.push(`[System] Auto-dismissed dialog: "${dialog.message()}"`);
    await dialog.dismiss();
  };
  page.on('dialog', dialogHandler);

  const MAX_STEPS = 12;
  let stepCount = 0;
  
  let previousDomHash = '';
  let previousUrl = '';

  while (stepCount < MAX_STEPS) {
    stepCount++;
    console.log(`  🤖 Exploratory Step ${stepCount}/${MAX_STEPS}`);
    log.push(`\n--- Step ${stepCount} ---`);

    try {
      const domSnippet = await getCompactDOM(page);
      const currentUrl = page.url();
      const pageTitle = await page.title();
      
      const currentDomHash = crypto.createHash('md5').update(domSnippet).digest('hex');
      const stateChanged = currentDomHash !== previousDomHash || currentUrl !== previousUrl;

      // If we took an action in the previous step but the state didn't change at all, flag it.
      if (actionHistory.length > 0) {
        actionHistory[actionHistory.length - 1].dom_changed = stateChanged;
      }

      const historyText = actionHistory.length > 0 
        ? actionHistory.map(h => `Step ${h.step}: [${h.result}] ${h.action} ${h.target || ''} ${h.value ? `"${h.value}"` : ''} ${h.error_msg ? `(Error: ${h.error_msg})` : ''} ${h.result === 'success' ? `(State changed: ${h.dom_changed})` : ''}`).join('\n')
        : 'No actions taken yet.';

      const prompt = `You are an AI browser exploration agent.
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
- Evaluate the Current Page Title, URL, and Page State. If the goal has been successfully accomplished (or verified), output "done". Do not perform unnecessary actions if the current state already satisfies the user's task.
- If the task requires you to verify something and it is visibly true based on the DOM, URL, or Title, output "done". If it is demonstrably false and cannot be fixed by navigation, output "fail".
- Use the "navigate" action ONLY if you need to go to a completely different URL to proceed.
- Use the "press" action if you need to press a keyboard key (like Enter after typing into a search box).

Respond with a JSON object ONLY, in this exact format:
{
  "thought": "your reasoning about the current state, past history, and what to do next",
  "action": "click" | "type" | "press" | "navigate" | "done" | "fail",
  "targetSelector": "CSS selector to click or type into, OR url to navigate to (omit if done/fail/press)",
  "value": "text to type, OR key to press like 'Enter' (omit if not typing/pressing)"
}`;

      const response = await chatCompletion([
        { role: 'system', content: 'You are an autonomous browser agent. Output only valid JSON.' },
        { role: 'user', content: prompt }
      ], { json: true, temperature: 0.2, maxTokens: 800 });

      if (!response) {
        throw new Error('AI failed to respond or is disabled.');
      }

      const parsed = JSON.parse(response);
      log.push(`Thought: ${parsed.thought}`);
      
      if (parsed.action === 'done') {
        log.push('Action: DONE. Goal achieved.');
        page.off('dialog', dialogHandler);
        if (tracker) {
          tracker.pushEvent(
            'ai_reasoning',
            'Exploration completed',
            { status: 'passed', steps: stepCount },
            { category: 'summary', summary: log.join('\n') },
          );
        }
        return { passed: true, log, duration_ms: Date.now() - start };
      }

      if (parsed.action === 'fail') {
        log.push('Action: FAIL. Goal cannot be achieved.');
        page.off('dialog', dialogHandler);
        if (tracker) {
          tracker.pushEvent(
            'ai_reasoning',
            'Exploration failed',
            { status: 'failed', steps: stepCount },
            { category: 'summary', summary: log.join('\n') },
          );
        }
        return { passed: false, log, duration_ms: Date.now() - start, error: 'Agent declared failure.' };
      }

      let stepSuccess = false;
      let stepError = '';

      if (parsed.action === 'navigate' && parsed.targetSelector) {
        log.push(`Action: navigate to "${parsed.targetSelector}"`);
        try {
          await page.goto(parsed.targetSelector, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await waitForStableDOM(page, 500, 5000);
          stepSuccess = true;
        } catch (err: any) {
          stepError = `Navigation failed: ${err.message}`;
        }
      } 
      else if (parsed.action === 'click' && parsed.targetSelector) {
        log.push(`Action: click on "${parsed.targetSelector}"`);
        const res = await resolveWithHealing(page, parsed.targetSelector, 'assisted', parsed.thought, 5000);
        if (!res.locator) {
          stepError = `Could not find target ${parsed.targetSelector}`;
        } else {
          try {
            await res.locator.click({ timeout: 5000 });
            await waitForStableDOM(page, 500, 5000);
            stepSuccess = true;
          } catch (err: any) {
            stepError = `Click failed: ${err.message}`;
          }
        }
      } 
      else if (parsed.action === 'type' && parsed.targetSelector) {
        log.push(`Action: type "${parsed.value}" into "${parsed.targetSelector}"`);
        const res = await resolveWithHealing(page, parsed.targetSelector, 'assisted', parsed.thought, 5000);
        if (!res.locator) {
          stepError = `Could not find target ${parsed.targetSelector}`;
        } else {
          try {
            await res.locator.fill(parsed.value || '', { timeout: 5000 });
            await waitForStableDOM(page, 500, 5000);
            stepSuccess = true;
          } catch (err: any) {
            stepError = `Type failed: ${err.message}`;
          }
        }
      } 
      else if (parsed.action === 'press' && parsed.value) {
        log.push(`Action: press "${parsed.value}"`);
        try {
          await page.keyboard.press(parsed.value);
          await waitForStableDOM(page, 500, 5000);
          stepSuccess = true;
        } catch (err: any) {
          stepError = `Press failed: ${err.message}`;
        }
      }
      else {
        stepError = `Unknown action or missing target/value: ${parsed.action}`;
      }

      actionHistory.push({
        step: stepCount,
        thought: parsed.thought,
        action: parsed.action,
        target: parsed.targetSelector,
        value: parsed.value,
        result: stepSuccess ? 'success' : 'error',
        error_msg: stepError || undefined,
        dom_changed: false // Will be updated on the next tick
      });

      if (!stepSuccess) {
        log.push(`Error: ${stepError}`);
        if (tracker) {
          const event = tracker.pushEvent('retry', `Step ${stepCount} failed: ${stepError}`, { step: stepCount, action: parsed.action, target: parsed.targetSelector }, { category: 'signal', capture_reason: 'retry', signal_flags: ['retry'] });
          await tracker.captureSignalState(page, event.id, 'retry');
        }
      } else {
        // Success steps are summarized in the final reasoning event.
      }

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

  log.push('\nExploration failed: Maximum steps reached.');
  page.off('dialog', dialogHandler);
  if (tracker) {
    tracker.pushEvent(
      'ai_reasoning',
      'Exploration failed: max steps reached',
      { status: 'failed', steps: stepCount },
      { category: 'summary', summary: log.join('\n') },
    );
  }
  return { passed: false, log, duration_ms: Date.now() - start, error: 'Max steps reached without success.' };
}

async function getCompactDOM(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const elements: string[] = [];
    const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [data-testid], [aria-label], h1, h2, h3, p, li, td, th, span';
    
    // Quick visibility check function
    const isVisible = (elem: Element) => {
      if (!(elem instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(elem);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = elem.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    document.querySelectorAll(interactiveSelectors).forEach((el, i) => {
      if (!isVisible(el)) return;
      if (elements.length > 80) return; // Cap output to avoid token limits
      
      const tag = el.tagName.toLowerCase();
      const attrs: string[] = [];
      for (const attr of ['id', 'data-testid', 'aria-label', 'role', 'type', 'name', 'placeholder', 'href']) {
        const val = el.getAttribute(attr);
        if (val) attrs.push(`${attr}="${val}"`);
      }
      let text = (el as HTMLElement).innerText || el.textContent || '';
      text = text.trim().replace(/\s+/g, ' ').slice(0, 100);
      
      // Only include elements that have attributes or text
      if (attrs.length > 0 || text.length > 0) {
        elements.push(`<${tag} ${attrs.join(' ')}>${text}</${tag}>`);
      }
    });
    return elements.join('\n');
  });
}
