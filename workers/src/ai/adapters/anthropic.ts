/**
 * Anthropic Adapter — Messages API implementation.
 *
 * Key differences from OpenAI wire format:
 *   - Endpoint: POST https://api.anthropic.com/v1/messages
 *   - Auth: x-api-key + anthropic-version headers (not Authorization: Bearer)
 *   - System messages extracted to top-level `system` field
 *   - max_tokens is REQUIRED (not optional) — defaults to 1024
 *   - JSON mode: append instruction to last user message (no response_format param)
 *   - Response shape: { content: [{ type: 'text', text: '...' }] }
 *
 * Key resolution order:
 *   1. ANTHROPIC_API_KEY  (new, provider-specific)
 *   2. AI_API_KEY         (legacy bridge — backward compat)
 */

import { ProviderAdapter, ChatMessage, CompletionOptions } from './types'
import { fetchWithTimeout, parseJsonSafe } from './_http'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 1024

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic'

  isEnabled(): boolean {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY)
  }

  getModelName(): string {
    return process.env.AI_MODEL || 'claude-sonnet-4-5'
  }

  async chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string | null> {
    const key = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY
    if (!key) return null

    // ── Separate system messages from conversation ──
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
    const systemText = systemParts.join('\n') || undefined

    let conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    // ── JSON mode: append instruction to last user message ──
    if (opts?.json && conversationMessages.length > 0) {
      const last = conversationMessages[conversationMessages.length - 1]
      if (last.role === 'user') {
        conversationMessages = [
          ...conversationMessages.slice(0, -1),
          {
            role: 'user',
            content: last.content + '\n\nRespond with valid JSON only. No markdown fences, no explanation.',
          },
        ]
      }
    }

    // Anthropic requires at least one user message
    if (conversationMessages.length === 0) {
      console.warn('  ⚠ Anthropic: No user messages in conversation')
      return null
    }

    const body: Record<string, unknown> = {
      model: this.getModelName(),
      max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts?.temperature ?? 0.3,
      messages: conversationMessages,
    }
    if (systemText) body['system'] = systemText

    try {
      const res = await fetchWithTimeout(
        `${ANTHROPIC_BASE_URL}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
        },
      )

      if (res.status === 401) {
        console.warn('  ⚠ Anthropic: Invalid API key. Check ANTHROPIC_API_KEY at console.anthropic.com')
        return null
      }
      if (res.status === 429) {
        console.warn('  ⚠ Anthropic: Rate limited.')
        return null
      }
      if (res.status === 529) {
        console.warn('  ⚠ Anthropic: Service overloaded (529). Will retry on next job.')
        return null
      }
      if (!res.ok) {
        const errBody = await parseJsonSafe(res) as any
        console.warn(`  ⚠ Anthropic HTTP ${res.status}: ${errBody?.error?.message || res.statusText}`)
        return null
      }

      const data = await parseJsonSafe(res) as any
      const textBlock = (data?.content as any[])?.find((b: any) => b.type === 'text')
      return textBlock?.text ?? null
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.warn('  ⚠ Anthropic: Request timed out after 30s')
      } else {
        console.warn(`  ⚠ Anthropic error: ${e.message}`)
      }
      return null
    }
  }
}
