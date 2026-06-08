import { AIProvider, ProviderModel, ProviderDefinition } from './types'
import { PROVIDER_REGISTRY } from './registry'

/**
 * OpenAI provider implementation.
 *
 * Uses raw HTTP via Node 18+ built-in `fetch` — no SDK dependency.
 * Key validation and model enumeration are both done against the
 * https://api.openai.com/v1/models endpoint.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly definition: ProviderDefinition = PROVIDER_REGISTRY.openai

  /** Returns true when the key matches the expected OpenAI key pattern. */
  validateKey(key: string): boolean {
    return this.definition.keyPattern.test(key)
  }

  /**
   * Fetches the live model list from the OpenAI API and filters it down to
   * the curated set defined in the registry.  Falls back to the registry list
   * on any network or HTTP error so the CLI remains usable offline.
   */
  async listModels(key: string): Promise<ProviderModel[]> {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return this.definition.models
      const data = await res.json() as { data: Array<{ id: string }> }
      // Return curated list, filtering to only those the API confirms exist.
      const available = new Set(data.data.map((m) => m.id))
      return this.definition.models.filter((m) => available.has(m.id))
    } catch {
      return this.definition.models
    }
  }

  /**
   * Performs a lightweight connectivity and authentication check against the
   * OpenAI API, returning a human-readable error message on failure.
   */
  async testConnectivity(key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 401) {
        return { ok: false, error: 'Invalid API key. Check your OpenAI API key at platform.openai.com' }
      }
      if (res.status === 429) {
        return { ok: false, error: 'Rate limited. Wait a moment and try again.' }
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} from OpenAI API` }
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `Network error: ${e.message}` }
    }
  }
}
