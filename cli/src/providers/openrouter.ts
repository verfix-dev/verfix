import { AIProvider, ProviderModel, ProviderDefinition } from './types'
import { PROVIDER_REGISTRY } from './registry'

/** Maximum number of models surfaced to the user to avoid overwhelming the UI. */
const MAX_MODELS = 20

/**
 * OpenRouter provider implementation.
 *
 * Uses raw HTTP via Node 18+ built-in `fetch` — no SDK dependency.
 * Unlike the other providers, OpenRouter exposes a freeform model catalogue,
 * so `listModels` maps live API results directly to `ProviderModel[]` rather
 * than filtering against a curated registry list.  Results are capped at
 * {@link MAX_MODELS} entries to keep the selection UI manageable.
 */
export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter' as const
  readonly definition: ProviderDefinition = PROVIDER_REGISTRY.openrouter

  /** Returns true when the key matches the expected OpenRouter key pattern. */
  validateKey(key: string): boolean {
    return this.definition.keyPattern.test(key)
  }

  /**
   * Fetches the live model list from the OpenRouter API and maps the first
   * {@link MAX_MODELS} results to `ProviderModel[]`.  Falls back to the
   * registry list on any network or HTTP error.
   */
  async listModels(key: string): Promise<ProviderModel[]> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return this.definition.models
      const data = await res.json() as {
        data: Array<{ id: string; name: string }>
      }
      return data.data.slice(0, MAX_MODELS).map((m) => ({
        id: m.id,
        name: m.name,
      }))
    } catch {
      return this.definition.models
    }
  }

  /**
   * Performs a lightweight connectivity and authentication check against the
   * OpenRouter API, returning a human-readable error message on failure.
   */
  async testConnectivity(key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 401) {
        return { ok: false, error: 'Invalid API key. Get yours at openrouter.ai/keys' }
      }
      if (res.status === 429) {
        return { ok: false, error: 'Rate limited. Wait a moment and try again.' }
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} from OpenRouter API` }
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `Network error: ${e.message}` }
    }
  }
}
