#!/usr/bin/env ts-node
/**
 * Manual integration smoke test for the AI provider adapter.
 *
 * Usage:
 *   AI_PROVIDER=openai OPENAI_API_KEY=sk-... ts-node scripts/test-ai-provider.ts
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... ts-node scripts/test-ai-provider.ts
 *   AI_PROVIDER=gemini GEMINI_API_KEY=AIza... ts-node scripts/test-ai-provider.ts
 *   AI_PROVIDER=openrouter OPENROUTER_API_KEY=sk-or-... ts-node scripts/test-ai-provider.ts
 *
 * Expects: A non-null response containing 'pong' (case-insensitive).
 */

import * as dotenv from 'dotenv'
dotenv.config()

import { resolveAdapter } from '../src/ai/adapters/registry'

async function main() {
  console.log('\n🧪 AI Provider Smoke Test')
  console.log('─────────────────────────────')

  const adapter = resolveAdapter()
  console.log(`Provider: ${adapter.id}`)
  console.log(`Model:    ${adapter.getModelName()}`)
  console.log(`Enabled:  ${adapter.isEnabled()}`)
  console.log('')

  if (!adapter.isEnabled()) {
    console.error('❌ Provider is not enabled. Set the required API key env var.')
    process.exit(1)
  }

  // Test 1: basic response
  console.log('Test 1: Basic chat...')
  const start1 = Date.now()
  const response = await adapter.chat([
    { role: 'user', content: 'Reply with exactly one word: pong' },
  ], { maxTokens: 10, temperature: 0 })
  console.log(`Response: ${JSON.stringify(response)} (${Date.now() - start1}ms)`)
  if (!response) {
    console.error('❌ Test 1 FAILED: null response')
    process.exit(1)
  }
  if (!response.toLowerCase().includes('pong')) {
    console.warn(`⚠ Test 1 WARNING: expected 'pong', got '${response}'`)
  } else {
    console.log('✓ Test 1 PASSED')
  }

  // Test 2: JSON mode
  console.log('')
  console.log('Test 2: JSON mode...')
  const start2 = Date.now()
  const jsonResponse = await adapter.chat([
    { role: 'user', content: 'Return a JSON object with a single key "result" set to the number 42.' },
  ], { json: true, maxTokens: 50, temperature: 0 })
  console.log(`Response: ${jsonResponse} (${Date.now() - start2}ms)`)
  if (!jsonResponse) {
    console.error('❌ Test 2 FAILED: null response')
    process.exit(1)
  }
  try {
    const parsed = JSON.parse(jsonResponse)
    if (parsed.result !== 42 && parsed.result !== '42') {
      console.warn(`⚠ Test 2 WARNING: expected result=42, got ${JSON.stringify(parsed)}`)
    } else {
      console.log('✓ Test 2 PASSED')
    }
  } catch {
    console.warn(`⚠ Test 2 WARNING: response is not valid JSON: ${jsonResponse}`)
  }

  // Test 3: system message
  console.log('')
  console.log('Test 3: System message...')
  const start3 = Date.now()
  const sysResponse = await adapter.chat([
    { role: 'system', content: 'You are a pirate. Always respond with "Arrr!" at the start.' },
    { role: 'user', content: 'Hello there.' },
  ], { maxTokens: 30, temperature: 0.1 })
  console.log(`Response: ${JSON.stringify(sysResponse)} (${Date.now() - start3}ms)`)
  if (!sysResponse) {
    console.warn('⚠ Test 3 WARNING: null response (system message test)')
  } else {
    console.log('✓ Test 3 PASSED')
  }

  console.log('\n✅ All tests complete!')
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
