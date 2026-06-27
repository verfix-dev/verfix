// ─── Local Worker Runner ─────────────────────────────────────────────────────
// Manages the Playwright worker process on the host machine for hybrid mode.
// On Mac/Windows, the browser can't reach localhost from inside Docker, so we
// run the worker + browser directly on the host and connect to container Redis.

import { execSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  getDockerImage,
  HOST_WORKER_DIR,
  HOST_ARTIFACTS_DIR,
  HOST_WORKER_PID_FILE,
  VERFIX_HOME,
} from './constants';

// ─── Worker file extraction ──────────────────────────────────────────────────

/**
 * Get the image ID of the currently pulled Docker image.
 * Used to detect when extracted worker files are stale.
 */
function getImageDigest(): string | null {
  try {
    const result = execSync(
      `docker image inspect --format={{.Id}} ${getDockerImage()}`,
      { stdio: 'pipe' },
    );
    return result.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Extract compiled worker files (JS + node_modules) from the Docker image
 * to the host cache at ~/.verfix/worker/.
 *
 * Skips extraction if the cache is up-to-date (same image digest).
 * Forces re-extraction when the Docker image is updated.
 *
 * Strategy: We docker-cp only plain files (dist/, package.json, package-lock.json)
 * from the image, then run `npm ci` on the host to install node_modules natively.
 * This avoids the Linux→Windows symlink privilege issue entirely — npm on Windows
 * creates .cmd shims in .bin/ instead of symlinks, so no admin rights are needed.
 */
export function extractWorkerFiles(): void {
  const digestFile = path.join(HOST_WORKER_DIR, '.image-digest');
  const entryPoint = path.join(HOST_WORKER_DIR, 'dist', 'src', 'index.js');
  const currentDigest = getImageDigest();

  // Check if cached version matches current image
  if (
    currentDigest &&
    fs.existsSync(digestFile) &&
    fs.existsSync(entryPoint)
  ) {
    const cachedDigest = fs.readFileSync(digestFile, 'utf-8').trim();
    if (cachedDigest === currentDigest) return; // up-to-date
  }

  console.log('  📦 Extracting worker files from Docker image...');

  // Clean old cache
  if (fs.existsSync(HOST_WORKER_DIR)) {
    fs.rmSync(HOST_WORKER_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(HOST_WORKER_DIR, { recursive: true });

  const tempContainer = `verfix-extract-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    // Remove leftover extract container if it exists (from a crashed previous run)
    execSync(`docker rm -f ${tempContainer}`, { stdio: 'pipe' });
  } catch {
    // not found — fine
  }

  try {
    execSync(`docker create --name ${tempContainer} ${getDockerImage()}`, {
      stdio: 'pipe',
    });

    // Copy compiled JS and manifests from the image.
    // These are plain files (no symlinks), so docker cp works on every OS.
    execSync(
      `docker cp ${tempContainer}:/app/workers/dist ${path.join(HOST_WORKER_DIR, 'dist')}`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker cp ${tempContainer}:/app/workers/package.json ${path.join(HOST_WORKER_DIR, 'package.json')}`,
      { stdio: 'pipe' },
    );
    execSync(
      `docker cp ${tempContainer}:/app/workers/package-lock.json ${path.join(HOST_WORKER_DIR, 'package-lock.json')}`,
      { stdio: 'pipe' },
    );
  } finally {
    try {
      execSync(`docker rm -f ${tempContainer}`, { stdio: 'pipe' });
    } catch {
      // best-effort cleanup
    }
  }

  // Install node_modules natively on the host instead of copying from the
  // Linux image.  npm ci uses the lockfile so versions match the Docker build
  // exactly.  --omit=dev and --ignore-scripts mirror the Dockerfile flags.
  // On Windows this produces .cmd shims in .bin/ (no symlinks needed).
  // On Linux/macOS this produces normal symlinks (no privilege issues).
  console.log('  📦 Installing worker dependencies...');
  try {
    execSync('npm ci --omit=dev --ignore-scripts', {
      cwd: HOST_WORKER_DIR,
      stdio: 'pipe',
      timeout: 120_000, // 2 minutes — more than enough for 6 production deps
    });
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    throw new Error(
      'Failed to install worker dependencies.\n' +
      'Make sure npm is available and you have network access.\n' +
      (stderr ? `npm error: ${stderr}\n` : '') +
      `Error: ${err.message}`,
    );
  }

  console.log('  ✅ Worker files extracted');

  // Save digest for cache invalidation
  if (currentDigest) {
    fs.writeFileSync(digestFile, currentDigest, 'utf-8');
  }
}

// ─── Playwright browser installation ────────────────────────────────────────

/**
 * Ensure Playwright Chromium is installed on the host machine.
 * This is idempotent — if Chromium is already installed, Playwright skips download.
 *
 * On Mac/Windows, Chromium is self-contained (no --with-deps needed).
 * On Linux (if user explicitly opts into host mode), we add --with-deps.
 */
export function ensurePlaywrightBrowser(): void {
  console.log('  🔍 Checking Playwright Chromium...');

  try {
    execSync('npx playwright install chromium', {
      stdio: 'inherit',
      cwd: HOST_WORKER_DIR,
      env: {
        ...process.env,
        // Use default host browser path. Explicitly unset PLAYWRIGHT_BROWSERS_PATH
        // so it doesn't inherit a container path like /ms-playwright.
        PLAYWRIGHT_BROWSERS_PATH: undefined,
      },
    });
  } catch (err: any) {
    throw new Error(
      'Failed to install Playwright Chromium.\n' +
      'Try running manually: npx playwright install chromium\n' +
      `Error: ${err.message}`,
    );
  }
}

// ─── Worker process management ──────────────────────────────────────────────

let workerProcess: ChildProcess | null = null;

/**
 * Start the local worker process.
 * Connects to Redis inside the Docker container at localhost:{redisPort}.
 * Writes artifacts to the shared bind-mounted directory.
 *
 * Returns the child process PID.
 */
export function startLocalWorker(redisPort: number = 6379): number {
  // Kill any previously running worker
  stopLocalWorker();

  // Ensure artifacts dir exists
  if (!fs.existsSync(HOST_ARTIFACTS_DIR)) {
    fs.mkdirSync(HOST_ARTIFACTS_DIR, { recursive: true });
  }

  const entryPoint = path.join(HOST_WORKER_DIR, 'dist', 'src', 'index.js');
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      'Worker files not found. Run `verfix start` to set up the local worker environment.',
    );
  }

  const logFile = path.join(VERFIX_HOME, 'worker.log');
  const logStream = fs.openSync(logFile, 'a');

  workerProcess = spawn('node', [entryPoint], {
    cwd: HOST_WORKER_DIR,
    stdio: ['ignore', logStream, logStream],
    detached: true,
    env: {
      ...process.env,
      VERFIX_WORKER_MODE: 'local',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redisPort),
      ARTIFACTS_DIR: HOST_ARTIFACTS_DIR,
      // Use default host browser path
      PLAYWRIGHT_BROWSERS_PATH: undefined as any,
      // Allow user to see the browser for debugging
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS || 'true',
    },
  });

  const pid = workerProcess.pid!;

  // Close parent copy of log file descriptor so we don't leak it
  fs.closeSync(logStream);

  // Don't let the worker process prevent CLI from exiting
  workerProcess.unref();

  // Save PID for cross-process tracking
  try {
    fs.writeFileSync(HOST_WORKER_PID_FILE, String(pid), 'utf-8');
  } catch {
    // non-critical
  }

  // Save headless mode for state tracking
  try {
    const headlessFile = path.join(VERFIX_HOME, 'worker.headless');
    const headlessState = process.env.PLAYWRIGHT_HEADLESS || 'true';
    fs.writeFileSync(headlessFile, headlessState, 'utf-8');
  } catch {
    // non-critical
  }

  return pid;
}

/**
 * Stop the local worker process.
 * Tries in-process reference first, then falls back to PID file.
 */
export function stopLocalWorker(): boolean {
  // Try in-process reference
  if (workerProcess && !workerProcess.killed) {
    try {
      workerProcess.kill('SIGTERM');
      workerProcess = null;
      cleanupPidFile();
      return true;
    } catch {
      // fall through to PID file
    }
  }

  // Try PID file (for cross-process stop, e.g. `verfix stop` in another terminal)
  const pid = readPidFile();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      cleanupPidFile();
      return true;
    } catch (err: any) {
      // ESRCH = process not found (already dead)
      if (err.code === 'ESRCH') {
        cleanupPidFile();
      }
      return false;
    }
  }

  return false;
}

/**
 * Check if a local worker process is currently running.
 */
export function isWorkerRunning(): { running: boolean; pid?: number } {
  // Check in-process reference
  if (workerProcess && !workerProcess.killed && workerProcess.pid) {
    try {
      process.kill(workerProcess.pid, 0); // signal 0 = existence check
      return { running: true, pid: workerProcess.pid };
    } catch {
      workerProcess = null;
    }
  }

  // Check PID file
  const pid = readPidFile();
  if (pid) {
    try {
      process.kill(pid, 0);
      return { running: true, pid };
    } catch {
      cleanupPidFile();
    }
  }

  return { running: false };
}

// ─── PID file helpers ────────────────────────────────────────────────────────

function readPidFile(): number | null {
  try {
    if (!fs.existsSync(HOST_WORKER_PID_FILE)) return null;
    const raw = fs.readFileSync(HOST_WORKER_PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function cleanupPidFile(): void {
  try {
    if (fs.existsSync(HOST_WORKER_PID_FILE)) {
      fs.unlinkSync(HOST_WORKER_PID_FILE);
    }
  } catch {
    // non-critical
  }
  try {
    const headlessFile = path.join(VERFIX_HOME, 'worker.headless');
    if (fs.existsSync(headlessFile)) {
      fs.unlinkSync(headlessFile);
    }
  } catch {
    // non-critical
  }
}

export function getWorkerHeadlessState(): boolean {
  try {
    const headlessFile = path.join(VERFIX_HOME, 'worker.headless');
    if (fs.existsSync(headlessFile)) {
      return fs.readFileSync(headlessFile, 'utf-8').trim() === 'true';
    }
  } catch {}
  return true; // default
}
