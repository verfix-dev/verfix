/**
 * update-checker-worker.ts
 *
 * This script runs in a fully DETACHED child process spawned by update-check.ts.
 * It performs network I/O, writes cache files, then exits silently.
 * It MUST NOT import any heavy CLI dependencies — only Node builtins + https.
 *
 * Usage (called internally by scheduleBackgroundCheck):
 *   node update-checker-worker.js npm,image
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';

// ─── Config ───────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(os.homedir(), '.verfix');
const NPM_CACHE_FILE = path.join(CACHE_DIR, 'npm-check.json');
const IMAGE_CACHE_FILE = path.join(CACHE_DIR, 'image-check.json');
const NPM_PACKAGE_NAME = 'verfix';
const DOCKER_IMAGE = 'ghcr.io/verfix-dev/verfix-server:latest';
const TIMEOUT_MS = 8000;

// ─── Utilities ────────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        httpsGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function writeCache(file: string, data: object): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function getCurrentVersion(): string {
  try {
    // __dirname is dist/, package.json is one level up
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── NPM version check ────────────────────────────────────────────────────────

async function checkNpmVersion(): Promise<void> {
  const currentVersion = getCurrentVersion();
  try {
    const raw = await httpsGet(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
    const data = JSON.parse(raw);
    const latestVersion: string = data.version;
    const hasUpdate = latestVersion !== currentVersion && isNewerVersion(latestVersion, currentVersion);
    writeCache(NPM_CACHE_FILE, {
      latestVersion,
      currentVersion,
      hasUpdate,
      lastCheck: Date.now(),
    });
  } catch {
    // Network failed — write a cache entry with hasUpdate:false so we don't retry every run
    writeCache(NPM_CACHE_FILE, {
      latestVersion: currentVersion,
      currentVersion,
      hasUpdate: false,
      lastCheck: Date.now(),
    });
  }
}

/** Simple semver comparison: returns true if `a` is newer than `b` */
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

// ─── Docker image digest check ────────────────────────────────────────────────

/**
 * Get the local image digest using `docker inspect`.
 * Returns null if Docker is not available or the image isn't pulled.
 */
function getLocalDigest(): string | null {
  try {
    const { execFileSync } = require('child_process');
    const out: string = execFileSync(
      'docker',
      ['inspect', '--format', '{{index .RepoDigests 0}}', DOCKER_IMAGE],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Get the remote image digest from the GHCR manifest API.
 * Uses a HEAD request — does NOT pull the image.
 */
async function getRemoteDigest(): Promise<string | null> {
  // GHCR manifest endpoint for :latest
  // We parse the image reference: ghcr.io/verfix-dev/verfix-server:latest
  const [registry, ...rest] = DOCKER_IMAGE.split('/');
  const repoParts = rest.join('/').split(':');
  const repo = repoParts[0];      // verfix-dev/verfix-server
  const tag = repoParts[1] || 'latest';

  // Step 1: Get an anonymous token from GHCR
  const tokenUrl = `https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io`;
  try {
    const tokenRaw = await httpsGet(tokenUrl);
    const tokenData = JSON.parse(tokenRaw);
    const token: string = tokenData.token;

    // Step 2: Fetch the manifest and read the Docker-Content-Digest header
    return new Promise((resolve) => {
      const manifestUrl = `https://ghcr.io/v2/${repo}/manifests/${tag}`;
      const req = https.request(
        manifestUrl,
        {
          method: 'HEAD',
          timeout: TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json',
          },
        },
        (res) => {
          const digest = res.headers['docker-content-digest'] as string | undefined;
          resolve(digest || null);
          res.resume(); // Drain the body
        }
      );
      req.on('error', (err) => {
        console.error('Manifest request error:', err);
        resolve(null);
      });
      req.on('timeout', () => {
        console.error('Manifest request timeout');
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  } catch (err) {
    console.error('getRemoteDigest error:', err);
    return null;
  }
}

function extractDigest(digest: string): string {
  if (digest.includes('@')) {
    return digest.split('@')[1];
  }
  return digest;
}

async function checkDockerImage(): Promise<void> {
  const localDigest = getLocalDigest();
  if (!localDigest) {
    // Image isn't pulled locally — no point checking remote
    // Don't write a cache file so we check again next time the image is pulled
    return;
  }

  try {
    const remoteDigest = await getRemoteDigest();
    const remoteDigestClean = remoteDigest ? extractDigest(remoteDigest) : null;
    const localDigestClean = extractDigest(localDigest);
    const hasUpdate = remoteDigestClean !== null && remoteDigestClean !== localDigestClean;
    writeCache(IMAGE_CACHE_FILE, {
      localDigest,
      remoteDigest,
      hasUpdate,
      lastCheck: Date.now(),
    });
  } catch (err) {
    console.error('checkDockerImage error:', err);
    // Network failed — cache hasUpdate:false to avoid spamming on every run
    writeCache(IMAGE_CACHE_FILE, {
      localDigest,
      remoteDigest: null,
      hasUpdate: false,
      lastCheck: Date.now(),
    });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const kindsArg = process.argv[2] || 'npm,image';
  const kinds = kindsArg.split(',').map((s) => s.trim());

  const tasks: Promise<void>[] = [];
  if (kinds.includes('npm')) tasks.push(checkNpmVersion());
  if (kinds.includes('image')) tasks.push(checkDockerImage());

  // Run checks in parallel and exit when both finish (or timeout)
  await Promise.allSettled(tasks);
}

main().catch(() => {
  // Swallow all errors — this is a background worker, never surface to the user
  process.exit(0);
});
