/**
 * update-check.ts
 *
 * Industry-standard pattern (same as create-react-app, npm, Homebrew):
 *
 *   1. showPendingNotifications() — reads ONLY from the cache on disk.
 *      Zero network I/O, zero async, executes in <1ms.
 *      Call this just before your command's normal output ends.
 *
 *   2. scheduleBackgroundCheck(kind) — spawns a fully detached child process
 *      that runs update-checker-worker.js. Parent exits immediately; the child
 *      performs the network fetch and writes the cache, then exits on its own.
 *      This adds zero latency to the CLI command.
 *
 * Cache files live in ~/.verfix/ and are refreshed at most once per 24 hours.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import chalk from 'chalk';
import os from 'os';

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(os.homedir(), '.verfix');
const NPM_CACHE_FILE = path.join(CACHE_DIR, 'npm-check.json');
const IMAGE_CACHE_FILE = path.join(CACHE_DIR, 'image-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Types ────────────────────────────────────────────────────────────────────

interface NpmCache {
  latestVersion: string;
  currentVersion: string;
  hasUpdate: boolean;
  lastCheck: number;
}

interface ImageCache {
  localDigest: string | null;
  remoteDigest: string | null;
  hasUpdate: boolean;
  lastCheck: number;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function readCache<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isCacheExpired(lastCheck: number): boolean {
  return Date.now() - lastCheck > CHECK_INTERVAL_MS;
}

// ─── Banner rendering ─────────────────────────────────────────────────────────

function printBanner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const border = chalk.yellow('─'.repeat(width));
  console.log('');
  console.log(chalk.yellow('┌') + border + chalk.yellow('┐'));
  for (const line of lines) {
    const padding = ' '.repeat(width - line.length - 2);
    console.log(chalk.yellow('│') + '  ' + line + padding + chalk.yellow('│'));
  }
  console.log(chalk.yellow('└') + border + chalk.yellow('┘'));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read cached check results and print update banners.
 * Purely synchronous — reads disk, does zero network I/O.
 * Call this just before the command finishes its normal output.
 */
export function showPendingNotifications(): void {
  // NPM / CLI update notification
  const npmCache = readCache<NpmCache>(NPM_CACHE_FILE);
  if (npmCache && npmCache.hasUpdate && npmCache.latestVersion && npmCache.currentVersion) {
    printBanner([
      chalk.bold('Update available:') + ` ${chalk.gray(npmCache.currentVersion)} → ${chalk.cyan(npmCache.latestVersion)}`,
      `Run ${chalk.cyan('npm i -g verfix')} to update`,
    ]);
  }

  // Docker image update notification
  const imageCache = readCache<ImageCache>(IMAGE_CACHE_FILE);
  if (imageCache && imageCache.hasUpdate) {
    printBanner([
      chalk.bold('A new server image is available.'),
      `Run ${chalk.cyan('verfix update')} to get the latest`,
    ]);
  }
}

/**
 * Spawn a fully detached background process to check for updates.
 * Returns immediately — the parent process is NOT blocked.
 * The child writes fresh cache files and exits silently.
 *
 * @param kinds - which checks to run: 'npm', 'image', or both
 */
export function scheduleBackgroundCheck(kinds: ('npm' | 'image')[] = ['npm', 'image']): void {
  // Only spawn if at least one check is due
  const npmDue = kinds.includes('npm') && (() => {
    const c = readCache<NpmCache>(NPM_CACHE_FILE);
    return !c || isCacheExpired(c.lastCheck);
  })();
  const imageDue = kinds.includes('image') && (() => {
    const c = readCache<ImageCache>(IMAGE_CACHE_FILE);
    return !c || isCacheExpired(c.lastCheck);
  })();

  if (!npmDue && !imageDue) return; // Nothing to do — cache is fresh

  // Ensure the cache dir exists (the worker will also do this, but belt-and-suspenders)
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

  // Resolve the worker script path (compiled to dist/ alongside this file)
  const workerScript = path.join(__dirname, 'update-checker-worker.js');
  if (!fs.existsSync(workerScript)) return; // Built dist doesn't have the worker yet — skip

  const kindsArg = [npmDue && 'npm', imageDue && 'image'].filter(Boolean).join(',');

  // Spawn fully detached — parent exits immediately, child lives independently
  const child = spawn(process.execPath, [workerScript, kindsArg], {
    detached: true,
    stdio: 'ignore', // Don't inherit parent's stdio — fully invisible
    env: process.env,
  });
  child.unref(); // Let parent exit without waiting for the child
}

/**
 * Clear the image check cache.
 * Call this after a successful `verfix update` so users don't see a stale
 * "new image available" banner right after they just updated.
 */
export function clearImageCache(): void {
  try { fs.unlinkSync(IMAGE_CACHE_FILE); } catch { /* ignore */ }
}
