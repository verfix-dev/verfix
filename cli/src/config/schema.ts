import { z } from 'zod'

export const ProviderIdSchema = z.enum(['openai', 'anthropic', 'gemini', 'openrouter'])

export const VerfixAIConfigSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1, 'Model name cannot be empty'),
})

export const FlowStepSchema = z.object({
  action: z.string(),
  selector: z.string().optional(),
  testId: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  timeout: z.number().optional(),
})

export const FlowAssertionSchema = z.object({
  type: z.string(),
  selector: z.string().optional(),
  value: z.string().optional(),
})

export const FlowSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  mode: z.string().optional(),
  skip: z.boolean().optional(),
  skipReason: z.string().optional(),
  steps: z.array(FlowStepSchema).optional(),
  assertions: z.array(FlowAssertionSchema).optional(),
})

export const VerfixConfigSchema = z.object({
  baseUrl: z.string().optional(),
  mode: z.enum(['strict', 'assisted', 'exploratory', 'smoke']).optional(),
  ai: VerfixAIConfigSchema.optional(),
  flows: z.array(FlowSchema).optional(),
  task: z.string().optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  // Governs what happens when an agent edits project source during a verify loop.
  //   'warn'  → run still passes, but reports which project files changed (default)
  //   'block' → run fails with source_edit_blocked if project files changed
  //   'off'   → no source-change detection
  sourceCodePolicy: z.enum(['warn', 'block', 'off']).optional(),
  selectors: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  assertions: z.array(FlowAssertionSchema).optional(),
  // Local-mode browser options.
  //   channel  → reuse an installed browser (e.g. 'chrome') and skip the
  //              Playwright Chromium download entirely
  //   headless → default headlessness for local runs (--show-browser overrides)
  browser: z.object({
    channel: z.string().optional(),
    headless: z.boolean().optional(),
  }).optional(),
})

export type ProviderId = z.infer<typeof ProviderIdSchema>
export type VerfixAIConfig = z.infer<typeof VerfixAIConfigSchema>
export type VerfixConfig = z.infer<typeof VerfixConfigSchema>
