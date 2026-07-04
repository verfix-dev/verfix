import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// The engine (and with it Playwright) is imported lazily inside runLocal() so
// server-mode commands never pay its load cost.
import type { ExecutionResult } from '@verfix/engine';

/** How many past runs to keep under .verfix/runs/. */
const KEEP_RUNS = 20;

export interface LocalBrowserConfig {
  channel?: string;
  headless?: boolean;
}

export interface LocalRunOptions {
  /** Headless request from the CLI (--show-browser → false). */
  headless: boolean;
  /** Optional `browser` block from verfix.config.json. */
  browser?: LocalBrowserConfig;
  /** JSON output mode: keep stdout pure by diverting engine logs to stderr. */
  json: boolean;
  /** Skip the first-run Chromium download; fail fast with browser_not_installed instead. */
  skipDownload?: boolean;
}

export class BrowserNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserNotInstalledError';
  }
}

export function localRunsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.verfix', 'runs');
}

/**
 * Resolve the exact Playwright copy the engine launches (its own dependency),
 * so the browser-presence check and `install chromium` target the same
 * browser revision the engine will actually use.
 */
function resolveEnginePlaywright(): { chromium: any; cliPath: string } {
  const engineEntry = require.resolve('@verfix/engine');
  const pwEntry = require.resolve('playwright', { paths: [engineEntry] });
  return {
    chromium: require(pwEntry).chromium,
    cliPath: path.join(path.dirname(pwEntry), 'cli.js'),
  };
}

/** Path to the engine-resolved Playwright CLI (for show-trace etc). */
export function playwrightCliPath(): string {
  return resolveEnginePlaywright().cliPath;
}

/**
 * Whether the @verfix/engine runtime module itself can be resolved. This is the
 * hard prerequisite for every local command — without it, `run` cannot load
 * Playwright and `status`/`doctor` cannot even check Chromium. Distinct from
 * isChromiumInstalled(): a missing engine is a packaging/install break (fatal,
 * "reinstall verfix"), whereas a missing browser is a normal first-run state
 * (auto-downloads). Checking this first stops `status` from misreporting a
 * broken engine as the benign "Chromium not installed".
 */
export function isEngineInstalled(): boolean {
  try {
    require.resolve('@verfix/engine');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the engine's Chromium (or a pinned channel browser) is launchable.
 *
 * Checks BOTH the full Chromium (what executablePath() reports) AND the
 * headless shell directory (what headless launches actually use — a SEPARATE
 * binary). A partial install — full Chromium present, headless shell absent —
 * would pass a naive executablePath()-only check but crash at launch time with
 * "Executable doesn't exist at chromium_headless_shell-XXXX/...". This is
 * exactly the bug that caused silent crashes when the headless shell wasn't
 * downloaded.
 */
export function isChromiumInstalled(browser?: LocalBrowserConfig): boolean {
  if (browser?.channel) return true;
  try {
    const execPath = resolveEnginePlaywright().chromium.executablePath();
    if (!execPath || !fs.existsSync(execPath)) return false;
    // Derive the headless shell directory from the full Chromium path and
    // verify it exists. execPath looks like:
    //   ~/.cache/ms-playwright/chromium-1228/chrome-linux/chrome
    // The headless shell lives at:
    //   ~/.cache/ms-playwright/chromium_headless_shell-1228/...
    const revMatch = execPath.match(/chromium-(\d+)/);
    if (revMatch) {
      const cacheDir = path.dirname(path.dirname(path.dirname(execPath)));
      const headlessShellDir = path.join(cacheDir, `chromium_headless_shell-${revMatch[1]}`);
      if (!fs.existsSync(headlessShellDir)) return false;
    }
    return true;
  } catch {
    // executablePath() throws when the registry entry is missing
    return false;
  }
}

/**
 * An installed Chrome/Edge the engine can drive via Playwright's `channel`
 * option — reuses the user's browser and skips the ~130MB Chromium download.
 */
export interface DetectedBrowser {
  /** Playwright channel string passed to the engine ('chrome' | 'msedge'). */
  channel: string;
  /** Detected executable path (shown to the user). */
  path: string;
  /** Human-readable name for prompts/logs. */
  displayName: string;
}

// ponytail: naive per-OS path scan. Ceiling: a non-standard install location
// (e.g. Chrome in a custom dir, or a portable build) won't be detected, and a
// dangling symlink resolves to "not installed". Upgrade path: spawn the binary
// with --version, but that's heavier and can hang — path scan is the right rung
// for a one-time init prompt where a miss just falls back to the Chromium download.
const INSTALLED_BROWSER_PATHS: Record<string, { channel: string; displayName: string; paths: string[] }[]> = {
  darwin: [
    { channel: 'chrome', displayName: 'Google Chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
    { channel: 'msedge', displayName: 'Microsoft Edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
  ],
  win32: [
    { channel: 'chrome', displayName: 'Google Chrome', paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ] },
    { channel: 'msedge', displayName: 'Microsoft Edge', paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ] },
  ],
  linux: [
    { channel: 'chrome', displayName: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] },
    { channel: 'msedge', displayName: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'] },
  ],
};

/**
 * Detect an installed Chrome or Edge the engine could drive instead of
 * downloading Chromium. Returns the first match (Chrome preferred over Edge),
 * or null if none found. Used by `verfix init` to offer a skip-the-download path.
 */
export function detectInstalledBrowser(): DetectedBrowser | null {
  const candidates = INSTALLED_BROWSER_PATHS[process.platform] || [];
  for (const c of candidates) {
    for (const p of c.paths) {
      if (fs.existsSync(p)) {
        return { channel: c.channel, displayName: c.displayName, path: p };
      }
    }
  }
  return null;
}

/**
 * Ensure a Chromium the engine can launch exists. Skipped entirely when config
 * pins a browser channel (e.g. installed Chrome). All progress goes to stderr
 * — stdout stays pure for --output json.
 *
 * Always runs `playwright install chromium`, which is IDEMPOTENT: when the
 * browser is fully installed it completes in <1s with no download; when pieces
 * are missing (e.g. the headless shell that headless launches use, which is a
 * separate binary from the full Chromium) it downloads just what's missing.
 * This is more reliable than our own isChromiumInstalled() fast-path, which
 * could report a false positive on a partial install and skip the download.
 */
export async function ensureChromium(browser?: LocalBrowserConfig, skipDownload = false): Promise<void> {
  // A pinned channel (e.g. 'chrome') uses the user's installed browser — no
  // Playwright download needed.
  if (browser?.channel) return;

  if (skipDownload) {
    throw new BrowserNotInstalledError(
      'Chromium is not installed. Run: verfix install',
    );
  }

  const { cliPath } = resolveEnginePlaywright();
  // `playwright install chromium` is idempotent — fast no-op when fully
  // installed, downloads only missing pieces otherwise (e.g. the headless
  // shell). Its own progress output goes to stderr (stdio: ['ignore', 2, 2]).
  const res = spawnSync(process.execPath, [cliPath, 'install', 'chromium'], {
    stdio: ['ignore', 2, 2],
  });
  if (res.status !== 0) {
    throw new BrowserNotInstalledError(
      'Chromium install failed. Set "browser": {"channel": "chrome"} in verfix.config.json to use your installed Chrome, or run: verfix install',
    );
  }
}

/**
 * Run one verification in-process and persist the result + artifacts under
 * .verfix/runs/. Mirrors the server's retry semantics: assertion failures do
 * NOT retry (the engine returns a result for those); only engine rejections
 * (hard timeout, browser-pool crash) are retried, `retries` total attempts
 * with exponential 1500ms backoff.
 */
export async function runLocal(payload: any, opts: LocalRunOptions): Promise<ExecutionResult> {
  const runsDir = localRunsDir();
  fs.mkdirSync(runsDir, { recursive: true });
  pruneRuns(runsDir);

  await ensureChromium(opts.browser, opts.skipDownload);

  const engine = await import('@verfix/engine');

  const id = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobPayload = { ...payload, id };
  const headless = opts.browser?.headless ?? opts.headless;
  const totalAttempts = Math.max(1, jobPayload.retries ?? 2);

  const restoreConsole = opts.json ? redirectConsoleToStderr() : null;
  let result: ExecutionResult;
  try {
    let attempt = 0;
    for (;;) {
      try {
        result = await engine.runVerification(jobPayload, {
          artifactsDir: runsDir,
          attempt,
          headless,
          channel: opts.browser?.channel,
          // The process exits right after the run, so a detached summary would
          // be lost. Strict mode never calls AI, so skip the wait there.
          awaitSummary: jobPayload.mode !== 'strict',
        });
        break;
      } catch (err: any) {
        attempt++;
        if (attempt >= totalAttempts) {
          // Mirror the server's failed-handler reconciliation: exhausted
          // retries become a failed result, not a CLI crash.
          const nowIso = new Date().toISOString();
          result = {
            executionId: id,
            status: 'failed',
            task: jobPayload.task,
            url: jobPayload.url,
            mode: jobPayload.mode || 'strict',
            passed: false,
            duration_ms: 0,
            retry_count: attempt,
            events: [],
            assertions: [],
            artifacts: {},
            console_logs: [],
            network_requests: [],
            error: err.message || 'Verification crashed',
            created_at: nowIso,
            completed_at: nowIso,
          } as ExecutionResult;
          break;
        }
        console.error(`Run crashed (${err.message}), retrying (attempt ${attempt + 1}/${totalAttempts})...`);
        // Self-repair: if the browser binary is missing (partial install,
        // version mismatch, headless shell not downloaded), re-run the
        // idempotent installer before retrying. `playwright install chromium`
        // only downloads what's missing, so this is fast if already complete.
        if (/Executable doesn't exist/i.test(err.message)) {
          console.error('Browser binary missing — repairing before retry...');
          try {
            await ensureChromium(opts.browser, false);
          } catch {
            // best-effort repair; if it fails, the retry will fail and be reported
          }
        }
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt - 1)));
      }
    }
  } finally {
    restoreConsole?.();
    await engine.shutdownEngine().catch(() => {});
  }

  fs.writeFileSync(path.join(runsDir, `${id}.json`), JSON.stringify(result, null, 2) + '\n', 'utf-8');
  return result;
}

/** Find the trace zip for an execution id (or the newest run when omitted). */
export function findTraceZip(executionId?: string, cwd: string = process.cwd()): string | null {
  const runsDir = localRunsDir(cwd);
  if (!fs.existsSync(runsDir)) return null;

  if (executionId) {
    const p = path.join(runsDir, `${executionId}_trace.zip`);
    return fs.existsSync(p) ? p : null;
  }

  const traces = fs.readdirSync(runsDir)
    .filter(f => f.endsWith('_trace.zip'))
    .map(f => path.join(runsDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return traces[0] ?? null;
}

/** Read a persisted local run result by execution id. */
export function readLocalResult(executionId: string, cwd: string = process.cwd()): ExecutionResult | null {
  const p = path.join(localRunsDir(cwd), `${executionId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** List persisted local runs, newest first. */
export function listLocalResults(cwd: string = process.cwd()): ExecutionResult[] {
  const runsDir = localRunsDir(cwd);
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .filter(f => f.startsWith('exec_') && f.endsWith('.json'))
    .map(f => path.join(runsDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map(p => {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
    })
    .filter(Boolean) as ExecutionResult[];
}

/**
 * Keep only the newest KEEP_RUNS-1 runs (a new one is about to be written).
 * One-shot synchronous sweep — local mode has no long-lived process for a
 * cleanup timer.
 */
function pruneRuns(runsDir: string): void {
  let ids: { id: string; mtime: number }[];
  try {
    ids = fs.readdirSync(runsDir)
      .filter(f => f.startsWith('exec_') && f.endsWith('.json'))
      .map(f => ({ id: f.slice(0, -'.json'.length), mtime: fs.statSync(path.join(runsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }

  const stale = ids.slice(KEEP_RUNS - 1).map(e => e.id);
  if (stale.length === 0) return;

  const entries = fs.readdirSync(runsDir);
  for (const id of stale) {
    for (const entry of entries) {
      if (entry === id || entry.startsWith(`${id}.`) || entry.startsWith(`${id}_`)) {
        try {
          fs.rmSync(path.join(runsDir, entry), { recursive: true, force: true });
        } catch {
          // best-effort cleanup; a locked file just survives until the next run
        }
      }
    }
  }
}

/**
 * ponytail: global console swap keeps engine logs off stdout so --output json
 * stays machine-parseable. Ceiling: direct process.stdout.write in the engine
 * would bypass it (none today). Upgrade path: a logger option on the engine.
 */
function redirectConsoleToStderr(): () => void {
  const original = { log: console.log, info: console.info, warn: console.warn };
  console.log = (...args: any[]) => console.error(...args);
  console.info = (...args: any[]) => console.error(...args);
  console.warn = (...args: any[]) => console.error(...args);
  return () => Object.assign(console, original);
}
