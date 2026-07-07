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
import { runExploration } from './ai/exploration';

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

// State names become filenames — reject anything that could escape stateDir.
function storageStatePath(stateDir: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid storage state name "${name}" — use only letters, digits, dash, underscore`);
  }
  return path.join(stateDir, `${name}.json`);
}

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
  /** Hard wall-clock cap; default max(timeout*4, 60s). Rejects on breach. */
  hardTimeoutMs?: number;
  /** Await the AI failure summary inline instead of firing it detached. */
  awaitSummary?: boolean;
  /** Progress callback — receives the initial 'running' state and, in detached
   *  summary mode, the result re-emitted once ai_summary is attached. */
  onUpdate?: (result: Partial<ExecutionResult>) => void | Promise<void>;
}

/**
 * Run one verification job end-to-end. Never rejects for in-page/assertion
 * failures (those return a 'completed'/'failed' ExecutionResult); rejects only
 * when the hard wall-clock timeout is breached.
 */
export function runVerification(data: JobPayload, opts: EngineRunOptions): Promise<ExecutionResult> {
  const base = data.timeout || 15000;
  const hardTimeoutMs = opts.hardTimeoutMs ?? Math.max(base * 4, 60000);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Job exceeded hard timeout of ${hardTimeoutMs}ms`)),
      hardTimeoutMs,
    );
  });
  return Promise.race([execute(data, opts), timeout]).finally(() => clearTimeout(timer));
}

/** Close the pooled browser. Call once when done issuing runs. */
export async function shutdownEngine(): Promise<void> {
  await pool.shutdown();
}

async function execute(data: JobPayload, opts: EngineRunOptions): Promise<ExecutionResult> {
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

  try {
    const harPath = path.join(artifactsDir, `${data.id}.har`);

    // ── Auth state reuse: restore ─────────────────────────────────────────────
    // Storage state must be applied at context creation so cookies/localStorage
    // exist before the app boots (SPAs read auth tokens on first load).
    const stateDir = opts.stateDir ?? path.join(artifactsDir, 'state');
    const restoreNames = [...new Set((data.flows || []).map(f => f.useState).filter((n): n is string => !!n))];
    if (restoreNames.length > 1) {
      // ponytail: one restored state per run (it's context-level). Flows asking
      // for a second name share the first; split into separate runs to upgrade.
      console.warn(`   ⚠ Multiple useState names (${restoreNames.join(', ')}) — only "${restoreNames[0]}" is restored this run.`);
    }
    let restoredState: string | undefined;
    if (restoreNames.length > 0) {
      const p = storageStatePath(stateDir, restoreNames[0]);
      if (fs.existsSync(p)) {
        restoredState = p;
        console.log(`   🔑 Restoring saved storage state "${restoreNames[0]}"`);
        tracker.pushEvent('action', `restored storage state "${restoreNames[0]}"`, { state: restoreNames[0] }, { category: 'info' });
      } else {
        console.log(`   ℹ️  No saved storage state "${restoreNames[0]}" yet — running without it (a flow with saveState creates it)`);
      }
    }

    const context = await browser.newContext({
      recordHar: { path: harPath },
      ...(restoredState ? { storageState: restoredState } : {}),
    });

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const page = await context.newPage();
    const requestStartTimes = new Map<any, number>();

    page.on('console', msg => {
      const ts = new Date().toISOString();
      if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();
      consoleLogs.push({ type: msg.type(), text: msg.text(), timestamp: ts });
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
      let ranFlowAssertions = false;

      if (data.flows && data.flows.length > 0) {
        console.log('\n▶ Executing flows...');
        for (const flow of data.flows) {
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
          await executeFlow(page, flow, data, tracker);
          await waitForStableDOM(page, 400, 5000);
          tracker.pushEvent('dom_change', `DOM stabilized after flow ${flow.name}`, { flow: flow.name }, { category: 'info' });

          let flowPassed = true;
          if (flow.assertions && flow.assertions.length > 0) {
            ranFlowAssertions = true;
            console.log(`\n🔍 Running ${flow.assertions.length} flow assertion(s)...`);
            const flowResults = await runAssertions(
              page, flow.assertions, consoleLogs, networkRequests, artifactsDir, data.id, flow.mode || data.mode, data.task, tracker, flow.name
            );
            assertionResults.push(...flowResults);
            flowPassed = flowResults.every(r => r.passed);
          }

          // ── Auth state reuse: save ──────────────────────────────────────────
          // Only a verified-good session is worth reusing: steps ran without
          // throwing and every flow assertion passed.
          if (flow.saveState && flowPassed) {
            const p = storageStatePath(stateDir, flow.saveState);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            // indexedDB covers Firebase Auth / MSAL-style token caches.
            // ponytail: sessionStorage is NOT captured (no Playwright support,
            // per-tab semantics) — apps keeping tokens only there re-login.
            await context.storageState({ path: p, indexedDB: true });
            console.log(`   💾 Saved storage state "${flow.saveState}" for reuse via useState`);
            tracker.pushEvent('action', `saved storage state "${flow.saveState}"`, { flow: flow.name, state: flow.saveState }, { category: 'info' });
          }
        }
      }

      if (data.assertions && data.assertions.length > 0) {
        console.log(`\n🔍 Running ${data.assertions.length} assertion(s)...`);
        const baseResults = await runAssertions(
          page, data.assertions, consoleLogs, networkRequests, artifactsDir, data.id, data.mode, data.task, tracker
        );
        assertionResults.push(...baseResults);
      } else if (!ranFlowAssertions) {
        console.log(`\n🔍 Running ${defaultAssertions.length} assertion(s)...`);
        const baseResults = await runAssertions(
          page, defaultAssertions, consoleLogs, networkRequests, artifactsDir, data.id, data.mode, data.task, tracker
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
    console.error(`\n💥 Job crashed: ${error.message}`);

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
      artifacts: {},
      console_logs: consoleLogs,
      network_requests: networkRequests,
      error: error.message,
      created_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    };
  } finally {
    pool.release();
  }

  // ─── AI failure summarization ───────────────────────────────────────────────
  if (!executionResult.passed && executionResult.status === 'completed') {
    if (opts.awaitSummary) {
      // Inline (local mode): the process exits right after the run, so a
      // detached enrichment would be lost. Bounded so it can't stall the run.
      let summaryTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const summary = await Promise.race([
          generateFailureSummary(data.task, data.url, executionResult.assertions, consoleLogs, networkRequests),
          new Promise<null>(resolve => { summaryTimer = setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS); }),
        ]);
        if (summary) executionResult.ai_summary = summary;
      } catch (err: any) {
        console.warn(`⚠ Failed to generate AI summary for ${data.id}: ${err.message}`);
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
