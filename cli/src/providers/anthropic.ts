import { AIProvider, ProviderModel, ProviderDefinition } from './types'
import { PROVIDER_REGISTRY } from './registry'

/** Shared request headers required by every Anthropic API call. */
const ANTHROPIC_HEADERS = {
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
} as const

/**
 * Anthropic provider implementation.
 *
 * Uses raw HTTP via Node 18+ built-in `fetch` — no SDK dependency.
 * Authentication is performed via the `x-api-key` request header.
 */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  readonly definition: ProviderDefinition = PROVIDER_REGISTRY.anthropic

  /** Returns true when the key matches the expected Anthropic key pattern. */
  validateKey(key: string): boolean {
    return this.definition.keyPattern.test(key)
  }

  /**
   * Fetches the live model list from the Anthropic API and filters it down to
   * the curated set defined in the registry.  Falls back to the registry list
   * on any network or HTTP error so the CLI remains usable offline.
   */
  async listModels(key: string): Promise<ProviderModel[]> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          ...ANTHROPIC_HEADERS,
          'x-api-key': key,
        },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return this.definition.models
      const data = await res.json() as {
        data: Array<{ id: string; display_name: string }>
      }
      // Return curated list, filtering to only those the API confirms exist.
      const available = new Set(data.data.map((m) => m.id))
      return this.definition.models.filter((m) => available.has(m.id))
    } catch {
      return this.definition.models
    }
  }

  /**
   * Performs a lightweight connectivity and authentication check against the
   * Anthropic API, returning a human-readable error message on failure.
   */
  async testConnectivity(key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          ...ANTHROPIC_HEADERS,
          'x-api-key': key,
        },
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 401) {
        return { ok: false, error: 'Invalid API key. Get yours at console.anthropic.com' }
      }
      if (res.status === 429) {
        return { ok: false, error: 'Rate limited. Wait a moment and try again.' }
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} from Anthropic API` }
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `Network error: ${e.message}` }
    }
  }
}
