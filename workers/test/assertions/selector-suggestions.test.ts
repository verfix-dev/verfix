/**
 * Unit tests for deterministic selector suggestions (#65) —
 * workers/src/assertions/selector-suggestions.ts.
 *
 * Covers only the pure, browser-free parts (hint parsing, similarity,
 * ranking, crash-message extraction) with fixture candidates standing in for
 * the failure-time DOM. The page probe itself is exercised by the local-run
 * e2e path.
 *
 * Run with: ts-node test/assertions/selector-suggestions.test.ts
 */

import assert from 'assert';
import {
  appendTopSuggestion,
  buildCandidateSelector,
  CandidateElement,
  diceSimilarity,
  extractSelectorFromCrash,
  HIGH_CONFIDENCE,
  parseSelectorHints,
  rankCandidates,
} from '../../src/assertions/selector-suggestions';

const BASE_HINT = 'Selector "#user-name" not found in DOM. Add a stable data-testid or update the selector.';

// ─── diceSimilarity: separator/case insensitive, sane bounds ─────────────────
{
  assert.strictEqual(diceSimilarity('user-name', 'userName'), 1, 'separators and case must not matter');
  assert.ok(diceSimilarity('user-name', 'username') > 0.85, 'near-miss id should score high');
  assert.ok(diceSimilarity('checkout-button', 'nav') < 0.2, 'unrelated strings score low');
  assert.strictEqual(diceSimilarity('', 'x'), 0);
  console.log('PASS: diceSimilarity — normalization and bounds');
}

// ─── parseSelectorHints: tokens from the last segment ────────────────────────
{
  assert.deepStrictEqual(parseSelectorHints('#user-name').tokens, ['user-name']);
  assert.deepStrictEqual(parseSelectorHints('[data-testid="login-submit"]').tokens, ['login-submit']);
  const compound = parseSelectorHints('form.checkout > button.submit-btn');
  assert.deepStrictEqual(compound.tokens, ['submit-btn'], 'only the last segment is the target');
  assert.strictEqual(compound.tag, 'button');
  assert.deepStrictEqual(parseSelectorHints('text=Sign in').tokens, ['Sign in']);
  assert.deepStrictEqual(parseSelectorHints('div > span:nth-child(2)').tokens, [], 'structural selectors carry no usable tokens');
  console.log('PASS: parseSelectorHints — id/testid/class/text tokens, last segment only');
}

// ─── Case 1 (issue example): near-miss id ────────────────────────────────────
{
  const candidates: CandidateElement[] = [
    { tag: 'input', id: 'username', name: 'username', placeholder: 'Username' },
    { tag: 'input', id: 'password', name: 'password' },
    { tag: 'button', text: 'Login', classes: ['btn', 'btn-primary'] },
  ];
  const suggestions = rankCandidates('#user-name', candidates);
  assert.ok(suggestions.length >= 1, 'expected at least one suggestion');
  assert.strictEqual(suggestions[0].selector, '#username', `expected #username first, got ${suggestions[0].selector}`);
  assert.ok(suggestions[0].score >= HIGH_CONFIDENCE, `near-miss id should be high confidence, got ${suggestions[0].score}`);
  assert.ok(suggestions[0].reason.includes('username'), 'reason names what matched');

  const hint = appendTopSuggestion(BASE_HINT, suggestions);
  assert.ok(hint.startsWith(BASE_HINT), 'base hint preserved');
  assert.ok(hint.includes('Closest match in the failure-time DOM: #username'), `top candidate rendered into hint, got: ${hint}`);
  console.log('PASS: near-miss id (#user-name → #username) suggested with high confidence');
}

// ─── Case 2: role/text match when no attribute is close ─────────────────────
{
  const candidates: CandidateElement[] = [
    { tag: 'button', role: 'button', aria_label: 'Login submit', text: 'Log in' },
    { tag: 'a', text: 'Forgot password?' },
    { tag: 'input', name: 'email', placeholder: 'Email address' },
  ];
  const suggestions = rankCandidates('[data-testid="login-submit"]', candidates);
  assert.ok(suggestions.length >= 1, 'expected a text/aria match');
  assert.strictEqual(suggestions[0].selector, '[aria-label="Login submit"]');
  assert.ok(suggestions[0].reason.includes('aria-label'), `reason should say aria-label, got: ${suggestions[0].reason}`);
  console.log('PASS: aria-label/text similarity matches when no id/testid is close');
}

// ─── Case 3: no reasonable candidate ⇒ silent ────────────────────────────────
{
  const candidates: CandidateElement[] = [
    { tag: 'nav', id: 'main-nav' },
    { tag: 'input', id: 'search', placeholder: 'Search…' },
    { tag: 'a', text: 'Home' },
  ];
  const suggestions = rankCandidates('#checkout-button', candidates);
  assert.strictEqual(suggestions.length, 0, 'nothing plausible -> no suggestions (silence over noise)');
  assert.strictEqual(appendTopSuggestion(BASE_HINT, suggestions), BASE_HINT, 'hint unchanged with no suggestions');
  console.log('PASS: no reasonable candidate stays silent');
}

// ─── selector_not_visible: the failed selector itself is not re-suggested ────
{
  const candidates: CandidateElement[] = [
    { tag: 'button', id: 'checkout', text: 'Checkout' },
  ];
  const suggestions = rankCandidates('#checkout', candidates);
  assert.strictEqual(suggestions.length, 0, 'suggesting the selector that already failed tells the agent nothing');
  console.log('PASS: exact-match candidate (not_visible case) is filtered out');
}

// ─── Low-confidence suggestions are listed but not rendered into fix_hint ────
{
  const candidates: CandidateElement[] = [
    { tag: 'button', id: 'submit-order', text: 'Place order' },
  ];
  const suggestions = rankCandidates('#submit-btn', candidates);
  assert.ok(suggestions.length === 0 || suggestions[0].score < HIGH_CONFIDENCE, 'partial match must not be high confidence');
  assert.strictEqual(appendTopSuggestion(BASE_HINT, suggestions), BASE_HINT, 'hint only names high-confidence matches');
  console.log('PASS: below-threshold matches never reach fix_hint');
}

// ─── Ranking: capped, deduped, best first ────────────────────────────────────
{
  const candidates: CandidateElement[] = [
    { tag: 'input', id: 'username' },
    { tag: 'input', id: 'user-name-2' },
    { tag: 'input', name: 'user_name' },
    { tag: 'input', placeholder: 'user name' },
    { tag: 'input', id: 'username' }, // duplicate element
  ];
  const suggestions = rankCandidates('#user-name', candidates);
  assert.ok(suggestions.length <= 3, 'at most 3 suggestions');
  const unique = new Set(suggestions.map((s) => s.selector));
  assert.strictEqual(unique.size, suggestions.length, 'no duplicate selectors');
  for (let i = 1; i < suggestions.length; i++) {
    assert.ok(suggestions[i - 1].score >= suggestions[i].score, 'sorted best first');
  }
  console.log('PASS: suggestions are capped, deduped, and sorted');
}

// ─── buildCandidateSelector: stability preference order ─────────────────────
{
  assert.strictEqual(
    buildCandidateSelector({ tag: 'button', testid: 'buy', id: 'buy-btn', text: 'Buy' }),
    '[data-testid="buy"]',
  );
  assert.strictEqual(buildCandidateSelector({ tag: 'button', id: 'buy-btn', text: 'Buy' }), '#buy-btn');
  assert.strictEqual(buildCandidateSelector({ tag: 'input', name: 'email' }), 'input[name="email"]');
  assert.strictEqual(buildCandidateSelector({ tag: 'button', aria_label: 'Close' }), '[aria-label="Close"]');
  assert.strictEqual(buildCandidateSelector({ tag: 'button', text: 'Buy now' }), 'button:has-text("Buy now")');
  console.log('PASS: buildCandidateSelector prefers data-testid > id > name > aria-label > text');
}

// ─── extractSelectorFromCrash ────────────────────────────────────────────────
{
  assert.strictEqual(
    extractSelectorFromCrash('selector_not_found: click target {"selector":"#user-name"} did not match any element in the DOM within 5000ms'),
    '#user-name',
  );
  assert.strictEqual(
    extractSelectorFromCrash('selector_not_found: click target {"testId":"login-submit"} did not match any element in the DOM within 5000ms'),
    '[data-testid="login-submit"]',
  );
  assert.strictEqual(
    extractSelectorFromCrash("locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('#checkout-button')"),
    '#checkout-button',
  );
  // Playwright nests the selector's own quotes inside the locator quoting.
  assert.strictEqual(
    extractSelectorFromCrash('locator.click: Timeout 1500ms exceeded.\nCall log:\n  - waiting for locator(\'[data-testid="checkout"]\')\n  -   locator resolved to <button>…</button>'),
    '[data-testid="checkout"]',
  );
  assert.strictEqual(extractSelectorFromCrash('page.goto: Timeout 30000ms exceeded'), undefined);
  console.log('PASS: extractSelectorFromCrash — engine-prefixed targets and raw Playwright locators');
}

console.log('\nAll selector-suggestion tests passed.');
