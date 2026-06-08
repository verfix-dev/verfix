import { AIProvider, ProviderModel, ProviderDefinition } from './types'
import { PROVIDER_REGISTRY } from './registry'

/** Base URL for the Google Generative Language REST API. */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Prefix returned in the `name` field of every model object. */
const MODEL_NAME_PREFIX = 'models/'

/**
 * Google Gemini provider implementation.
 *
 * Uses raw HTTP via Node 18+ built-in `fetch` — no SDK dependency.
 * Authentication is done via a `key` query parameter; no `Authorization`
 * header is required.
 */
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly definition: ProviderDefinition = PROVIDER_REGISTRY.gemini

  /** Returns true when the key matches the expected Gemini (AI Studio) key pattern. */
  validateKey(key: string): boolean {
    return this.definition.keyPattern.test(key)
  }

  /**
   * Fetches the live model list from the Gemini API and filters it down to
   * the curated set defined in the registry.  Falls back to the registry list
   * on any network or HTTP error so the CLI remains usable offline.
   *
   * The API returns model names as `models/<id>` (e.g. `models/gemini-2.5-pro`);
   * the prefix is stripped before matching against the registry.
   */
  async listModels(key: string): Promise<ProviderModel[]> {
    try {
      const res = await fetch(`${GEMINI_BASE}/models?key=${key}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return this.definition.models
      const data = await res.json() as {
        models: Array<{ name: string; displayName: string }>
      }
      // Strip the "models/" prefix to get a plain model id.
      const available = new Set(
        data.models.map((m) =>
          m.name.startsWith(MODEL_NAME_PREFIX)
            ? m.name.slice(MODEL_NAME_PREFIX.length)
            : m.name
        )
      )
      return this.definition.models.filter((m) => available.has(m.id))
    } catch {
      return this.definition.models
    }
  }

  /**
   * Performs a lightweight connectivity and authentication check against the
   * Gemini API, returning a human-readable error message on failure.
   */
  async testConnectivity(key: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${GEMINI_BASE}/models?key=${key}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: 'Invalid API key. Get yours at aistudio.google.com' }
      }
      if (res.status === 429) {
        return { ok: false, error: 'Rate limited. Wait a moment and try again.' }
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} from Gemini API` }
      }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: `Network error: ${e.message}` }
    }
  }
}
