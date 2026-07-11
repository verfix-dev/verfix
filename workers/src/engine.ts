// ─── @verfix/engine ───────────────────────────────────────────────────────────
//
// Transport-agnostic verification engine: takes a JobPayload, drives Playwright,
// and returns an ExecutionResult. This module must never import Redis/BullMQ —
// it is called in-process by the local CLI (no server stack) and wrapped by the
// BullMQ worker in server mode (src/index.ts).

import * as fs from 'fs';
import * as path from 'path';

import { JobPayload, ExecutionResult, ConsoleLine, NetworkRequest, AssertionDefinition } from './assertions/types';
import { runAssertions } from './assertions/engine';
import { collectArtifacts } from './artifacts/collector';
import { EventTracker } from './artifacts/event-tracker';
import { executeFlow } from './browser/flow-executor';
import { waitForStableDOM } from './reliability/retry';
import { pool } from './browser/pool';
import { generateFailureSummary } from './ai/summarizer';
import { resetAIBreaker } from './ai/circuit-breaker';
import { runExploration } from './ai/exploration';
import { storageStatePath, sessionStatePath, restoreStateInPage, captureState, seedWebStorage } from './browser/storage-state';

export * from './assertions/types';

// ─── Host URL resolution ──────────────────────────────────────────────────────
//
// Two modes depending on how the container was started:
//
// ── VERFIX_HOST_NETWORK=1 (Linux, --network=host) ───────────────────────
// The container shares the host network namespace. 'localhost' inside the
// container IS the host's localhost — both IPv4 (127.0.0.1) and IPv6 (::1).
// No URL rewriting needed; apps bound to any loopback interface are reachable.
//
// ── Bridge mode (Mac / Windows Docker Desktop) ────────────────────────
// Docker runs in a VM. 'localhost' resolves to the container itself.
// We rewrite job URLs to 'host.docker.internal' which points to the host.
//
// Outside Docker (local CLI mode) neither flag is set and URLs pass through.

const IS_HOST_NETWORK = process.env.VERFIX_HOST_NETWORK === '1';
const IS_DOCKER =
  !IS_HOST_NETWORK && (
    process.env.IN_DOCKER === '1' ||
    fs.existsSync('/.dockerenv')
  );

function resolveTargetUrl(rawUrl: string): string {
  // Host network mode: localhost IS the host, no rewrite needed.
  if (IS_HOST_NETWORK) return rawUrl;
  // Not in Docker: running locally, no rewrite needed.
  if (!IS_DOCKER) return rawUrl;
  // Bridge mode: rewrite localhost → host.docker.internal.
  return rawUrl.replace(
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/g,
    '//host.docker.internal$2',
  );
}

// Bound how many console/network entries we retain per job. A chatty page can
// otherwise grow these arrays without limit, bloating memory and the persisted
// JSON payload. We keep the most recent entries.
const MAX_CONSOLE_LOGS = parseInt(process.env.MAX_CONSOLE_LOGS || '2000');
const MAX_NETWORK_REQUESTS = parseInt(process.env.MAX_NETWORK_REQUESTS || '2000');

// Cap on how long an inline (awaitSummary) AI failure summary may take.
const SUMMARY_TIMEOUT_MS = 10000;

export interface EngineRunOptions {
  /** Directory where traces/screenshots/HAR/step captures are written. */
  artifactsDir: string;
  /** Directory for named storage states (auth reuse via flow saveState /
   *  useState). Default: <artifactsDir>/state. Files hold session cookies and
   *  tokens — the location must never be committed or shared. */
  stateDir?: string;
  /** Retry attempt number, reported as retry_count (default 0). */
  attempt?: number;
  /** Launch browser headless (default: PLAYWRIGHT_HEADLESS env, headless). */
  headless?: boolean;
  /** Playwright browser channel (e.g. 'chrome' to reuse installed Chrome). */
  channel?: string;
  /** Hard wall-clock cap. Default scales with the job's size:
   *  max(timeout*4, timeout*(steps+assertions+2), 60s). On breach the
   *  in-flight attempt is torn down and a 'failed' result is returned
   *  (no rejection — a hard timeout must never trigger a retry that runs
   *  concurrently with the stuck attempt). */
  hardTimeoutMs?: number;
  /** Await the AI failure summary inline instead of firing it detached. */
  awaitSummary?: boolean;
  /** Progress callback — receives the initial 'running' state and, in detached
   *  summary mode, the result re-emitted once ai_summary is attached. */
  onUpdate?: (result: Partial<ExecutionResult>) => void | Promise<void>;
}

// Shared between runVerification's timers and execute(): lets the hard-timeout
// timer tear down the in-flight attempt (aborting its Playwright calls) instead
// of racing past it — a rejected-but-still-running attempt plus a caller-side
// retry means two concurrent logins against the app under test.
interface CancelState {
  timedOut: boolean;
  hardTimeoutMs: number;
  /** Set by execute() once page/context exist; captures the trace then closes them. */
  teardown?: () => Promise<void>;
}

// Extra time the backstop gives a timed-out attempt to tear down before we
// give up and reject anyway (e.g. stuck outside Playwright entirely). Covers
// the 30s AI fetch timeout. Override via TEARDOWN_GRACE_MS for slower AI
// providers that need more room to unwind.
const TEARDOWN_GRACE_MS = parseInt(process.env.TEARDOWN_GRACE_MS || '35000');

/**
 * Run one verification job end-to-end. Never rejects for in-page/assertion
 * failures or hard timeouts (those return a 'completed'/'failed'
 * ExecutionResult); rejects only if a timed-out attempt cannot be torn down
 * within a grace period.
 */
export function runVerification(data: JobPayload, opts: EngineRunOptions): Promise<ExecutionResult> {
  const base = data.timeout || 15000;
  // Scale the cap with the job's size: a long multi-flow chain whose steps are
  // each individually within budget must not hit a fixed 60s wall clock.
  const units = (data.flows || []).reduce(
    (n, f) => n + (f.steps?.length || 0) + (f.assertions?.length || 0), 0,
  ) + (data.assertions?.length || 0) + 2; // +2: initial navigation + DOM settle
  const hardTimeoutMs = opts.hardTimeoutMs ?? Math.max(base * 4, base * units, 60000);

  const cancel: CancelState = { timedOut: false, hardTimeoutMs };
  const timer = setTimeout(() => {
    cancel.timedOut = true;
    console.error(`\n⏱ Job exceeded hard timeout of ${hardTimeoutMs}ms — tearing down the attempt...`);
    cancel.teardown?.().catch(() => {});
  }, hardTimeoutMs);

  let backstopTimer: ReturnType<typeof setTimeout>;
  const backstop = new Promise<never>((_, reject) => {
    backstopTimer = setTimeout(
      () => reject(new Error(`Job exceeded hard timeout of ${hardTimeoutMs}ms and could not be torn down`)),
      hardTimeoutMs + TEARDOWN_GRACE_MS,
    );
  });
  return Promise.race([execute(data, opts, cancel), backstop])
    .finally(() => { clearTimeout(timer); clearTimeout(backstopTimer); });
}

/** Close the pooled browser. Call once when done issuing runs. */
export async function shutdownEngine(): Promise<void> {
  await pool.shutdown();
}

async function execute(
  data: JobPayload,
  opts: EngineRunOptions,
  cancel: CancelState = { timedOut: false, hardTimeoutMs: 0 },
): Promise<ExecutionResult> {
  // Per-run AI state: a rate-limit breaker opened by a previous job must not
  // leak into this one (long-lived server workers).
  resetAIBreaker();
  const startTime = Date.now();
  const attempt = opts.attempt ?? 0;
  const artifactsDir = opts.artifactsDir;
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  console.log(`\n🚀 Processing: ${data.id}`);
  console.log(`   Task:   "${data.task}"`);
  console.log(`   URL:    ${data.url}`);
  console.log(`   Mode:   ${data.mode || 'strict'}`);
  console.log(`   Checks: ${(data.assertions || []).length} assertions`);

  await opts.onUpdate?.({
    executionId: data.id,
    status: 'running',
    task: data.task,
    url: data.url,
    passed: false,
    duration_ms: 0,
    retry_count: attempt,
    assertions: [],
    artifacts: {},
    console_logs: [],
    network_requests: [],
    created_at: new Date(startTime).toISOString(),
  });

  const consoleLogs: ConsoleLine[] = [];
  const networkRequests: NetworkRequest[] = [];
  let executionResult: ExecutionResult;
  const tracker = new EventTracker(data.id, artifactsDir, data.mode || 'strict');

  // Acquire browser from pool (respects concurrency limit)
  const browser = await pool.acquire({ headless: opts.headless, channel: opts.channel });

  // Hoisted so the crash path and the hard-timeout teardown can reach them.
  let page: import('playwright').Page | undefined;
  let context: import('playwright').BrowserContext | undefined;
  const harPath = path.join(artifactsDir, `${data.id}.har`);
  const tracePath = path.join(artifactsDir, `${data.id}_trace.zip`);
  // Trace captured by the hard-timeout teardown (which must stop tracing
  // before force-closing the context, or the trace is lost).
  let teardownTrace: string | undefined;

  try {

    // ── Auth state reuse: restore ─────────────────────────────────────────────
    // Each flow's declared useState is restored right before THAT flow runs, so
    // flows never see a session they didn't ask for (a clearState flow batched
    // ahead of a useState flow gets a genuinely clean slate). One fast path:
    // when the run's FIRST flow declares useState, its state is applied at
    // context creation instead — nothing runs before it, and only context
    // creation can restore IndexedDB (Firebase/MSAL token caches).
    const stateDir = opts.stateDir ?? path.join(artifactsDir, 'state');
    const firstFlow = (data.flows || [])[0];
    const fastPathName = firstFlow?.useState && !firstFlow.clearState ? firstFlow.useState : undefined;
    let restoredState: string | undefined;
    if (fastPathName) {
      const p = storageStatePath(stateDir, fastPathName);
      if (fs.existsSync(p)) {
        restoredState = p;
        console.log(`   🔑 Restoring saved storage state "${fastPathName}"`);
        tracker.pushEvent('action', `restored storage state "${fastPathName}"`, { state: fastPathName }, { category: 'info' });
      } else {
        console.log(`   ℹ️  No saved storage state "${fastPathName}" yet — running without it (a flow with saveState creates it)`);
      }
    }

    context = await browser.newContext({
      recordHar: { path: harPath },
      ...(restoredState ? { storageState: restoredState } : {}),
    });

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    page = await context.newPage();

    // From here on the hard-timeout timer can abort the attempt: stop tracing
    // (preserving it for the failed result), then force-close so every
    // in-flight Playwright call throws and execute() unwinds into its catch.
    {
      const ctx = context;
      const pg = page;
      cancel.teardown = async () => {
        try {
          await ctx.tracing.stop({ path: tracePath });
          teardownTrace = tracePath;
        } catch { /* tracing already stopped or context gone */ }
        try { await pg.close(); } catch { /* already closed */ }
        try { await ctx.close(); } catch { /* already closed */ }
      };
    }
    const requestStartTimes = new Map<any, number>();

    page.on('console', msg => {
      const ts = new Date().toISOString();
      if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();
      const loc = msg.location();
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: ts,
        source_url: loc.url || undefined,
        line: loc.url ? loc.lineNumber : undefined,
      });
    });
    page.on('request', request => {
      requestStartTimes.set(request, Date.now());
    });
    page.on('response', response => {
      const status = response.status();
      const request = response.request();
      const start = requestStartTimes.get(request);
      const timingMs = start ? Math.max(0, Date.now() - start) : 0;
      requestStartTimes.delete(request);
      if (networkRequests.length >= MAX_NETWORK_REQUESTS) networkRequests.shift();
      networkRequests.push({
        url: response.url(),
        method: request.method(),
        status,
        timing_ms: Math.round(timingMs),
        timestamp: new Date().toISOString(),
      });
    });
    page.on('crash', () => console.error(`💥 Page crashed in job ${data.id}`));

    const timeout = data.timeout || 15000;
    const targetUrl = resolveTargetUrl(data.url);
    if (targetUrl !== data.url) {
      console.log(`   ℹ️  URL rewritten for Docker: ${data.url} → ${targetUrl}`);
    }

    // Fast path sessionStorage: Playwright's storageState can't carry it, so
    // seed the sidecar before the initial navigation boots the app.
    if (restoredState && fastPathName) {
      const sp = sessionStatePath(stateDir, fastPathName);
      if (fs.existsSync(sp)) {
        try {
          const saved = JSON.parse(fs.readFileSync(sp, 'utf-8')) as { origin: string; entries: Record<string, string> };
          await seedWebStorage(page, saved.origin, undefined, saved.entries);
          console.log(`   🔑 Restoring saved sessionStorage for "${fastPathName}"`);
        } catch (e: any) {
          console.warn(`   ⚠ Could not restore sessionStorage sidecar for "${fastPathName}": ${e.message}`);
        }
      }
    }

    console.log(`\n🌐 Navigating to ${targetUrl}...`);
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
    } catch (err: any) {
      if ((err.message.includes('ERR_CONNECTION_REFUSED') || err.message.includes('ERR_CONNECTION_RESET') || err.message.includes('ERR_EMPTY_RESPONSE')) && targetUrl.includes('host.docker.internal')) {
        throw new Error(`Verfix could not reach your local server from inside Docker. Ensure your app is running and your Windows/Mac Firewall is not blocking Docker connections. Original error: ${err.message}`);
      }
      throw err;
    }
    await waitForStableDOM(page, 400, 8000);
    const navEvent = tracker.pushEvent('navigation', `navigate ${targetUrl}`, { url: targetUrl }, { category: 'info' });
    await tracker.captureStateSync(page, navEvent.id, 'step');
    const domEvent = tracker.pushEvent('dom_change', 'DOM stabilized after navigation', { url: targetUrl }, { category: 'info' });
    await tracker.captureStateSync(page, domEvent.id, 'step');

    let passed = false;
    let assertionResults: any[] = [];

    if (data.mode === 'exploratory') {
      console.log('\n🧭 Running in EXPLORATORY mode...');
      const expRes = await runExploration(page, data.task, tracker);
      passed = expRes.passed;
      assertionResults = [{
        type: 'exploration_result',
        passed: expRes.passed,
        duration_ms: expRes.duration_ms,
        error: expRes.error,
        details: { log: expRes.log }
      }];
    } else {
      const defaultAssertions: AssertionDefinition[] = [
        { type: 'page_loaded' },
        { type: 'no_console_errors' },
      ];
      // Job-wide console excludes: errors the user excluded anywhere in the
      // config must not resurface via the prior_console_errors analyzer,
      // regardless of which assertion list is currently running.
      const consoleExcludes = [
        ...(data.assertions ?? []),
        ...(data.flows ?? []).flatMap(f => f.assertions ?? []),
      ].filter(a => a.type === 'no_console_errors').flatMap(a => a.exclude ?? []);
      let ranFlowAssertions = false;

      if (data.flows && data.flows.length > 0) {
        console.log('\n▶ Executing flows...');
        for (const [flowIndex, flow] of data.flows.entries()) {
          if (flow.clearState) {
            // ponytail: clears cookies + local/session storage only — leaves
            // IndexedDB/service workers untouched. Upgrade to a fresh
            // BrowserContext if that ceiling is ever hit.
            await context.clearCookies();
            try {
              await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
            } catch {
              // Storage APIs unavailable (e.g. about:blank) — nothing to clear.
            }
            tracker.pushEvent('dom_change', `cleared cookies/storage before flow ${flow.name}`, { flow: flow.name }, { category: 'info' });
          }

          // ── Auth state reuse: per-flow restore ─────────────────────────────
          // The first flow's state was already applied at context creation
          // (fast path); every other useState flow is seeded here, immediately
          // before its steps run.
          let stateRestored = flowIndex === 0 && !!restoredState;
          if (flow.useState && !stateRestored) {
            stateRestored = await restoreStateInPage(context, page, stateDir, flow.useState);
            if (stateRestored) {
              console.log(`   🔑 Restored saved storage state "${flow.useState}" for flow ${flow.name}`);
              tracker.pushEvent('action', `restored storage state "${flow.useState}"`, { flow: flow.name, state: flow.useState }, { category: 'info' });
              // The page is parked on the blank seed document — boot the app
              // with the restored session, unless the flow navigates itself.
              if (flow.steps?.[0]?.action !== 'navigate') {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
                await waitForStableDOM(page, 400, 8000);
              }
            } else {
              console.log(`   ℹ️  No saved storage state "${flow.useState}" yet — running without it (a flow with saveState creates it)`);
            }
          }

          await executeFlow(page, flow, data, tracker);
          await waitForStableDOM(page, 400, 5000);
          tracker.pushEvent('dom_change', `DOM stabilized after flow ${flow.name}`, { flow: flow.name }, { category: 'info' });

          let flowPassed = true;
          if (flow.assertions && flow.assertions.length > 0) {
            ranFlowAssertions = true;
            console.log(`\n🔍 Running ${flow.assertions.length} flow assertion(s)...`);
            const flowResults = await runAssertions(
              page, flow.assertions, consoleLogs, networkRequests, artifactsDir, data.id, flow.mode || data.mode, data.task, tracker, flow.name, stateRestored, consoleExcludes
            );
            assertionResults.push(...flowResults);
            flowPassed = flowResults.every(r => r.passed);
          }

          // ── Auth state reuse: save ──────────────────────────────────────────
          // Only a verified-good session is worth persisting: steps ran without
          // throwing and every flow assertion passed.
          if (flowPassed) {
            if (flow.saveState) {
              await captureState(context, page, stateDir, flow.saveState);
              console.log(`   💾 Saved storage state "${flow.saveState}" for reuse via useState`);
              tracker.pushEvent('action', `saved storage state "${flow.saveState}"`, { flow: flow.name, state: flow.saveState }, { category: 'info' });
            }
            // Rotating (single-use) refresh tokens: the app may have rotated
            // the restored session's tokens on boot, making the file on disk
            // dead for the next run. Re-capture the live session so a restore
            // always sends the current tokens. Opt out with refreshState: false
            // (e.g. a flow that ends logged out).
            if (flow.useState && stateRestored && flow.useState !== flow.saveState && flow.refreshState !== false) {
              await captureState(context, page, stateDir, flow.useState);
              console.log(`   🔄 Refreshed storage state "${flow.useState}" (session tokens may have rotated)`);
              tracker.pushEvent('action', `refreshed storage state "${flow.useState}"`, { flow: flow.name, state: flow.useState }, { category: 'info' });
            }
          }
        }
      }

      if (data.assertions && data.assertions.length > 0) {
        console.log(`\n🔍 Running ${data.assertions.length} assertion(s)...`);
        const baseResults = await runAssertions(
          page, data.assertions, consoleLogs, networkRequests, artifactsDir, data.id, data.mode, data.task, tracker, undefined, undefined, consoleExcludes
        );
        assertionResults.push(...baseResults);
      } else if (!ranFlowAssertions) {
        console.log(`\n🔍 Running ${defaultAssertions.length} assertion(s)...`);
        const baseResults = await runAssertions(
          page, defaultAssertions, consoleLogs, networkRequests, artifactsDir, data.id, data.mode, data.task, tracker, undefined, undefined, consoleExcludes
        );
        assertionResults.push(...baseResults);
      }

      passed = assertionResults.every(r => r.passed);
    }

    console.log('\n📦 Collecting artifacts...');
    const artifacts = await collectArtifacts(
      page, context, artifactsDir, data.id, consoleLogs, networkRequests, !passed,
    );

    const duration = Date.now() - startTime;

    // On failure, do a synchronous final-state capture for debugging
    if (!passed) {
      await tracker.captureStateSync(page, undefined, 'failure');
    }

    executionResult = {
      executionId: data.id,
      status: 'completed',
      task: data.task,
      url: data.url,
      mode: data.mode || 'strict',
      passed,
      duration_ms: duration,
      retry_count: attempt,
      events: tracker.getEvents(),
      assertions: assertionResults,
      artifacts,
      console_logs: consoleLogs,
      network_requests: networkRequests,
      created_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    };

    console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'} — ${data.id} (${duration}ms)\n`);

    // Cleanup page and context (not browser — it's pooled)
    try {
      await page.close().catch(() => {});
      await Promise.race([
        context.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('context.close timeout')), 3000))
      ]);
      // recordHar only flushes the HAR file to disk once the context closes,
      // so it must be picked up here rather than during artifact collection.
      if (fs.existsSync(harPath)) {
        executionResult.artifacts.har = harPath;
      }
    } catch (e: any) {
      console.warn(`⚠ Could not gracefully close context: ${e.message}`);
    }

  } catch (error: any) {
    const duration = Date.now() - startTime;
    // A hard-timeout teardown surfaces as whatever Playwright call it aborted
    // ("Target closed", …) — report the timeout, not the symptom.
    const message = cancel.timedOut
      ? `Job exceeded hard timeout of ${cancel.hardTimeoutMs}ms (set a higher "timeout" in verfix.config.json or --timeout to raise it)`
      : error.message;
    console.error(`\n💥 Job crashed: ${message}`);

    // Crashes need artifacts most of all — best-effort trace/screenshot/DOM
    // so `verfix show` works on a crashed run, not just completed ones.
    let crashArtifacts: ExecutionResult['artifacts'] = {};
    if (page && context && !cancel.timedOut) {
      try {
        crashArtifacts = await collectArtifacts(
          page, context, artifactsDir, data.id, consoleLogs, networkRequests, true,
        );
        await tracker.captureStateSync(page, undefined, 'failure');
      } catch { /* collection is best-effort on a crashed run */ }
    } else if (teardownTrace) {
      // Hard timeout: the teardown already stopped tracing before force-close.
      crashArtifacts.trace = teardownTrace;
    }

    // Close page/context (aborts anything still in flight; flushes the HAR).
    try { await page?.close(); } catch { /* already closed */ }
    try { await context?.close(); } catch { /* already closed */ }
    if (fs.existsSync(harPath)) crashArtifacts.har = harPath;

    executionResult = {
      executionId: data.id,
      status: 'failed',
      task: data.task,
      url: data.url,
      mode: data.mode || 'strict',
      passed: false,
      duration_ms: duration,
      retry_count: attempt,
      events: tracker.getEvents(),
      assertions: [],
      artifacts: crashArtifacts,
      console_logs: consoleLogs,
      network_requests: networkRequests,
      error: message,
      created_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    };
  } finally {
    cancel.teardown = undefined;
    pool.release();
  }

  // ─── AI failure summarization ───────────────────────────────────────────────
  if (!executionResult.passed && executionResult.status === 'completed') {
    if (opts.awaitSummary) {
      // Inline (local mode): the process exits right after the run, so a
      // detached enrichment would be lost. Bounded so it can't stall the run.
      //
      // Promise.race doesn't cancel the loser: if the timeout wins, the
      // generateFailureSummary() call keeps running its AI HTTP request in
      // the background. If that request finally settles while the CLI is
      // still alive (e.g. mid-flush of telemetry, right before process.exit),
      // its own console.log/warn would print to the now-restored real stdout,
      // landing after the JSON result and corrupting --output json — the
      // exact intermittent extra-stdout-content bug this timedOut flag closes.
      let summaryTimer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const summary = await Promise.race([
          generateFailureSummary(data.task, data.url, executionResult.assertions, consoleLogs, networkRequests, undefined, () => timedOut),
          new Promise<null>(resolve => { summaryTimer = setTimeout(() => { timedOut = true; resolve(null); }, SUMMARY_TIMEOUT_MS); }),
        ]);
        if (summary) executionResult.ai_summary = summary;
      } catch (err: any) {
        if (!timedOut) console.warn(`⚠ Failed to generate AI summary for ${data.id}: ${err.message}`);
      } finally {
        if (summaryTimer) clearTimeout(summaryTimer);
      }
    } else {
      // Detached (server mode): best-effort enrichment re-emitted via onUpdate —
      // never let it surface as an unhandled rejection or block job completion.
      generateFailureSummary(data.task, data.url, executionResult.assertions, consoleLogs, networkRequests)
        .then(async (summary) => {
          if (summary) {
            executionResult.ai_summary = summary;
            await opts.onUpdate?.(executionResult);
          }
        }).catch(err => {
          console.warn(`⚠ Failed to generate/persist AI summary for ${data.id}: ${err.message}`);
        });
    }
  }

  return executionResult;
}
