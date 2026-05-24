import * as dotenv from 'dotenv';
dotenv.config();

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

import { JobPayload, ExecutionResult, ConsoleLine, NetworkRequest, AssertionDefinition } from './assertions/types';
import { runAssertions } from './assertions/engine';
import { collectArtifacts } from './artifacts/collector';
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

// ─── Artifacts directory ──────────────────────────────────────────────────────

// Use env var or fallback to cwd/artifacts.
// Using __dirname breaks when compiled because dist/src/.. becomes dist/artifacts
// while the API expects workers/artifacts.
const artifactsDir = process.env.ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

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

const worker = new Worker(
  'verify-jobs',
  async (job: Job<JobPayload>) => {
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
      });
    }

    return executionResult;
  },
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
worker.on('failed', (job, err) => console.error(`✘ Job ${job?.id} failed: ${err.message}`));

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log('\n🛑 Shutting down worker...');
  await worker.close();
  await pool.shutdown();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Boot ─────────────────────────────────────────────────────────────────────

adapterLoop();
console.log('⚡ Worker is running and waiting for jobs...\n');
