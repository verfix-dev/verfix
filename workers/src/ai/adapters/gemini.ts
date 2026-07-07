/**
 * Google Gemini Adapter — generateContent API.
 *
 * Key differences from OpenAI wire format:
 *   - Endpoint: POST /v1beta/models/{model}:generateContent?key={key}
 *   - Auth: API key as QUERY PARAMETER, no auth header
 *   - Message roles: 'user' | 'model' (not 'assistant')
 *   - System messages prepended to first user message content
 *   - JSON mode: generationConfig.responseMimeType = 'application/json'
 *   - Response: candidates[0].content.parts[0].text
 *   - maxTokens → generationConfig.maxOutputTokens
 *
 * Key resolution order:
 *   1. GEMINI_API_KEY  (new, provider-specific)
 *   2. AI_API_KEY      (legacy bridge — backward compat)
 */

import { ProviderAdapter, ChatMessage, CompletionOptions } from './types'
import { fetchWithTimeout, parseJsonSafe } from './_http'
import { reportRateLimit } from '../circuit-breaker'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini'

  isEnabled(): boolean {
    return !!(process.env.GEMINI_API_KEY || process.env.AI_API_KEY)
  }

  getModelName(): string {
    return process.env.AI_MODEL || 'gemini-3.5-flash'
  }

  async chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string | null> {
    const key = process.env.GEMINI_API_KEY || process.env.AI_API_KEY
    if (!key) return null

    const model = this.getModelName()
    const url = `${GEMINI_BASE_URL}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`

    // ── Translate messages: OpenAI format → Gemini format ──
    //
    // Gemini uses role 'model' instead of 'assistant'.
    // Gemini has no system role — prepend system content to first user message.
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
    const systemPrefix = systemParts.length ? systemParts.join('\n') + '\n\n' : ''

    const geminiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    if (geminiMessages.length === 0) {
      console.warn('  ⚠ Gemini: No user messages in conversation')
      return null
    }

    // Gemini requires messages to alternate user/model. Validate.
    // If the first message is somehow 'model', add a dummy user message.
    if (geminiMessages[0].role !== 'user') {
      geminiMessages.unshift({ role: 'user', parts: [{ text: '(start)' }] })
    }

    // Gemini has no system role — prepend system content to the first user message.
    if (systemPrefix) {
      geminiMessages[0].parts[0].text = systemPrefix + geminiMessages[0].parts[0].text
    }

    const generationConfig: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.3,
    }
    if (opts?.maxTokens) generationConfig['maxOutputTokens'] = opts.maxTokens
    if (opts?.json) generationConfig['responseMimeType'] = 'application/json'

    const body = { contents: geminiMessages, generationConfig }

    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const errBody = await parseJsonSafe(res) as any
        const code: string = errBody?.error?.status || ''
        if (code === 'API_KEY_INVALID' || res.status === 401 || res.status === 403) {
          console.warn('  ⚠ Gemini: Invalid API key. Get yours at aistudio.google.com')
        } else {
          console.warn(`  ⚠ Gemini HTTP ${res.status}: ${errBody?.error?.message || res.statusText}`)
        }
        return null
      }
      if (res.status === 429) {
        console.warn('  ⚠ Gemini: Rate limited.')
        reportRateLimit('Gemini')
        return null
      }
      if (!res.ok) {
        const errBody = await parseJsonSafe(res) as any
        console.warn(`  ⚠ Gemini HTTP ${res.status}: ${errBody?.error?.message || res.statusText}`)
        return null
      }

      const data = await parseJsonSafe(res) as any
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('  ⚠ Gemini: Request timed out after 30s')
      } else {
        console.warn(`  ⚠ Gemini error: ${e.message}`)
      }
      return null
    }
  }
}
