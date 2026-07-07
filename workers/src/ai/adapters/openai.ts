/**
 * OpenAI Adapter — raw fetch implementation.
 *
 * Also handles any OpenAI-compatible API via AI_BASE_URL env var
 * (Ollama, Groq, Together AI, LM Studio, etc.).
 *
 * Key resolution order:
 *   1. OPENAI_API_KEY  (new, provider-specific)
 *   2. AI_API_KEY      (legacy bridge — backward compat)
 *
 * Docker support:
 *   AI_BASE_URL is passed through resolveBaseUrl() so that
 *   http://localhost:11434 (Ollama) is rewritten to host.docker.internal.
 */

import { ProviderAdapter, ChatMessage, CompletionOptions } from './types'
import { fetchWithTimeout, resolveBaseUrl, parseJsonSafe } from './_http'
import { reportRateLimit } from '../circuit-breaker'

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai'

  isEnabled(): boolean {
    return !!(process.env.OPENAI_API_KEY || process.env.AI_API_KEY)
  }

  getModelName(): string {
    return process.env.AI_MODEL || 'gpt-5.4-mini'
  }

  async chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string | null> {
    const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY
    if (!key) return null

    const rawBase = process.env.AI_BASE_URL || 'https://api.openai.com'
    const baseUrl = resolveBaseUrl(rawBase)
    if (baseUrl !== rawBase) {
      console.log(`  ℹ️  AI_BASE_URL rewritten for Docker: ${rawBase} → ${baseUrl}`)
    }

    const url = `${baseUrl}/v1/chat/completions`
    return this._doRequest(url, key, messages, opts)
  }

  private async _doRequest(
    url: string,
    key: string,
    messages: ChatMessage[],
    opts?: CompletionOptions,
    useCompletionTokens = false,
  ): Promise<string | null> {
    const body: Record<string, unknown> = {
      model: this.getModelName(),
      messages,
      temperature: opts?.temperature ?? 0.3,
    }

    if (opts?.json) {
      body['response_format'] = { type: 'json_object' }
    }

    if (opts?.maxTokens) {
      // o1/o3/o4 reasoning models require max_completion_tokens
      body[useCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = opts.maxTokens
    }

    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        console.warn('  ⚠ OpenAI: Invalid API key. Check OPENAI_API_KEY.')
        return null
      }
      if (res.status === 429) {
        console.warn('  ⚠ OpenAI: Rate limited. Consider upgrading your plan or waiting.')
        reportRateLimit('OpenAI')
        return null
      }

      // Retry with max_completion_tokens for o1/o3 reasoning models
      let parsedError: any | null = null
      if (res.status === 400 && opts?.maxTokens && !useCompletionTokens) {
        parsedError = await parseJsonSafe(res) as any
        const msg: string = parsedError?.error?.message || ''
        if (msg.includes('max_tokens') && msg.includes('max_completion_tokens')) {
          console.log('  ℹ️  Retrying with max_completion_tokens (reasoning model detected)')
          return this._doRequest(url, key, messages, opts, true)
        }
      }

      if (!res.ok) {
        const errBody = parsedError ?? await parseJsonSafe(res) as any
        console.warn(`  ⚠ OpenAI HTTP ${res.status}: ${errBody?.error?.message || res.statusText}`)
        return null
      }

      const data = await parseJsonSafe(res) as any
      return data?.choices?.[0]?.message?.content ?? null
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('  ⚠ OpenAI: Request timed out after 30s')
      } else {
        console.warn(`  ⚠ OpenAI error: ${e.message}`)
      }
      return null
    }
  }
}
