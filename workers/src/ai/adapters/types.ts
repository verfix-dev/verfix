/**
 * ProviderAdapter — shared interface for all AI provider implementations.
 *
 * Every provider (OpenAI, Anthropic, Gemini, OpenRouter, …) implements this
 * interface. The public `chatCompletion()` function in provider.ts delegates
 * entirely to the active adapter resolved by registry.ts.
 *
 * ARCHITECTURAL CONTRACT:
 *   - `chat()` MUST return null on any error. It MUST NOT throw.
 *   - `isEnabled()` MUST be a synchronous, cheap check (env var lookup only).
 *   - Adapters are singletons — constructed once per process via resolveAdapter().
 */

/** Canonical chat message format (OpenAI-style, used as the internal standard). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Options forwarded to every adapter's chat() call. */
export interface CompletionOptions {
  /** Sampling temperature. Default is provider-specific (typically 0.3). */
  temperature?: number;
  /** Maximum tokens to generate. Meaning varies per provider. */
  maxTokens?: number;
  /**
   * When true, the adapter MUST ensure the response is valid JSON.
   * Each adapter implements this in its own way:
   *   - OpenAI / OpenRouter: response_format: { type: 'json_object' }
   *   - Anthropic: append JSON instruction to last user message
   *   - Gemini: generationConfig.responseMimeType: 'application/json'
   */
  json?: boolean;
  /**
   * Request timeout in milliseconds, forwarded to fetchWithTimeout. Set by
   * provider.ts to the remaining per-run AI time budget (capped at the
   * adapter default) so one slow call can't overspend the run's budget.
   * Falls back to fetchWithTimeout's own default when omitted.
   */
  timeoutMs?: number;
}

/**
 * Core interface every AI provider adapter must implement.
 * Adapters live in workers/src/ai/adapters/<provider>.ts.
 */
export interface ProviderAdapter {
  /**
   * Stable identifier for this provider.
   * Must match the key used in the ADAPTERS registry (e.g. 'openai', 'anthropic').
   */
  readonly id: string;

  /**
   * Returns true if the adapter has everything it needs to make API calls.
   * Typically: checks that the required API key env var is non-empty.
   * MUST be synchronous and cheap — no network calls.
   */
  isEnabled(): boolean;

  /**
   * Returns the model identifier that will be sent to the API.
   * Reads from AI_MODEL env var with a provider-appropriate default.
   */
  getModelName(): string;

  /**
   * Send a chat completion request to the provider's API.
   *
   * @param messages - Canonical chat messages in OpenAI role format.
   * @param opts - Optional generation parameters.
   * @returns The text content of the model's reply, or null on any error.
   *
   * MUST catch all exceptions and return null — never throw.
   */
  chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string | null>;
}
