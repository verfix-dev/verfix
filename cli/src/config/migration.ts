import fs from 'fs'
import path from 'path'
import { ProviderId } from './schema'
import { detectProviderFromModel } from '../providers/registry'

export interface MigrationResult {
  migrated: boolean
  provider?: ProviderId
  model?: string
  apiKey?: string
  notice?: string
}

/**
 * Reads old-style .verfix/.env and detects if migration is needed.
 * Old format uses generic AI_API_KEY / AI_MODEL.
 * New format uses OPENAI_API_KEY / ANTHROPIC_API_KEY etc.
 */
export function detectLegacyConfig(cwd: string): MigrationResult {
  const envPath = path.join(cwd, '.verfix', '.env')
  if (!fs.existsSync(envPath)) {
    return { migrated: false }
  }

  const content = fs.readFileSync(envPath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  const env: Record<string, string> = {}
  for (const line of lines) {
    const idx = line.indexOf('=')
    if (idx > 0) {
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }

  // Check if this is OLD format (has AI_API_KEY but no AI_PROVIDER)
  const hasOldKey = 'AI_API_KEY' in env
  const hasProvider = 'AI_PROVIDER' in env

  if (!hasOldKey || hasProvider) {
    // Already migrated or not old format
    return { migrated: false }
  }

  const apiKey = env['AI_API_KEY']
  const model = env['AI_MODEL'] || ''
  const provider = model ? detectProviderFromModel(model) : null

  return {
    migrated: true,
    provider: provider ?? undefined,
    model: model || undefined,
    apiKey: apiKey || undefined,
    notice: provider
      ? `Found legacy config with model '${model}' — detected provider: ${provider}`
      : `Found legacy config but could not detect provider from model '${model}'`,
  }
}

/**
 * Performs the migration: rewrites .verfix/.env with provider-specific key name.
 * Returns the new env content.
 */
export function migrateLegacyEnv(
  cwd: string,
  provider: ProviderId,
  apiKey: string,
  model: string,
  providerEnvVar: string,
): void {
  const envPath = path.join(cwd, '.verfix', '.env')
  const lines = [
    `AI_PROVIDER=${provider}`,
    `${providerEnvVar}=${apiKey}`,
    `AI_MODEL=${model}`,
  ]
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')
}
