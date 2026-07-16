import { Page } from 'playwright';

// ─── Deterministic selector suggestions (#65) ────────────────────────────────
// When a failure is selector_not_found / selector_not_visible, enrich the
// failure with (1) a DOM snippet around the selector's expected location and
// (2) closest-matching candidate selectors from the failure-time DOM, ranked
// by string/tree similarity. Explicitly NO LLM — this must work in strict
// mode with no AI key. All fields are additive to the JSON contract.
//
// Split so the ranking is pure and browser-free (testable with fixture
// candidates): the page probe only collects facts; scoring happens in Node.

export interface CandidateElement {
  tag: string;
  id?: string;
  testid?: string;
  role?: string;
  aria_label?: string;
  name?: string;
  placeholder?: string;
  /** Trimmed, whitespace-collapsed text content, capped. */
  text?: string;
  classes?: string[];
}

export interface SelectorSuggestion {
  /** Ready-to-paste selector for the candidate, most stable form first
   *  (data-testid > id > name > aria-label > tag + text). */
  selector: string;
  /** Similarity to the failed selector, 0–1. Deterministic. */
  score: number;
  /** What matched, e.g. `id "username" ≈ "user-name"`. */
  reason: string;
}

export interface SelectorContext {
  suggestions: SelectorSuggestion[];
  /** Compact HTML around the selector's expected location, truncated. */
  dom_snippet?: string;
}

/** Suggestions below this score are noise — stay silent instead. */
const MIN_SCORE = 0.55;
/** At or above this score the top suggestion is named in fix_hint. */
export const HIGH_CONFIDENCE = 0.8;
const MAX_SUGGESTIONS = 3;
const MAX_CANDIDATES = 150;
const MAX_SNIPPET_CHARS = 1000;
const PROBE_TIMEOUT_MS = 3000;

// ─── Pure similarity machinery ───────────────────────────────────────────────

/** Lowercase and strip separators so `user-name`, `userName`, `user_name`
 *  all normalize to `username`. */
function normalize(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Sørensen–Dice coefficient on character bigrams of the normalized strings.
 *  Robust to small edits and separator differences; 0–1. */
export function diceSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const ma = bigrams(na);
  const mb = bigrams(nb);
  let overlap = 0;
  for (const [bg, count] of ma) overlap += Math.min(count, mb.get(bg) || 0);
  return (2 * overlap) / (na.length - 1 + nb.length - 1);
}

/** Identifier-ish tokens pulled from the failed selector's last segment —
 *  the things worth fuzzy-matching against candidate attributes/text. */
export interface SelectorHints {
  /** id / data-testid / class / attribute-value / text tokens. */
  tokens: string[];
  /** Tag name in the last segment, if any (e.g. `button` in `button.submit`). */
  tag?: string;
}

export function parseSelectorHints(selector: string): SelectorHints {
  const tokens: string[] = [];
  const push = (t: string | undefined) => {
    if (t && t.length >= 2 && !tokens.includes(t)) tokens.push(t);
  };

  // Playwright text selectors may contain spaces — handle before splitting.
  const textSel = selector.trim().match(/^text=["']?(.+?)["']?$/)?.[1];
  if (textSel) {
    push(textSel);
    return { tokens };
  }

  // Last combinator segment is the actual target; ancestors are context.
  // Naive split is fine: quoted values with spaces only degrade to extra
  // (harmless) segments, and we only token-scan the result.
  const segment = selector.trim().split(/\s*>\s*|\s+/).pop() || selector;

  push(segment.match(/#([\w-]+)/)?.[1]);
  push(segment.match(/\[data-testid[*^$]?=["']?([^"'\]]+)/)?.[1]);
  // Other attribute values: [name="email"], [aria-label="Sign in"], …
  for (const m of segment.matchAll(/\[[\w-]+[*^$]?=["']?([^"'\]]+)/g)) {
    if (!m[0].startsWith('[data-testid')) push(m[1]);
  }
  for (const m of segment.matchAll(/\.([\w-]+)/g)) push(m[1]);
  // :has-text("Sign in") — match on the full selector, quotes protect spaces.
  push(selector.match(/:has-text\(["']?([^"')]+)/)?.[1]);

  const tag = segment.match(/^([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase();
  return { tokens, tag };
}

/** Most stable ready-to-paste selector for a candidate. */
export function buildCandidateSelector(c: CandidateElement): string {
  if (c.testid) return `[data-testid="${c.testid}"]`;
  if (c.id) return `#${c.id}`;
  if (c.name) return `${c.tag}[name="${c.name}"]`;
  if (c.aria_label) return `[aria-label="${c.aria_label}"]`;
  if (c.text) return `${c.tag}:has-text("${c.text.slice(0, 40)}")`;
  if (c.classes?.length) return `${c.tag}.${c.classes[0]}`;
  return c.tag;
}

/**
 * Rank failure-time DOM candidates by similarity to the failed selector.
 * Deterministic: identifier attributes (id/testid/name/placeholder) weigh
 * full, accessible text weighs slightly less, a tag match adds a small bonus.
 * Returns at most MAX_SUGGESTIONS above MIN_SCORE, best first; empty when
 * nothing plausible matches (silence over noise).
 */
export function rankCandidates(failedSelector: string, candidates: CandidateElement[]): SelectorSuggestion[] {
  const hints = parseSelectorHints(failedSelector);
  if (hints.tokens.length === 0) return [];

  const scored: SelectorSuggestion[] = [];
  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    let best = 0;
    let reason = '';
    const consider = (value: string | undefined, kind: string, weight: number) => {
      if (!value) return;
      for (const token of hints.tokens) {
        const s = diceSimilarity(token, value) * weight;
        if (s > best) {
          best = s;
          reason = `${kind} "${value}" ≈ "${token}"`;
        }
      }
    };

    consider(c.id, 'id', 1);
    consider(c.testid, 'data-testid', 1);
    consider(c.name, 'name', 1);
    consider(c.placeholder, 'placeholder', 0.95);
    consider(c.aria_label, 'aria-label', 0.95);
    consider(c.text?.slice(0, 60), 'text', 0.9);
    for (const cls of c.classes || []) consider(cls, 'class', 0.9);

    if (best > 0 && hints.tag && hints.tag === c.tag) best = Math.min(1, best + 0.05);
    if (best < MIN_SCORE) continue;

    const selector = buildCandidateSelector(c);
    // A candidate identical to what already failed tells the agent nothing
    // (happens on selector_not_visible, where the element exists).
    if (selector === failedSelector.trim()) continue;
    scored.push({ selector, score: Math.round(best * 100) / 100, reason });
  }

  scored.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
  // One suggestion per distinct selector (a button may score via id AND text).
  const seen = new Set<string>();
  return scored.filter((s) => !seen.has(s.selector) && seen.add(s.selector)).slice(0, MAX_SUGGESTIONS);
}

/** Renders the top suggestion into fix_hint prose — only when confident. */
export function appendTopSuggestion(hint: string, suggestions: SelectorSuggestion[]): string {
  const top = suggestions[0];
  if (!top || top.score < HIGH_CONFIDENCE) return hint;
  return `${hint} Closest match in the failure-time DOM: ${top.selector} (${top.reason}).`;
}

/** Pulls the failed selector out of a step-crash message: the engine embeds
 *  the step target as JSON (`target {"selector":"#x"}`), and raw Playwright
 *  actionability messages carry `locator('#x')`. Returns undefined when the
 *  crash names no selector (navigation timeout, etc.). */
export function extractSelectorFromCrash(message: string): string | undefined {
  const target = message.match(/target (\{.*?\}) /)?.[1];
  if (target) {
    try {
      const t = JSON.parse(target);
      if (t.selector) return t.selector;
      if (t.testId) return `[data-testid="${t.testId}"]`;
      if (t.text) return `text=${t.text}`;
    } catch { /* fall through to the locator pattern */ }
  }
  // Playwright quotes the locator with the delimiter the selector doesn't
  // use — try single-quoted first (its default), then double-quoted.
  return message.match(/waiting for locator\('([^']+)'\)/)?.[1]
    ?? message.match(/waiting for locator\("([^"]+)"\)/)?.[1];
}

// ─── Browser probe ───────────────────────────────────────────────────────────

// Runs inside the browser. Must stay serializable and self-contained.
function probeSelectorEvidence(args: {
  failedSelector: string;
  maxCandidates: number;
  maxSnippetChars: number;
}): { candidates: CandidateElement[]; dom_snippet?: string } {
  const { failedSelector, maxCandidates, maxSnippetChars } = args;

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

  const snippetOf = (el: Element): string => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('script, style, svg').forEach((n) => n.remove());
    const html = collapse(clone.outerHTML);
    return html.length > maxSnippetChars ? html.slice(0, maxSnippetChars) + '…' : html;
  };

  const tryQuery = (sel: string): Element | null => {
    try { return document.querySelector(sel); } catch { return null; }
  };

  // Expected location: the failed selector's own match (not_visible case),
  // else the deepest matching ancestor prefix of a compound selector, else a
  // landmark region.
  let context: Element | null = null;
  const exact = tryQuery(failedSelector);
  if (exact) {
    context = exact.parentElement || exact;
  } else {
    const segments = failedSelector.trim().split(/\s*>\s*|\s+/);
    for (let n = segments.length - 1; n >= 1 && !context; n--) {
      context = tryQuery(segments.slice(0, n).join(' '));
    }
  }
  if (!context) context = tryQuery('main, [role="main"], form, #root, #app') || document.body;
  const dom_snippet = context ? snippetOf(context) : undefined;

  const candidates: CandidateElement[] = [];
  const nodes = document.querySelectorAll(
    'button, a[href], input, select, textarea, label, [id], [data-testid], [role], [aria-label]',
  );
  for (const el of Array.from(nodes)) {
    if (candidates.length >= maxCandidates) break;
    const c: CandidateElement = { tag: el.tagName.toLowerCase() };
    if (el.id) c.id = el.id;
    const testid = el.getAttribute('data-testid');
    if (testid) c.testid = testid;
    const role = el.getAttribute('role');
    if (role) c.role = role;
    const aria = el.getAttribute('aria-label');
    if (aria) c.aria_label = aria;
    const name = el.getAttribute('name');
    if (name) c.name = name;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) c.placeholder = placeholder;
    const text = collapse(el.textContent || '').slice(0, 80);
    if (text) c.text = text;
    if (typeof el.className === 'string' && el.className.trim()) {
      c.classes = el.className.trim().split(/\s+/).slice(0, 3);
    }
    candidates.push(c);
  }

  return { candidates, dom_snippet };
}

/**
 * Collect selector-failure evidence from the live page and rank it. Bounded
 * and best-effort: returns null (never throws) when the page is gone or the
 * probe stalls — enrichment must never make a failing run fail harder.
 * Returns null too when there is nothing worth saying (no suggestions AND no
 * snippet), so callers can attach the result unconditionally.
 */
export async function collectSelectorContext(page: Page, failedSelector: string): Promise<SelectorContext | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probing = page.evaluate(probeSelectorEvidence, {
      failedSelector,
      maxCandidates: MAX_CANDIDATES,
      maxSnippetChars: MAX_SNIPPET_CHARS,
    });
    probing.catch(() => {}); // losing the race must not surface as unhandled
    const probe = await Promise.race([
      probing,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS); }),
    ]);
    if (!probe) return null;

    const suggestions = rankCandidates(failedSelector, probe.candidates);
    if (suggestions.length === 0 && !probe.dom_snippet) return null;
    return { suggestions, dom_snippet: probe.dom_snippet };
  } catch (e: any) {
    console.warn(`Could not collect selector suggestions: ${e?.message || e}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
