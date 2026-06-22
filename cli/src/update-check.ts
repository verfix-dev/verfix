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
import { getDockerImage } from './constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(os.homedir(), '.verfix');
const NPM_CACHE_FILE = path.join(CACHE_DIR, 'npm-check.json');
const IMAGE_CACHE_FILE = path.join(CACHE_DIR, 'image-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Resolve the Docker image that the user is actually running (slim or full)
// based on the current browser mode. This ensures update checks query the
// correct registry tag for the image the user has pulled.
const DOCKER_IMAGE = getDockerImage();

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

function clearNpmCache(): void {
  try { fs.unlinkSync(NPM_CACHE_FILE); } catch { /* ignore */ }
}

/** Read the actually-installed CLI version from package.json (dist/ -> ../package.json). */
function getCurrentVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Simple semver comparison: returns true if `a` is strictly newer than `b`. */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

/** Strip a `repo@sha256:...` reference down to the bare digest. */
function extractDigest(digest: string): string {
  return digest.includes('@') ? digest.split('@')[1] : digest;
}

/**
 * Get the local image digest using `docker inspect`.
 * Returns null if Docker is unavailable or the image isn't pulled.
 */
function getLocalImageDigest(image: string): string | null {
  try {
    const out: string = spawnSync(
      'docker',
      ['inspect', '--format', '{{index .RepoDigests 0}}', image],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).stdout?.trim();
    return out || null;
  } catch {
    return null;
  }
}

// ─── Banner rendering ─────────────────────────────────────────────────────────

/** Length of a string ignoring ANSI color escape codes (the visible width). */
function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function printBanner(lines: string[]): void {
  const PAD = 2; // spaces of padding on each side of the content
  const contentWidth = Math.max(...lines.map(visibleLength));
  const innerWidth = contentWidth + PAD * 2;
  const border = chalk.yellow('─'.repeat(innerWidth));
  console.log('');
  console.log(chalk.yellow('┌') + border + chalk.yellow('┐'));
  for (const line of lines) {
    const rightPad = ' '.repeat(contentWidth - visibleLength(line));
    console.log(
      chalk.yellow('│') + ' '.repeat(PAD) + line + rightPad + ' '.repeat(PAD) + chalk.yellow('│')
    );
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
  // NPM / CLI update notification.
  // Always validate the cached `latestVersion` against the version that is
  // ACTUALLY installed right now — not the `currentVersion` recorded when the
  // cache was written. Otherwise, after the user upgrades (e.g. `npm i -g
  // verfix`) the still-fresh cache (<24h old) keeps showing a stale
  // "update available" banner until it expires.
  const npmCache = readCache<NpmCache>(NPM_CACHE_FILE);
  if (npmCache && npmCache.latestVersion) {
    const installedVersion = getCurrentVersion();
    if (isNewerVersion(npmCache.latestVersion, installedVersion)) {
      printBanner([
        chalk.bold('Update available:') + ` ${chalk.gray(installedVersion)} → ${chalk.cyan(npmCache.latestVersion)}`,
        `Run ${chalk.cyan('npm i -g verfix')} to update`,
      ]);
    } else if (npmCache.hasUpdate) {
      // We've already caught up to (or passed) the cached latest version.
      // Drop the stale cache so the next background check re-fetches.
      clearNpmCache();
    }
  }

  // Docker image update notification.
  // Validate against the CURRENT local digest: if the local image already
  // matches the cached remote digest, the update was applied and the banner
  // is stale.
  const imageCache = readCache<ImageCache>(IMAGE_CACHE_FILE);
  if (imageCache && imageCache.hasUpdate && imageCache.remoteDigest) {
    const localDigest = getLocalImageDigest(DOCKER_IMAGE);
    const localClean = localDigest ? extractDigest(localDigest) : null;
    const remoteClean = extractDigest(imageCache.remoteDigest);
    if (localClean && localClean === remoteClean) {
      // Local image already matches the latest remote digest — stale cache.
      clearImageCache();
    } else {
      printBanner([
        chalk.bold('A new server image is available.'),
        `Run ${chalk.cyan('verfix update')} to get the latest`,
      ]);
    }
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
