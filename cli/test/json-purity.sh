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

if [ $failed -eq 0 ]; then
  echo "🎉 All JSON purity tests passed!"
  exit 0
else
  echo "❌ Some JSON purity tests failed!"
  exit 1
fi
