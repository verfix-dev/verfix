#!/bin/bash
# Test that --output json produces ONLY valid JSON

CLI_BIN="node $(pwd)/cli/dist/index.js"

echo "Running JSON purity tests..."
failed=0

# Test 1: flows --output json (no config)
output=$($CLI_BIN flows --output json 2>/dev/null)
echo "$output" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ FAIL: flows --output json is not valid JSON"
  echo "Output was: $output"
  failed=1
else
  echo "✅ PASS: flows --output json is valid JSON"
fi

# Test 2: status --output json
output=$($CLI_BIN status --output json 2>/dev/null)
echo "$output" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ FAIL: status --output json is not valid JSON"
  echo "Output was: $output"
  failed=1
else
  echo "✅ PASS: status --output json is valid JSON"
fi

# Test 3: doctor --output json
output=$($CLI_BIN doctor --output json 2>/dev/null)
echo "$output" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ FAIL: doctor --output json is not valid JSON"
  echo "Output was: $output"
  failed=1
else
  echo "✅ PASS: doctor --output json is valid JSON"
fi

# Test 3b: first-run purity — a machine that has never shown the one-time
# telemetry notice must still emit pure JSON (notices belong on stderr).
# Caught in CI: local dev machines all had ~/.verfix/.telemetry-notice-shown.
fresh_home=$(mktemp -d)
output=$(HOME="$fresh_home" $CLI_BIN doctor --output json 2>/dev/null)
rm -rf "$fresh_home"
echo "$output" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ FAIL: doctor --output json on a fresh HOME is not valid JSON (first-run notice on stdout?)"
  echo "Output was: $output"
  failed=1
else
  echo "✅ PASS: doctor --output json is valid JSON on a fresh HOME (first run)"
fi

# Test 4: run --flow nonexistent --output json
output=$($CLI_BIN run --flow nonexistent --output json 2>/dev/null)
echo "$output" | jq . > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ FAIL: run --flow nonexistent --output json is not valid JSON"
  echo "Output was: $output"
  failed=1
else
  echo "✅ PASS: run --flow nonexistent --output json is valid JSON"
fi

# Test 5: Check exit codes
$CLI_BIN run --flow nonexistent --output json > /dev/null 2>&1
exit_code=$?
if [ $exit_code -ne 2 ]; then
  echo "❌ FAIL: run --flow nonexistent exit code expected 2, got $exit_code"
  failed=1
else
  echo "✅ PASS: run --flow nonexistent exit code is 2"
fi

$CLI_BIN flows --config nonexistent.json --output json > /dev/null 2>&1
exit_code=$?
if [ $exit_code -ne 2 ]; then
  echo "❌ FAIL: flows --config nonexistent exit code expected 2, got $exit_code"
  failed=1
else
  echo "✅ PASS: flows --config nonexistent exit code is 2"
fi

# Test 6: abandoned AI failure-summary call must never leak onto stdout (#80).
#
# engine.ts races generateFailureSummary() against a bounded timeout so a slow
# AI provider can't stall the run. Promise.race doesn't cancel the loser: when
# the AI response arrives just after the bound (still in flight), the CLI has
# already restored real stdout/stderr and printed its JSON result — a stray
# console.log from that abandoned call used to land straight after it,
# corrupting `--output json`. Reproduced with a fake provider that responds
# ~300ms past the engine's 10s bound, so the abandoned call is still pending
# when the CLI moves on. Uses ephemeral ports for both the target app and the
# fake AI backend — self-contained, no fixed ports, no external network.
harness=$(mktemp --suffix=.js)
cat > "$harness" <<'JS'
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function main() {
  const app = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>ok</h1></body></html>');
  });

  // Fake OpenAI-compatible backend: responds ~300ms past the engine's 10s
  // summary bound, so the request is still abandoned-but-in-flight when the
  // CLI's race times out and moves on.
  const ai = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            likely_root_cause: 'test', evidence: [], suggested_fix: null, confidence: 0.5,
          }) } }],
        }));
      }, 10300);
    });
  });

  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verfix-json-purity-'));
  const configPath = path.join(projDir, 'verfix.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    baseUrl: `http://127.0.0.1:${app.port}`,
    mode: 'assisted',
    flows: [{
      id: 'deliberate-fail',
      name: 'Deliberately failing assertion',
      steps: [{ action: 'navigate', url: '/' }],
      assertions: [{ type: 'text_visible', value: 'text that will never appear on this page' }],
    }],
  }));

  const cliBin = process.argv[2];
  // Async spawn, not spawnSync: this script's own event loop must keep
  // servicing the app/AI HTTP servers above (they live in THIS process) while
  // the CLI child is running. spawnSync would freeze the event loop for the
  // whole child lifetime, starving both servers and hanging the CLI's own
  // page navigation — a real footgun, not just theoretical (this is exactly
  // what broke the first draft of this test).
  const child = spawn(process.execPath, [cliBin, 'run', '--config', configPath, '--flow', 'deliberate-fail', '--output', 'json'], {
    cwd: projDir,
    env: {
      ...process.env,
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'sk-test-fake-key',
      AI_BASE_URL: `http://127.0.0.1:${ai.port}`,
    },
  });
  let stdout = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', () => {});
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', () => { clearTimeout(killTimer); resolve(); });
  });

  app.server.close();
  ai.server.close();
  fs.rmSync(projDir, { recursive: true, force: true });

  try {
    JSON.parse(stdout);
    process.stdout.write('PURE\n');
  } catch {
    process.stdout.write('IMPURE\n');
    process.stderr.write('--- stdout ---\n' + stdout + '\n--- end stdout ---\n');
  }
}

main();
JS
harness_result=$(node "$harness" "$(pwd)/cli/dist/index.js" 2>/tmp/verfix-json-purity-test6.log)
rm -f "$harness"
if [ "$harness_result" != "PURE" ]; then
  echo "❌ FAIL: run --output json leaks extra stdout content from an abandoned AI summary call (#80)"
  cat /tmp/verfix-json-purity-test6.log
  failed=1
else
  echo "✅ PASS: run --output json stays pure even when the AI failure-summary call outlives its bound (#80)"
fi
rm -f /tmp/verfix-json-purity-test6.log

if [ $failed -eq 0 ]; then
  echo "🎉 All JSON purity tests passed!"
  exit 0
else
  echo "❌ Some JSON purity tests failed!"
  exit 1
fi
