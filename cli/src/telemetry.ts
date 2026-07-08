// ─── Anonymous CLI telemetry (PostHog) ──────────────────────────────────────
//
// Privacy-first design:
//   • Opt-out:  set VERFIX_TELEMETRY=off  or  DO_NOT_TRACK=1
//   • Anonymous: machine-hash ID — no PII ever leaves the device
//   • No secrets: API keys, URLs, file paths, task descriptions are NEVER sent
//   • Non-blocking: fire-and-forget, never delays CLI execution
//   • Transparent: one-time notice on first invocation
//
// Tracked events:  cli_init · cli_run · cli_start
// User properties: os_platform · os_arch · node_version · cli_version · is_ci
// ─────────────────────────────────────────────────────────────────────────────

import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
// This is a write-only public key (safe to embed in open-source code).
// Replace with your PostHog project API key from https://eu.posthog.com
const POSTHOG_API_KEY: string = 'phc_B6Z6MSdLVBLgomNDxAP8bNS7P9eECEuRVc7yQfREtoPF';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

// ─── Opt-out detection ──────────────────────────────────────────────────────

function isTelemetryDisabled(): boolean {
  const opt = (process.env.VERFIX_TELEMETRY || '').toLowerCase();
  if (opt === 'off' || opt === 'false' || opt === '0') return true;
  if (process.env.DO_NOT_TRACK === '1') return true;
  return false;
}

function isConfigured(): boolean {
  return (
    POSTHOG_API_KEY !== 'phc_REPLACE_WITH_YOUR_PROJECT_API_KEY' &&
    POSTHOG_API_KEY.length > 0
  );
}

// ─── CI detection ───────────────────────────────────────────────────────────

function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE ||
    process.env.TRAVIS ||
    process.env.CODESPACES ||
    process.env.TF_BUILD          // Azure DevOps
  );
}

// ─── Anonymous machine ID ───────────────────────────────────────────────────
// Salted UUID generated once per user and stored in ~/.verfix/.machine-id
// Truly non-PII, distinct across devices without revealing system details.

let _machineId: string | null = null;
const MACHINE_ID_FILE = path.join(os.homedir(), '.verfix', '.machine-id');

function getMachineId(): string {
  if (_machineId) return _machineId;
  try {
    if (fs.existsSync(MACHINE_ID_FILE)) {
      const stored = fs.readFileSync(MACHINE_ID_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) {
        _machineId = stored;
        return _machineId;
      }
    }
  } catch {
    // Ignore error, regenerate
  }

  try {
    const generated = crypto.randomUUID();
    const dir = path.dirname(MACHINE_ID_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, generated, 'utf-8');
    _machineId = generated;
  } catch {
    // Fallback to in-memory random UUID if write fails
    _machineId = crypto.randomUUID();
  }
  return _machineId;
}

// ─── CLI version ────────────────────────────────────────────────────────────

let _version: string | null = null;

function getCliVersion(): string {
  if (_version) return _version;
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _version = pkg.version || 'unknown';
  } catch {
    _version = 'unknown';
  }
  return _version!;
}

// ─── One-time telemetry notice ──────────────────────────────────────────────
// Stored in ~/.verfix/ so it's per-user, not per-project.

const NOTICE_MARKER = path.join(os.homedir(), '.verfix', '.telemetry-notice-shown');

function showNoticeOnce(): void {
  try {
    if (fs.existsSync(NOTICE_MARKER)) return;

    // stderr, never stdout: stdout is the pure-JSON data channel under
    // `--output json` (guarded by cli/test/json-purity.sh).
    console.error('');
    console.error('  \u2139  Verfix collects anonymous usage analytics to improve the tool.');
    console.error('     No API keys, URLs, or personal data are sent.');
    console.error('     Opt out anytime: VERFIX_TELEMETRY=off');
    console.error('');

    const dir = path.dirname(NOTICE_MARKER);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(NOTICE_MARKER, new Date().toISOString(), 'utf-8');
  } catch {
    // Non-critical — if we can't write the marker, the notice will show again.
  }
}

// ─── PostHog client (lazy singleton) ────────────────────────────────────────
// We import posthog-node lazily so that:
//   1. The dependency doesn't slow down startup when telemetry is off.
//   2. Missing dependency doesn't crash the CLI.

let _client: any = null;
let _clientFailed = false;

function getClient(): any {
  if (isTelemetryDisabled() || !isConfigured() || _clientFailed) return null;

  if (!_client) {
    try {
      // Show notice once when configuring telemetry on client initialization
      showNoticeOnce();

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostHog } = require('posthog-node');
      _client = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushAt: 1,         // Send each event immediately (CLI is short-lived)
        flushInterval: 0,   // Don't batch on a timer
      });
    } catch {
      // posthog-node not installed or broken — silently disable
      _clientFailed = true;
      return null;
    }
  }
  return _client;
}

// ─── Common properties attached to every event ──────────────────────────────

function commonProperties(): Record<string, unknown> {
  return {
    os_platform: os.platform(),
    os_arch: os.arch(),
    os_release: os.release(),
    node_version: process.version.replace(/^v/, ''),
    cli_version: getCliVersion(),
    is_ci: isCI(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Capture an analytics event. Non-blocking, safe to call anywhere.
 * If telemetry is disabled, this is a no-op.
 */
export function trackEvent(event: string, properties: Record<string, unknown> = {}): void {
  try {
    const client = getClient();
    if (!client) return;

    const distinctId = getMachineId();

    client.capture({
      distinctId,
      event,
      properties: {
        ...commonProperties(),
        ...properties,
      },
    });
  } catch {
    // Telemetry must never crash the CLI
  }
}

/**
 * Flush any pending events and shut down the client.
 * Call this before `process.exit()` to ensure events are delivered.
 * Safe to call multiple times or when telemetry is disabled.
 */
export async function flushTelemetry(): Promise<void> {
  if (_client) {
    try {
      await _client.shutdown();
    } catch {
      // Non-critical — never block the CLI
    }
    _client = null;
  }
}
