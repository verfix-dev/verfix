/**
 * Unit tests for the timeline merge function (`verfix show --timeline`).
 * Run with: npm test (after adding a test runner)
 * These tests use Node's built-in assert module and can be run directly.
 */

import assert from 'assert';
import { buildTimeline, textOf } from '../src/timeline';
import type { ExecutionEvent, ConsoleLine, NetworkRequest } from '@verfix/engine';

const events: ExecutionEvent[] = [
  {
    id: 'e1',
    type: 'navigation',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: 'navigate http://x.test',
    metadata: { flow: 'login', action: 'navigate' },
  },
  {
    id: 'e2',
    type: 'assertion_passed',
    timestamp: '2026-01-01T00:00:03.000Z',
    message: 'assertion passed',
    metadata: { flow: 'login', action: 'assert_url' },
  },
];

const consoleLines: ConsoleLine[] = [
  { type: 'error', text: 'boom', timestamp: '2026-01-01T00:00:01.000Z', source_url: 'http://x.test/app.js' },
];

const networkRequests: NetworkRequest[] = [
  { url: 'http://x.test/api/login', method: 'POST', status: 401, timing_ms: 12, timestamp: '2026-01-01T00:00:02.000Z' },
];

function test_merges_and_sorts_by_time() {
  const timeline = buildTimeline(events, consoleLines, networkRequests);
  assert.strictEqual(timeline.length, 4);
  assert.deepStrictEqual(timeline.map((e) => e.kind), ['step', 'console', 'network', 'step']);
  assert.ok(timeline.every((e, i) => i === 0 || Date.parse(e.t) >= Date.parse(timeline[i - 1].t)));
  console.log('✓ merges and sorts events from all three sources by time');
}

function test_handles_missing_sources() {
  const timeline = buildTimeline(events, null, undefined);
  assert.strictEqual(timeline.length, 2);
  assert.ok(timeline.every((e) => e.kind === 'step'));
  console.log('✓ tolerates missing/null sources');
}

function test_last_seconds_windows_from_final_event() {
  // Last event is at t=3s. --last 1 should keep only events within [2s, 3s].
  const timeline = buildTimeline(events, consoleLines, networkRequests, { lastSeconds: 1 });
  assert.strictEqual(timeline.length, 2);
  assert.deepStrictEqual(timeline.map((e) => e.kind), ['network', 'step']);
  console.log('✓ --last <seconds> windows relative to the run\'s last event');
}

function test_filter_matches_kind_specific_text() {
  const byUrl = buildTimeline(events, consoleLines, networkRequests, { filter: 'api/login' });
  assert.strictEqual(byUrl.length, 1);
  assert.strictEqual(byUrl[0].kind, 'network');

  const byConsoleText = buildTimeline(events, consoleLines, networkRequests, { filter: 'boom' });
  assert.strictEqual(byConsoleText.length, 1);
  assert.strictEqual(byConsoleText[0].kind, 'console');

  const bySourceUrl = buildTimeline(events, consoleLines, networkRequests, { filter: 'app.js' });
  assert.strictEqual(bySourceUrl.length, 1);
  assert.strictEqual(bySourceUrl[0].kind, 'console');

  const byStepFlow = buildTimeline(events, consoleLines, networkRequests, { filter: 'assert_url' });
  assert.strictEqual(byStepFlow.length, 1);
  assert.strictEqual(byStepFlow[0].kind, 'step');

  console.log('✓ --filter matches the kind-specific text field (url/text+source_url/message+metadata)');
}

function test_filter_is_case_insensitive() {
  const timeline = buildTimeline(events, consoleLines, networkRequests, { filter: 'BOOM' });
  assert.strictEqual(timeline.length, 1);
  console.log('✓ --filter is case-insensitive');
}

function test_unparsable_timestamps_sort_last_not_dropped() {
  const badEvents: ExecutionEvent[] = [
    { id: 'bad', type: 'navigation', timestamp: 'not-a-date', message: 'broken timestamp' },
  ];
  const timeline = buildTimeline(badEvents, consoleLines, networkRequests);
  assert.strictEqual(timeline.length, 3);
  assert.strictEqual(timeline[timeline.length - 1].t, 'not-a-date');
  console.log('✓ entries with unparsable timestamps are kept and sorted last');
}

function test_text_of_covers_all_kinds() {
  assert.strictEqual(textOf({ ...networkRequests[0], t: networkRequests[0].timestamp, kind: 'network' }), 'http://x.test/api/login');
  assert.ok(textOf({ ...consoleLines[0], t: consoleLines[0].timestamp, kind: 'console' }).includes('boom'));
  assert.ok(textOf({ ...events[0], t: events[0].timestamp, kind: 'step' }).includes('login'));
  console.log('✓ textOf() produces the expected filterable text for each kind');
}

const tests = [
  test_merges_and_sorts_by_time,
  test_handles_missing_sources,
  test_last_seconds_windows_from_final_event,
  test_filter_matches_kind_specific_text,
  test_filter_is_case_insensitive,
  test_unparsable_timestamps_sort_last_not_dropped,
  test_text_of_covers_all_kinds,
];

let passed = 0;
let failed = 0;

console.log('\nRunning timeline merge tests...\n');

for (const t of tests) {
  try {
    t();
    passed++;
  } catch (e: any) {
    console.error(`✗ ${t.name}: ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
