/**
 * Self-check: the local runner's engine-resolvability guard. isEngineInstalled()
 * must return true in a healthy install (the dev workspace live-links
 * @verfix/engine, and a consumer install resolves ^0.1.0 from npm), and must
 * agree with a direct require.resolve. This is the smallest thing that fails if
 * the workspaces link breaks or the engine module goes missing — the exact
 * regression that shipped verfix@0.3.0 with an unresolvable file:../workers.
 *
 * Run: npm run test:engine-presence   (no browser, no network)
 */
import assert from 'assert';
import { isEngineInstalled } from '../src/local-runner';

function test_engine_resolvable() {
  assert.strictEqual(
    isEngineInstalled(),
    true,
    'isEngineInstalled() should be true — @verfix/engine must resolve (workspaces link or npm install). A false here means the CLI was installed with a stale file: dependency.',
  );
  // Cross-check against a direct resolve — the guard must not lie.
  assert.doesNotThrow(
    () => require.resolve('@verfix/engine'),
    'require.resolve("@verfix/engine") must succeed',
  );
  console.log('✓ @verfix/engine resolves; isEngineInstalled() agrees');
}

function test_detect_installed_browser_shape() {
  // detectInstalledBrowser() must never throw and must return either null or a
  // well-formed DetectedBrowser. Guards the per-OS path table against typos /
  // missing platforms — a malformed entry would crash init at the browser step.
  const { detectInstalledBrowser } = require('../src/local-runner');
  const detected = detectInstalledBrowser();
  if (detected === null) {
    console.log('✓ detectInstalledBrowser() returned null (no Chrome/Edge on this machine)');
    return;
  }
  assert.ok(typeof detected.channel === 'string' && detected.channel.length > 0, 'channel must be a non-empty string');
  assert.ok(typeof detected.path === 'string' && detected.path.length > 0, 'path must be a non-empty string');
  assert.ok(typeof detected.displayName === 'string' && detected.displayName.length > 0, 'displayName must be a non-empty string');
  assert.ok(['chrome', 'msedge'].includes(detected.channel), `channel must be a known Playwright channel, got: ${detected.channel}`);
  console.log(`✓ detectInstalledBrowser() found ${detected.displayName} (channel: ${detected.channel})`);
}

test_engine_resolvable();
test_detect_installed_browser_shape();
