/**
 * Named storage-state persistence for auth reuse (flow useState / saveState).
 *
 * Capture (captureState) uses Playwright's context.storageState with
 * indexedDB, plus a sessionStorage sidecar file (Playwright's storageState
 * can't carry sessionStorage).
 *
 * Restore has two paths:
 *  - Context creation (engine fast path): full fidelity via the storageState
 *    option (cookies + localStorage + IndexedDB). Only possible before the
 *    context exists, so the engine uses it when the run's FIRST flow declares
 *    useState.
 *  - In-page (restoreStateInPage): cookies via context.addCookies, then
 *    local/sessionStorage seeded by visiting a routed synthetic blank page on
 *    each saved origin. Runs right before the flow that declared useState, so
 *    earlier flows in the same run (e.g. one with clearState) never see the
 *    restored session.
 *    ponytail: IndexedDB can't be seeded into a live context (Playwright only
 *    restores it at newContext) — IndexedDB token caches (Firebase, MSAL)
 *    restore only via the fast path. Upgrade path: fresh context per flow
 *    with merged tracing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page } from 'playwright';

// State names become filenames — reject anything that could escape stateDir.
export function validateStateName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid storage state name "${name}" — use only letters, digits, dash, underscore`);
  }
}

export function storageStatePath(stateDir: string, name: string): string {
  validateStateName(name);
  return path.join(stateDir, `${name}.json`);
}

// sessionStorage sidecar, next to the storage-state file.
export function sessionStatePath(stateDir: string, name: string): string {
  validateStateName(name);
  return path.join(stateDir, `${name}.session.json`);
}

interface SessionSidecar {
  origin: string;
  entries: Record<string, string>;
}

function readSessionSidecar(stateDir: string, name: string): SessionSidecar | null {
  const sp = sessionStatePath(stateDir, name);
  if (!fs.existsSync(sp)) return null;
  try {
    return JSON.parse(fs.readFileSync(sp, 'utf-8')) as SessionSidecar;
  } catch (e: any) {
    console.warn(`   ⚠ Could not read sessionStorage sidecar for "${name}": ${e.message}`);
    return null;
  }
}

// Synthetic path fulfilled by a page.route — lets us execute storage writes
// on an origin without booting the app under test there.
const SEED_PATH = '/__verfix__/state-seed';

/**
 * Seed localStorage/sessionStorage for one origin by navigating the page to a
 * routed blank document on that origin. `local`/`session` are full
 * replacements (the store is cleared first); pass undefined to leave a store
 * untouched. Leaves the page parked on the blank seed document — the caller
 * must navigate afterwards so the app boots with the seeded state.
 */
export async function seedWebStorage(
  page: Page,
  origin: string,
  local: Record<string, string> | undefined,
  session: Record<string, string> | undefined,
): Promise<void> {
  if (!/^https?:\/\//.test(origin)) return; // storage needs a real http(s) origin
  await page.route(`**${SEED_PATH}`, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>verfix state seed</title>',
  }));
  try {
    await page.goto(origin + SEED_PATH, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ local, session }) => {
      if (local) {
        localStorage.clear();
        for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
      }
      if (session) {
        sessionStorage.clear();
        for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
      }
    }, { local, session });
  } finally {
    await page.unroute(`**${SEED_PATH}`);
  }
}

/**
 * Restore the named state into a live context: replace cookies, then seed
 * local/sessionStorage per saved origin. Returns false (without touching the
 * context) when no state file exists yet. On success the page is parked on a
 * blank seed document — the caller must navigate so the app boots with the
 * restored session.
 */
export async function restoreStateInPage(
  context: BrowserContext,
  page: Page,
  stateDir: string,
  name: string,
): Promise<boolean> {
  const p = storageStatePath(stateDir, name);
  if (!fs.existsSync(p)) return false;
  const state = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
    cookies?: any[];
    origins?: { origin: string; localStorage?: { name: string; value: string }[] }[];
  };

  // Restore replaces the session: drop cookies and the current page's web
  // storage so nothing from a previous flow leaks through.
  await context.clearCookies();
  try {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  } catch {
    // Storage APIs unavailable (e.g. about:blank) — nothing to clear.
  }
  if (state.cookies?.length) await context.addCookies(state.cookies);

  const perOrigin = new Map<string, { local?: Record<string, string>; session?: Record<string, string> }>();
  for (const o of state.origins || []) {
    perOrigin.set(o.origin, {
      local: Object.fromEntries((o.localStorage || []).map(e => [e.name, e.value])),
    });
  }
  const sidecar = readSessionSidecar(stateDir, name);
  if (sidecar) {
    const entry = perOrigin.get(sidecar.origin) || {};
    entry.session = sidecar.entries;
    perOrigin.set(sidecar.origin, entry);
  }
  for (const [origin, stores] of perOrigin) {
    await seedWebStorage(page, origin, stores.local, stores.session);
  }
  return true;
}

/**
 * Capture the context's live session under the given name: Playwright
 * storageState (cookies + localStorage + IndexedDB) plus a sessionStorage
 * sidecar for the current page's origin.
 */
export async function captureState(
  context: BrowserContext,
  page: Page,
  stateDir: string,
  name: string,
): Promise<void> {
  const p = storageStatePath(stateDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // indexedDB covers Firebase Auth / MSAL-style token caches.
  await context.storageState({ path: p, indexedDB: true });
  try {
    const entries = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k !== null) out[k] = sessionStorage.getItem(k) ?? '';
      }
      return out;
    });
    const sp = sessionStatePath(stateDir, name);
    if (Object.keys(entries).length > 0) {
      fs.writeFileSync(sp, JSON.stringify({ origin: new URL(page.url()).origin, entries }, null, 2));
    } else {
      // Nothing in sessionStorage now — drop any stale sidecar so a future
      // restore matches what this session actually holds.
      fs.rmSync(sp, { force: true });
    }
  } catch (e: any) {
    console.warn(`   ⚠ Could not capture sessionStorage for "${name}": ${e.message}`);
  }
}
