import * as dotenv from 'dotenv';
dotenv.config();

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

import { JobPayload, ExecutionResult, ConsoleLine, NetworkRequest, AssertionDefinition } from './assertions/types';
import { runAssertions } from './assertions/engine';
import { collectArtifacts } from './artifacts/collector';
import { startArtifactCleanup } from './artifacts/cleanup';
import { EventTracker } from './artifacts/event-tracker';
import { executeFlow } from './browser/flow-executor';
import { withRetry, waitForStableDOM } from './reliability/retry';
import { pool } from './browser/pool';
import { generateFailureSummary } from './ai/summarizer';
import { runExploration } from './ai/exploration';

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

// ─── Redis ────────────────────────────────────────────────────────────────────

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const adapterConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Without these listeners, an emitted Redis `error` becomes an unhandled
// exception that can crash the worker process.
connection.on('error', err => console.error(`⚠ Redis (worker) error: ${err.message}`));
adapterConnection.on('error', err => console.error(`⚠ Redis (adapter) error: ${err.message}`));

// ─── Artifacts directory ──────────────────────────────────────────────────────

// Use env var or fallback to cwd/artifacts.
// Using __dirname breaks when compiled because dist/src/.. becomes dist/artifacts
// while the API expects workers/artifacts.
const artifactsDir = process.env.ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// Bound how many console/network entries we retain per job. A chatty page can
// otherwise grow these arrays without limit, bloating worker memory and the
// JSON payload persisted to Redis. We keep the most recent entries.
const MAX_CONSOLE_LOGS = parseInt(process.env.MAX_CONSOLE_LOGS || '2000');
const MAX_NETWORK_REQUESTS = parseInt(process.env.MAX_NETWORK_REQUESTS || '2000');

// ─── Queue ────────────────────────────────────────────────────────────────────

const verifyQueue = new Queue('verify-jobs', { connection });

// ─── Adapter loop: Go Redis list → BullMQ ─────────────────────────────────────

async function adapterLoop() {
  console.log('🔌 Adapter: waiting for jobs from Go API...');
  while (true) {
    try {
      const result = await adapterConnection.blpop('verify_jobs', 0);
      if (result) {
        const [, jobDataStr] = result;
        const jobData: JobPayload = JSON.parse(jobDataStr);
        console.log(`\n📥 Received: ${jobData.id} — "${jobData.task}"`);
        await verifyQueue.add('verify', jobData, {
          attempts: jobData.retries ?? 2,
          backoff: { type: 'exponential', delay: 1500 },
        });
      }
    } catch (error) {
      console.error('Adapter error:', error);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function processJob(job: Job<JobPayload>): Promise<ExecutionResult> {
    const data = job.data;
    const startTime = Date.now();

    console.log(`\n🚀 Processing: ${data.id}`);
    console.log(`   Task:   "${data.task}"`);
    console.log(`   URL:    ${data.url}`);
    console.log(`   Mode:   ${data.mode || 'strict'}`);
    console.log(`   Checks: ${(data.assertions || []).length} assertions`);

    await setResult(data.id, {
      executionId: data.id,
      status: 'running',
      task: data.task,
      url: data.url,
      passed: false,
      duration_ms: 0,
      retry_count: job.attemptsMade,
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
    const browser = await pool.acquire();

    try {
      const harPath = path.join(artifactsDir, `${data.id}.har`);
      const context = await browser.newContext({
        recordHar: { path: harPath },
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
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout });
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
            await executeFlow(page, flow, data, tracker);
            await waitForStableDOM(page, 400, 5000);
            tracker.pushEvent('dom_change', `DOM stabilized after flow ${flow.name}`, { flow: flow.name }, { category: 'info' });

            if (flow.assertions && flow.assertions.length > 0) {
              ranFlowAssertions = true;
              console.log(`\n🔍 Running ${flow.assertions.length} flow assertion(s)...`);
              const flowResults = await runAssertions(
                page, flow.assertions, consoleLogs, networkRequests, artifactsDir, data.id, data.mode, data.task, tracker
              );
              assertionResults.push(...flowResults);
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
        passed,
        duration_ms: duration,
        retry_count: job.attemptsMade,
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
        const harPath = path.join(artifactsDir, `${data.id}.har`);
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
        passed: false,
        duration_ms: duration,
        retry_count: job.attemptsMade,
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

    await setResult(data.id, executionResult);

    // ─── Phase 4: Async Failure Summarization ──────────────────────────────
    if (!executionResult.passed && executionResult.status === 'completed') {
      generateFailureSummary(
        data.task,
        data.url,
        executionResult.assertions,
        consoleLogs,
        networkRequests
      ).then(async (summary) => {
        if (summary) {
          executionResult.ai_summary = summary;
          await setResult(data.id, executionResult);
        }
      }).catch(err => {
        // Detached, best-effort enrichment — never let it surface as an
        // unhandled rejection or block job completion.
        console.warn(`⚠ Failed to generate/persist AI summary for ${data.id}: ${err.message}`);
      });
    }

    return executionResult;
}

// Hard wall-clock guard so a hung navigation, flow, or AI exploration can never
// pin a worker slot forever. On timeout the job rejects, BullMQ retries it, and
// once retries are exhausted the `failed` handler reconciles the status.
function runJobWithTimeout(job: Job<JobPayload>): Promise<ExecutionResult> {
  const base = job.data.timeout || 15000;
  const hardTimeoutMs = Math.max(base * 4, 60000);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Job exceeded hard timeout of ${hardTimeoutMs}ms`)),
      hardTimeoutMs,
    );
  });
  return Promise.race([processJob(job), timeout]).finally(() => clearTimeout(timer));
}

// NOTE: this concurrency is the primary in-flight limiter. The BrowserPool is
// configured with the same MAX_CONCURRENCY, so under normal operation its
// semaphore never actually blocks — it exists purely as a defensive backstop.
const worker = new Worker(
  'verify-jobs',
  (job: Job<JobPayload>) => runJobWithTimeout(job),
  {
    connection,
    concurrency: parseInt(process.env.MAX_CONCURRENCY || '3'),
  },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setResult(id: string, result: Partial<ExecutionResult>): Promise<void> {
  await connection.set(`exec_result_${id}`, JSON.stringify(result));
  await connection.expire(`exec_result_${id}`, 86400);
}

worker.on('completed', job => console.log(`✔ Job ${job.id} done`));
worker.on('failed', async (job, err) => {
  console.error(`✘ Job ${job?.id} failed: ${err.message}`);
  if (!job) return;

  // Only mark the execution terminally failed once BullMQ has exhausted all
  // retries. Otherwise the job will be retried and may still succeed.
  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) return;

  const data = job.data as JobPayload;
  if (!data?.id) return;

  // The job may have died before its own try/catch ran (process crash, OOM,
  // browser pool failure, stalled job), leaving the result stuck at 'running'.
  // Reconcile it to 'failed' so the task does not stay in running mode forever.
  try {
    const existingRaw = await connection.get(`exec_result_${data.id}`);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as ExecutionResult;
      if (existing.status === 'completed' || existing.status === 'failed') {
        return; // already reconciled by the job body
      }
    }

    const nowIso = new Date().toISOString();
    const existing = existingRaw ? (JSON.parse(existingRaw) as Partial<ExecutionResult>) : {};
    await setResult(data.id, {
      executionId: data.id,
      status: 'failed',
      task: data.task,
      url: data.url,
      passed: false,
      duration_ms: existing.duration_ms ?? 0,
      retry_count: job.attemptsMade,
      events: existing.events ?? [],
      assertions: existing.assertions ?? [],
      artifacts: existing.artifacts ?? {},
      console_logs: existing.console_logs ?? [],
      network_requests: existing.network_requests ?? [],
      error: err.message || 'Worker failed to process job',
      created_at: existing.created_at ?? nowIso,
      completed_at: nowIso,
    });
    console.error(`   ↳ Marked execution ${data.id} as failed (worker failure)`);
  } catch (e: any) {
    console.error(`   ↳ Failed to reconcile execution ${data?.id} status: ${e.message}`);
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log('\n🛑 Shutting down worker...');
  await worker.close();
  await pool.shutdown();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep the worker alive on stray async errors (e.g. floating promises in the
// event tracker or detached AI summarization). Crashing the process would
// abandon every in-flight job and strand their results in 'running'.
process.on('unhandledRejection', reason => {
  console.error('⚠ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', err => {
  console.error('💥 Uncaught exception:', err);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

adapterLoop();
startArtifactCleanup(artifactsDir);
console.log('⚡ Worker is running and waiting for jobs...\n');
