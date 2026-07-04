import fs from 'fs'
import path from 'path'
import { VerfixAIConfig, VerfixConfig, VerfixConfigSchema } from './schema'
import { ProviderId } from './schema'
import { PROVIDER_REGISTRY } from '../providers/registry'

/** Resolve env var references like $OPENAI_API_KEY */
function resolveEnvRef(value: string): string {
  if (value.startsWith('$')) {
    const varName = value.slice(1)
    return process.env[varName] || value
  }
  return value
}

/**
 * Parse .verfix/.env file into a key-value map.
 */
export function parseEnvFile(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, '.verfix', '.env')
  if (!fs.existsSync(envPath)) return {}

  const content = fs.readFileSync(envPath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx > 0) {
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
  }
  return result
}

/**
 * Load AI config from .verfix/.env.
 * Returns null if no provider config found.
 */
export function loadAIConfig(cwd: string): VerfixAIConfig | null {
  const env = parseEnvFile(cwd)
  const provider = (env['AI_PROVIDER'] || process.env['AI_PROVIDER']) as ProviderId | undefined
  const model = resolveEnvRef(env['AI_MODEL'] || process.env['AI_MODEL'] || '')

  if (!provider || !model) return null

  const validProviders: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter']
  if (!validProviders.includes(provider)) return null

  return { provider, model }
}

/**
 * Get the API key for the given provider from .verfix/.env or process.env.
 */
export function loadApiKey(cwd: string, provider: ProviderId): string | null {
  const def = PROVIDER_REGISTRY[provider]
  const env = parseEnvFile(cwd)

  // Check .verfix/.env first (provider-specific)
  const envFileKey = env[def.envVar]
  if (envFileKey) return resolveEnvRef(envFileKey)

  // Fall back to process.env
  return process.env[def.envVar] || null
}

/**
 * Save AI config to .verfix/.env.
 */
export function saveAIConfig(
  cwd: string,
  provider: ProviderId,
  model: string,
  apiKey: string,
): void {
  const def = PROVIDER_REGISTRY[provider]
  const envDir = path.join(cwd, '.verfix')
  if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true })

  // Read existing variables first so we don't discard them (in case user had custom ones)
  const env = parseEnvFile(cwd)

  // Set new values
  env['AI_PROVIDER'] = provider
  env[def.envVar] = apiKey
  env['AI_MODEL'] = model

  const lines = Object.entries(env).map(([key, val]) => `${key}=${val}`)
  fs.writeFileSync(path.join(envDir, '.env'), lines.join('\n') + '\n', 'utf-8')
}

/**
 * Load and Zod-validate verfix.config.json.
 * Returns null if file doesn't exist.
 * Throws if file exists but is invalid.
 */
export function loadVerfixConfig(configPath: string): VerfixConfig | null {
  if (!fs.existsSync(configPath)) return null

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const result = VerfixConfigSchema.safeParse(raw)

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Config validation failed: ${errors}`)
  }

  return result.data
}

/**
 * Update the `ai` block in verfix.config.json without touching other fields.
 */
export function updateAIConfigInFile(
  configPath: string,
  provider: ProviderId,
  model: string,
): void {
  let existing: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  }
  existing.ai = { provider, model }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
}
