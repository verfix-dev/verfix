import { ProviderDefinition, ProviderId, ProviderModel } from './types'

// ---------------------------------------------------------------------------
// Static model lists
// ---------------------------------------------------------------------------

const OPENAI_MODELS: ProviderModel[] = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (recommended & affordable)', recommended: true },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro' },
]

const ANTHROPIC_MODELS: ProviderModel[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (recommended & affordable)', recommended: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
]

const GEMINI_MODELS: ProviderModel[] = [
  { id: 'gemini-3.5-pro', name: 'Gemini 3.5 Pro (recommended)', recommended: true },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (affordable)' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
]

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Central registry of all supported AI providers.
 * Each entry is a fully-resolved {@link ProviderDefinition}.
 */
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    keyPattern: /^sk-(?!ant-|or-)/,
    keyPatternHint: "starts with 'sk-' (but not 'sk-ant-' or 'sk-or-')",
    models: OPENAI_MODELS,
    baseUrl: 'https://api.openai.com',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    freeformModel: false,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    keyPattern: /^sk-ant-/,
    keyPatternHint: "starts with 'sk-ant-'",
    models: ANTHROPIC_MODELS,
    baseUrl: 'https://api.anthropic.com',
    authHeader: 'x-api-key',
    authPrefix: '',
    freeformModel: false,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    keyPattern: /^(AIza|AQ)/,
    keyPatternHint: "starts with 'AIza' or 'AQ'",
    models: GEMINI_MODELS,
    baseUrl: 'https://generativelanguage.googleapis.com',
    authHeader: 'X-Goog-Api-Key',
    authPrefix: '',
    freeformModel: false,
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPattern: /^sk-or-/,
    keyPatternHint: "starts with 'sk-or-'",
    models: [],
    baseUrl: 'https://openrouter.ai',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    freeformModel: true,
  },
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns the {@link ProviderDefinition} for the given provider ID.
 * Throws if the ID is not found (should never happen with a well-typed caller).
 */
export function getProvider(id: ProviderId): ProviderDefinition {
  const def = PROVIDER_REGISTRY[id]
  if (!def) {
    throw new Error(`Unknown provider: '${id}'`)
  }
  return def
}

/**
 * Returns an array of all registered provider definitions.
 */
export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY)
}

/**
 * Returns provider choices formatted for an Inquirer `list` or `select` prompt.
 *
 * @example
 * ```ts
 * await inquirer.prompt([{
 *   type: 'list',
 *   name: 'provider',
 *   choices: getProviderChoices(),
 * }])
 * ```
 */
export function getProviderChoices(): { name: string; value: ProviderId }[] {
  return getAllProviders().map((def) => ({
    name: def.displayName,
    value: def.id,
  }))
}

/**
 * Heuristically detects a {@link ProviderId} from a model string.
 *
 * - `gpt-*`     → `'openai'`
 * - `o1-*`      → `'openai'`
 * - `o3-*`      → `'openai'`
 * - `claude-*`  → `'anthropic'`
 * - `gemini-*`  → `'gemini'`
 * - anything else → `null`
 */
export function detectProviderFromModel(model: string): ProviderId | null {
  const lower = model.toLowerCase()
  if (lower.startsWith('gpt-')) return 'openai'
  // OpenAI reasoning models: o1-*, o3-*, o4-*
  if (/^o\d/.test(lower)) return 'openai'
  if (lower.startsWith('claude-')) return 'anthropic'
  if (lower.startsWith('gemini-')) return 'gemini'
  return null
}

/**
 * Returns `true` when `model` is a valid choice for the given provider.
 *
 * A model is considered valid when:
 * - it appears in the provider's static model list, OR
 * - the provider has `freeformModel: true` (e.g. OpenRouter)
 */
export function isValidModel(providerId: ProviderId, model: string): boolean {
  const def = getProvider(providerId)
  if (def.freeformModel) return true
  return def.models.some((m) => m.id === model)
}
