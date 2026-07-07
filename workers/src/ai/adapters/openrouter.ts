/**
 * OpenRouter Adapter — routes to 100+ models via OpenAI-compatible wire format.
 *
 * OpenRouter's wire format is identical to OpenAI's, with two additions:
 *   - Endpoint: https://openrouter.ai/api/v1/chat/completions
 *   - Required extra headers: HTTP-Referer and X-Title (for usage tracking)
 *
 * Model IDs must include the provider prefix, e.g. 'openai/gpt-4o-mini'.
 *
 * Key resolution order:
 *   1. OPENROUTER_API_KEY  (new, provider-specific)
 *   2. AI_API_KEY          (legacy bridge — backward compat)
 */

import { ProviderAdapter, ChatMessage, CompletionOptions } from './types'
import { fetchWithTimeout, parseJsonSafe } from './_http'
import { reportRateLimit } from '../circuit-breaker'

const OPENROUTER_BASE_URL = 'https://openrouter.ai'

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter'

  isEnabled(): boolean {
    return !!(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY)
  }

  getModelName(): string {
    // OpenRouter model IDs include a provider prefix: e.g. 'openai/gpt-4o-mini'
    return process.env.AI_MODEL || 'openai/gpt-4o-mini'
  }

  async chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string | null> {
    const key = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY
    if (!key) return null

    const body: Record<string, unknown> = {
      model: this.getModelName(),
      messages,
      temperature: opts?.temperature ?? 0.3,
    }

    if (opts?.json) {
      body['response_format'] = { type: 'json_object' }
    }
    if (opts?.maxTokens) {
      body['max_tokens'] = opts.maxTokens
    }

    try {
      const res = await fetchWithTimeout(
        `${OPENROUTER_BASE_URL}/api/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            // Required by OpenRouter — used for usage tracking and abuse prevention
            'HTTP-Referer': 'https://verfix.dev',
            'X-Title': 'Verfix',
          },
          body: JSON.stringify(body),
        },
      )

      if (res.status === 401) {
        console.warn('  ⚠ OpenRouter: Invalid API key. Get yours at openrouter.ai/keys')
        return null
      }
      if (res.status === 402) {
        console.warn('  ⚠ OpenRouter: Insufficient credits.')
        return null
      }
      if (res.status === 429) {
        console.warn('  ⚠ OpenRouter: Rate limited.')
        reportRateLimit('OpenRouter')
        return null
      }
      if (!res.ok) {
        const errBody = await parseJsonSafe(res) as any
        console.warn(`  ⚠ OpenRouter HTTP ${res.status}: ${errBody?.error?.message || res.statusText}`)
        return null
      }

      const data = await parseJsonSafe(res) as any
      return data?.choices?.[0]?.message?.content ?? null
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('  ⚠ OpenRouter: Request timed out after 30s')
      } else {
        console.warn(`  ⚠ OpenRouter error: ${e.message}`)
      }
      return null
    }
  }
}
