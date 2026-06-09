/**
 * Provider Registry — resolves the active ProviderAdapter at startup.
 *
 * Resolution priority:
 *   1. AI_PROVIDER env var (explicitly set by `verfix init`)
 *      Values: openai | anthropic | gemini | openrouter
 *   2. Key-prefix heuristic applied to AI_API_KEY (backward compat)
 *      sk-ant-*  → anthropic
 *      AIza*     → gemini
 *      sk-or-*   → openrouter
 *      sk-* / anything else → openai
 *   3. Provider-specific key env vars
 *      ANTHROPIC_API_KEY → anthropic
 *      GEMINI_API_KEY → gemini
 *      OPENROUTER_API_KEY → openrouter
 *      OPENAI_API_KEY → openai
 *   4. Fallback: openai
 *
 * The adapter is lazily constructed and then cached for the lifetime
 * of the process. Reset with _resetAdapterCache() in tests.
 */

import type { ProviderAdapter } from './types'

// ─── Lazy adapter factories ───────────────────────────────────────────────────
// We use functions (not instances) so modules are only require()d when needed,
// keeping startup time fast when only one provider is active.

const ADAPTER_FACTORIES: Record<string, () => ProviderAdapter> = {
  openai: () => {
    const { OpenAIAdapter } = require('./openai') as typeof import('./openai')
    return new OpenAIAdapter()
  },
  anthropic: () => {
    const { AnthropicAdapter } = require('./anthropic') as typeof import('./anthropic')
    return new AnthropicAdapter()
  },
  gemini: () => {
    const { GeminiAdapter } = require('./gemini') as typeof import('./gemini')
    return new GeminiAdapter()
  },
  openrouter: () => {
    const { OpenRouterAdapter } = require('./openrouter') as typeof import('./openrouter')
    return new OpenRouterAdapter()
  },
}

let _cached: ProviderAdapter | null = null

/**
 * Returns the active ProviderAdapter for this process.
 * Constructs the adapter on first call, then returns the cached instance.
 */
export function resolveAdapter(): ProviderAdapter {
  if (_cached) return _cached

  const providerId = detectProviderId()
  const factory = ADAPTER_FACTORIES[providerId] ?? ADAPTER_FACTORIES.openai
  _cached = factory()

  console.log(`  ℹ️  AI provider: ${_cached.id} | model: ${_cached.getModelName()} | enabled: ${_cached.isEnabled()}`)
  return _cached
}

/**
 * Determine which provider to use.
 * This function is testable in isolation.
 */
export function detectProviderId(): string {
  // 1. Explicit env var wins
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase().trim()
  if (explicit && ADAPTER_FACTORIES[explicit]) {
    return explicit
  }
  if (explicit) {
    console.warn(`  ⚠ Unknown AI_PROVIDER='${explicit}'. Falling back to auto-detection.`)
  }

  // 2. Heuristic: inspect AI_API_KEY prefix
  const key = process.env.AI_API_KEY || ''
  if (key.startsWith('sk-ant-'))  return 'anthropic'
  if (key.startsWith('AIza') || key.startsWith('AQ')) return 'gemini'
  if (key.startsWith('sk-or-'))   return 'openrouter'

  // 3. Provider-specific key vars (new format from CLI)
  if (process.env.ANTHROPIC_API_KEY)  return 'anthropic'
  if (process.env.GEMINI_API_KEY)     return 'gemini'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (process.env.OPENAI_API_KEY)     return 'openai'

  // 4. Default
  return 'openai'
}

/**
 * Reset the cached adapter. For use in unit tests only.
 * @internal
 */
export function _resetAdapterCache(): void {
  _cached = null
}
