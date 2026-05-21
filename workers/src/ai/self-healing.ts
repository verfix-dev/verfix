/**
 * Self-Healing Selectors — layered resolution for assisted mode.
 *
 * Resolution order:
 *   1. Exact selector (CSS / data-testid) — deterministic
 *   2. Semantic discovery (aria-label, role, text content) — accessibility tree
 *   3. AI fallback (LLM analyzes DOM and suggests element) — only when 1+2 fail
 *
 * Only active in `assisted` mode. Strict mode skips directly to failure.
 * Every attempt is logged with timing for debugging.
 */

import { Page, Locator } from 'playwright';
import { chatCompletion, isAIEnabled } from './provider';

export interface ResolutionAttempt {
  strategy: 'exact' | 'semantic' | 'ai';
  selector: string;
  found: boolean;
  duration_ms: number;
  error?: string;
}

export interface ResolutionResult {
  locator: Locator | null;
  attempts: ResolutionAttempt[];
  healed: boolean; // true if a non-primary strategy succeeded
}

/**
 * Try to resolve an element using the layered strategy.
 * Returns the first locator that resolves to a visible element.
 */
export async function resolveWithHealing(
  page: Page,
  originalSelector: string,
  mode: string,
  intent?: string,  // e.g. "login button", "email input"
  timeout = 3000,
): Promise<ResolutionResult> {
  const attempts: ResolutionAttempt[] = [];

  // ── Attempt 1: Exact selector ──────────────────────────────────
  const exactResult = await tryLocator(page, originalSelector, timeout);
  attempts.push({ strategy: 'exact', selector: originalSelector, ...exactResult });

  if (exactResult.found) {
    return { locator: page.locator(originalSelector).first(), attempts, healed: false };
  }

  // In strict mode, stop here — no healing
  if (mode === 'strict') {
    return { locator: null, attempts, healed: false };
  }

  // ── Attempt 2: Semantic discovery ──────────────────────────────
  const semanticSelectors = generateSemanticSelectors(originalSelector, intent);

  for (const sem of semanticSelectors) {
    const semResult = await tryLocator(page, sem, Math.min(timeout, 2000));
    attempts.push({ strategy: 'semantic', selector: sem, ...semResult });

    if (semResult.found) {
      console.log(`    🔧 Healed: "${originalSelector}" → "${sem}" (semantic)`);
      return { locator: page.locator(sem).first(), attempts, healed: true };
    }
  }

  // ── Attempt 3: AI fallback ─────────────────────────────────────
  if (!isAIEnabled()) {
    return { locator: null, attempts, healed: false };
  }

  const aiSelector = await aiSuggestSelector(page, originalSelector, intent);
  if (aiSelector) {
    const aiResult = await tryLocator(page, aiSelector, 2000);
    attempts.push({ strategy: 'ai', selector: aiSelector, ...aiResult });

    if (aiResult.found) {
      console.log(`    🤖 Healed: "${originalSelector}" → "${aiSelector}" (AI)`);
      return { locator: page.locator(aiSelector).first(), attempts, healed: true };
    }
  }

  return { locator: null, attempts, healed: false };
}

// ── Helpers ──────────────────────────────────────────────────────

async function tryLocator(
  page: Page,
  selector: string,
  timeout: number,
): Promise<{ found: boolean; duration_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout });
    return { found: visible, duration_ms: Date.now() - start };
  } catch (e: any) {
    return { found: false, duration_ms: Date.now() - start, error: e.message };
  }
}

/**
 * Generate semantic selector alternatives from the original selector + intent.
 * Uses accessibility patterns: aria-label, role, text content.
 */
function generateSemanticSelectors(original: string, intent?: string): string[] {
  const selectors: string[] = [];

  // Extract useful text from selector
  const textMatch = original.match(/["']([^"']+)["']/);
  const idMatch = original.match(/#([\w-]+)/);
  const testIdMatch = original.match(/\[data-testid=["']([^"']+)["']\]/);

  const hintText = intent || textMatch?.[1] || testIdMatch?.[1]?.replace(/[-_]/g, ' ') || idMatch?.[1]?.replace(/[-_]/g, ' ');

  if (hintText) {
    // Try aria-label
    selectors.push(`[aria-label="${hintText}"]`);
    selectors.push(`[aria-label*="${hintText}" i]`);

    // Try role + name
    selectors.push(`[role="button"]:has-text("${hintText}")`);
    selectors.push(`button:has-text("${hintText}")`);
    selectors.push(`a:has-text("${hintText}")`);
    selectors.push(`input[placeholder*="${hintText}" i]`);

    // Try text content directly
    selectors.push(`text="${hintText}"`);
  }

  return selectors;
}

/**
 * AI fallback: send a compact DOM snapshot to the LLM and ask for a selector.
 */
async function aiSuggestSelector(
  page: Page,
  failedSelector: string,
  intent?: string,
): Promise<string | null> {
  const start = Date.now();

  try {
    // Get a compact DOM representation (just interactive elements)
    const compactDOM = await page.evaluate(() => {
      const elements: string[] = [];
      const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [data-testid], [aria-label]';
      document.querySelectorAll(interactiveSelectors).forEach((el, i) => {
        if (i > 50) return; // Cap at 50 elements
        const tag = el.tagName.toLowerCase();
        const attrs: string[] = [];
        for (const attr of ['id', 'data-testid', 'aria-label', 'role', 'type', 'name', 'placeholder', 'href']) {
          const val = el.getAttribute(attr);
          if (val) attrs.push(`${attr}="${val}"`);
        }
        const text = el.textContent?.trim().slice(0, 60) || '';
        elements.push(`<${tag} ${attrs.join(' ')}>${text}</${tag}>`);
      });
      return elements.join('\n');
    });

    const response = await chatCompletion([
      {
        role: 'system',
        content: 'You are a CSS selector expert. Given a failed selector and the page DOM, suggest the best alternative CSS selector. Reply with ONLY the selector string, nothing else.',
      },
      {
        role: 'user',
        content: `Failed selector: ${failedSelector}\n${intent ? `Intent: ${intent}\n` : ''}\nPage interactive elements:\n${compactDOM}`,
      },
    ], { temperature: 0.1, maxTokens: 100 });

    if (response) {
      const selector = response.trim().replace(/^["'`]|["'`]$/g, '');
      console.log(`    🤖 AI suggested: "${selector}" (${Date.now() - start}ms)`);
      return selector;
    }
  } catch (e: any) {
    console.warn(`    ⚠ AI selector suggestion failed: ${e.message}`);
  }

  return null;
}
