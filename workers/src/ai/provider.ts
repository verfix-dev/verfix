/**
 * AI Provider — multi-provider LLM interface.
 *
 * Supports:
 *   - OpenAI API (GPT-4o, GPT-4.1-mini, o1, o3, …)
 *   - Anthropic API (Claude Sonnet, Opus, Haiku, …)
 *   - Google Gemini API (Gemini 2.5 Pro/Flash, …)
 *   - OpenRouter (100+ models via OpenAI-compatible gateway)
 *   - Any OpenAI-compatible API via AI_BASE_URL (Ollama, Groq, Together, LM Studio, …)
 *
 * Provider selection (in priority order):
 *   1. AI_PROVIDER env var  (openai | anthropic | gemini | openrouter)
 *   2. Key-prefix heuristic on AI_API_KEY for backward compat
 *      sk-ant-* → anthropic | AIza* → gemini | sk-or-* → openrouter | sk-* → openai
 *   3. Provider-specific key env vars (ANTHROPIC_API_KEY, GEMINI_API_KEY, …)
 *   4. Default: openai
 *
 * ARCHITECTURAL RULE: This is Layer 2. It is NEVER on the critical path.
 * All errors are caught by the adapter — this module returns null, never throws.
 *
 * The public API (chatCompletion, isAIEnabled, getModelName, ChatMessage) is
 * intentionally stable. All callers (exploration.ts, self-healing.ts,
 * summarizer.ts) require zero changes.
 */

import { resolveAdapter } from './adapters/registry';

// Re-export ChatMessage so callers can use it without importing from the adapters module.
export type { ChatMessage } from './adapters/types';

/**
 * Returns true if the active provider has the required API key configured.
 * This is a cheap synchronous check — no network calls.
 */
export function isAIEnabled(): boolean {
  return resolveAdapter().isEnabled();
}

/**
 * Returns the model name that will be used for AI calls.
 * Reads AI_MODEL env var with a provider-specific default.
 */
export function getModelName(): string {
  return resolveAdapter().getModelName();
}

/**
 * Send a chat completion request to the active AI provider.
 *
 * @param messages - Chat history in canonical role format.
 * @param opts - Optional parameters: temperature, maxTokens, json mode.
 * @returns The model's text response, or null on any error.
 */
export async function chatCompletion(
  messages: import('./adapters/types').ChatMessage[],
  opts?: {
    temperature?: number;
    maxTokens?: number;
    /** When true, the adapter ensures the response is valid JSON. */
    json?: boolean;
  },
): Promise<string | null> {
  return resolveAdapter().chat(messages, opts);
}
