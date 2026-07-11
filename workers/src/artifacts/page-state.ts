import { Page } from 'playwright';
import { ConsoleLine, NetworkRequest } from '../assertions/types';

// ─── Failure-time page-state facts (#55) ─────────────────────────────────────
// Cause-agnostic FACTS about what was true on the live page when a run failed:
// no interpretation, no hypotheses — those belong to the analyzer pipeline
// (assertions/analyzers.ts), which consumes this as evidence. Facts have no
// false positives, so an agent reading them can diagnose causes Verfix has
// never heard of.
//
// Collected only on the failure path via one page.evaluate — computed styles
// and geometry are not recoverable from the saved static HTML snapshot.

export interface OverlayFact {
  /** How it was detected: an ARIA dialog, or a full-viewport positioned element. */
  kind: 'dialog' | 'overlay';
  /** Cheap element descriptor, e.g. `div#welcome-modal.modal`. */
  selector: string;
  /** Accessible name (aria-label / labelledby / first heading / leading text). */
  name: string;
  /** Fraction of the viewport the element covers, 0–1. */
  viewport_coverage: number;
}

export interface PageState {
  url: string;
  title: string;
  /** Visible open dialogs and full-viewport fixed/absolute overlays. */
  open_dialogs: OverlayFact[];
  /** Visible interactive elements (buttons/links/inputs) with accessible names. */
  visible_elements: Array<{ role: string; name: string }>;
  visible_elements_truncated: boolean;
  /** Non-excluded console errors captured earlier in the run. */
  prior_console_errors: number;
  /** Requests that returned >= 400 or failed outright (status 0) earlier in the run. */
  prior_failed_requests: number;
}

type ProbeResult = Omit<PageState, 'prior_console_errors' | 'prior_failed_requests'>;

const MAX_DIALOGS = 5;
const MAX_ELEMENTS = 20;
const PROBE_TIMEOUT_MS = 3000;

// Runs inside the browser. Everything here must stay serializable and
// self-contained (no closure over Node scope).
function probePage(caps: { maxDialogs: number; maxElements: number }): ProbeResult {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const isVisible = (el: Element): boolean => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const coverage = (el: Element): number => {
    if (!vw || !vh) return 0;
    const r = el.getBoundingClientRect();
    const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return (ix * iy) / (vw * vh);
  };

  const accName = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ').trim();
      if (t) return t;
    }
    const heading = el.querySelector('h1, h2, h3, h4');
    const headingText = heading?.textContent?.trim();
    if (headingText) return headingText;
    return (el.textContent || '').trim().replace(/\s+/g, ' ');
  };

  const descriptor = (el: Element): string => {
    let d = el.tagName.toLowerCase();
    if (el.id) d += `#${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) {
      d += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    }
    return d;
  };

  const seen = new Set<Element>();
  const open_dialogs: OverlayFact[] = [];
  const pushOverlay = (el: Element, kind: 'dialog' | 'overlay') => {
    if (seen.has(el) || open_dialogs.length >= caps.maxDialogs) return;
    seen.add(el);
    open_dialogs.push({
      kind,
      selector: descriptor(el),
      name: accName(el).slice(0, 120),
      viewport_coverage: Math.round(coverage(el) * 100) / 100,
    });
  };

  for (const el of Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))) {
    if (isVisible(el)) pushOverlay(el, 'dialog');
  }
  // Full-viewport positioned elements stacked over the page center (modal
  // backdrops, cookie walls). elementsFromPoint already skips
  // pointer-events:none elements — which aren't blocking anyway.
  for (const el of document.elementsFromPoint(vw / 2, vh / 2)) {
    if (el === document.documentElement || el === document.body) continue;
    const s = getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'absolute') && coverage(el) >= 0.8) {
      pushOverlay(el, 'overlay');
    }
  }

  const visible_elements: Array<{ role: string; name: string }> = [];
  let visible_elements_truncated = false;
  for (const el of Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"]'))) {
    if (!isVisible(el)) continue;
    if (visible_elements.length >= caps.maxElements) {
      visible_elements_truncated = true;
      break;
    }
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag);
    const name = (
      el.getAttribute('aria-label')
      || (el as HTMLInputElement).placeholder
      || el.textContent
      || (el as HTMLInputElement).value
      || ''
    ).trim().replace(/\s+/g, ' ').slice(0, 60);
    visible_elements.push({ role, name });
  }

  return {
    url: location.href,
    title: document.title,
    open_dialogs,
    visible_elements,
    visible_elements_truncated,
  };
}

function compilePatterns(patterns: string[] | undefined): RegExp[] {
  const compiled: RegExp[] = [];
  for (const p of patterns ?? []) {
    try {
      compiled.push(new RegExp(p));
    } catch {
      // Invalid pattern already surfaces as a no_console_errors failure.
    }
  }
  return compiled;
}

/**
 * Collects failure-time facts from the live page. Best-effort and bounded:
 * returns null (never throws) when the page is gone or the probe stalls —
 * facts must never make a failing run fail harder.
 */
export async function collectPageState(
  page: Page,
  consoleLogs: ConsoleLine[],
  networkRequests: NetworkRequest[],
  consoleExcludePatterns?: string[],
): Promise<PageState | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probing = page.evaluate(probePage, { maxDialogs: MAX_DIALOGS, maxElements: MAX_ELEMENTS });
    // If the timeout wins the race, the abandoned evaluate may still reject
    // later (page closed) — that must not surface as an unhandled rejection.
    probing.catch(() => {});
    const probe = await Promise.race([
      probing,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS); }),
    ]);
    if (!probe) return null;

    const excludes = compilePatterns(consoleExcludePatterns);
    return {
      ...probe,
      prior_console_errors: consoleLogs
        .filter((l) => l.type === 'error' && !excludes.some((rx) => rx.test(l.text))).length,
      prior_failed_requests: networkRequests
        .filter((r) => r.status >= 400 || r.status === 0).length,
    };
  } catch (e: any) {
    console.warn(`Could not collect failure-time page state: ${e?.message || e}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
