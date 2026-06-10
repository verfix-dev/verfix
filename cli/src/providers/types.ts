/**
 * Supported AI provider identifiers.
 */
export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter'

/**
 * A single model offered by a provider.
 */
export interface ProviderModel {
  /** Canonical model ID used in API calls */
  id: string
  /** Human-readable display name */
  name: string
  /** Whether this model is the recommended default for the provider */
  recommended?: boolean
}

/**
 * Static definition of a provider — everything needed to talk to its API
 * and validate user-supplied credentials.
 */
export interface ProviderDefinition {
  /** Unique identifier for this provider */
  id: ProviderId
  /** Human-readable provider name shown in prompts */
  displayName: string
  /** Environment variable that holds the API key (e.g. 'OPENAI_API_KEY') */
  envVar: string
  /** Regex that a valid API key must match */
  keyPattern: RegExp
  /** Short human-readable description of the key format (e.g. "starts with 'sk-'") */
  keyPatternHint: string
  /**
   * Known models for this provider.
   * Empty array for providers where users supply a free-form model string (e.g. OpenRouter).
   */
  models: ProviderModel[]
  /** Base URL of the provider API (no trailing slash) */
  baseUrl: string
  /** HTTP header name used to transmit the API key */
  authHeader: string
  /** Prefix prepended to the API key value in the auth header (e.g. 'Bearer ' or '') */
  authPrefix: string
  /**
   * When true, the user must supply a model string manually instead of picking
   * from a fixed list. Only applies to OpenRouter.
   */
  freeformModel: boolean
}

/**
 * Persisted AI configuration stored in the verfix config file.
 */
export interface VerfixAIConfig {
  /** Which provider is active */
  provider: ProviderId
  /** Model ID to use for requests */
  model: string
}

/**
 * Runtime provider interface — wraps a ProviderDefinition with live behaviour.
 */
export interface AIProvider {
  /** Provider identifier */
  id: ProviderId
  /** The static definition backing this provider instance */
  definition: ProviderDefinition
  /**
   * Returns true if `key` passes the provider's key-format validation.
   * This is a local, synchronous check — it does NOT make a network call.
   */
  validateKey(key: string): boolean
  /**
   * Fetches the list of models available to the given API key.
   * Falls back to the static model list when the provider has no models endpoint.
   */
  listModels(key: string): Promise<ProviderModel[]>
  /**
   * Performs a lightweight API call to confirm the key is accepted.
   * Resolves with `{ ok: true }` on success or `{ ok: false, error }` on failure.
   */
  testConnectivity(key: string): Promise<{ ok: boolean; error?: string }>
}

/**
 * Result returned after validating a provider API key.
 */
export interface ProviderValidationResult {
  /** Whether the key passed validation */
  valid: boolean
  /** Machine-readable error message when `valid` is false */
  error?: string
  /** Optional human-friendly hint to help the user fix the key */
  hint?: string
}

/**
 * A single message in a chat conversation.
 */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}
