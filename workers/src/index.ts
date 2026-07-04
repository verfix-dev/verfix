import * as dotenv from 'dotenv';
dotenv.config();

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

import { JobPayload, ExecutionResult } from './assertions/types';
import { runVerification } from './engine';
import { startArtifactCleanup } from './artifacts/cleanup';
import { pool } from './browser/pool';

// This file is the server-mode transport: Redis list ingestion from the Go API,
// BullMQ queueing/retries, and result persistence to Redis. The verification
// work itself lives in ./engine (transport-agnostic, also called in-process by
// the local CLI).
//
// ponytail: bullmq/ioredis stay as regular dependencies of @verfix/engine even
// though only this transport file uses them — the Docker runtime stage installs
// with `npm ci --omit=dev` (Dockerfile.server:101) and needs them. Ceiling:
// ~10MB of dead disk weight in local CLI installs. Upgrade path: split a
// separate transport package when the hosted product ships.

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

function createRedisClient(name: string): Redis {
  let lastLoggedAttempt = 0;
  return new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times - lastLoggedAttempt >= 10) {
        lastLoggedAttempt = times;
        console.error(
          `\n❌ Redis (${name}) unreachable after ${times} connection attempts at ${redisHost}:${redisPort}.\n` +
          `   👉 Ensure the Verfix runtime container is running ("verfix status" or "verfix start")\n`
        );
      }
      return Math.min(times * 500, 5000);
    },
  });
}

const connection = createRedisClient('worker');
const adapterConnection = createRedisClient('adapter');

connection.on('connect', () => {
  console.log('⚡ Redis worker connection established');
});
adapterConnection.on('connect', () => {
  console.log('🔌 Redis adapter connection established');
});

connection.on('error', err => {
  if (!err.message.includes('ECONNREFUSED')) {
    console.error(`⚠ Redis (worker) error: ${err.message}`);
  }
});
adapterConnection.on('error', err => {
  if (!err.message.includes('ECONNREFUSED')) {
    console.error(`⚠ Redis (adapter) error: ${err.message}`);
  }
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

async function processJob(job: Job<JobPayload>): Promise<ExecutionResult> {
  const data = job.data;

  // The engine owns the hard wall-clock timeout: on breach it rejects, BullMQ
  // retries the job, and once retries are exhausted the `failed` handler
  // reconciles the status.
  const result = await runVerification(data, {
    artifactsDir,
    attempt: job.attemptsMade,
    awaitSummary: false,
    onUpdate: r => setResult(data.id, r),
  });

  await setResult(data.id, result);
  return result;
}

// NOTE: this concurrency is the primary in-flight limiter. The BrowserPool is
// configured with the same MAX_CONCURRENCY, so under normal operation its
// semaphore never actually blocks — it exists purely as a defensive backstop.
const worker = new Worker(
  'verify-jobs',
  (job: Job<JobPayload>) => processJob(job),
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
