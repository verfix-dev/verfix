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
  // Keyboard key for the 'press' action (Playwright key names, e.g. "Enter", "Escape", "Tab").
  key: z.string().optional(),
  timeout: z.number().optional(),
  // Best-effort step: any failure within its timeout is skipped, not fatal.
  optional: z.boolean().optional(),
  // upload_file: project-relative fixture path, or inline content materialized
  // at run time (CI-safe: no filesystem dependency). encoding 'base64' for binary.
  file: z.union([
    z.string().min(1),
    z.object({
      name: z.string().min(1),
      content: z.string(),
      mimeType: z.string().optional(),
      encoding: z.enum(['utf8', 'base64']).optional(),
    }),
  ]).optional(),
  // CSS selector of an <iframe>; the step's target is resolved inside that frame.
  frame: z.string().optional(),
})

export const FlowAssertionSchema = z.object({
  type: z.string(),
  selector: z.string().optional(),
  value: z.string().optional(),
  timeout: z.number().optional(),
  // network_request_success: replaces the default 200-399 pass range when set.
  acceptStatuses: z.array(z.number().int()).min(1).optional(),
  // no_console_errors: regex patterns; matching errors are ignored.
  exclude: z.array(z.string()).optional().refine(
    (patterns) => !patterns || patterns.every((p) => {
      try { new RegExp(p); return true } catch { return false }
    }),
    { message: 'exclude must contain valid regex patterns' },
  ),
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
  // Clear cookies + local/session storage before this flow runs.
  clearState: z.boolean().optional(),
  // Auth state reuse: restore the named storage state (cookies + localStorage)
  // saved by a previous run / save this context's state under a name once the
  // flow passes. Names become filenames under .verfix/state/.
  useState: z.string().regex(/^[A-Za-z0-9_-]+$/, 'useState must contain only letters, digits, dash, underscore').optional(),
  saveState: z.string().regex(/^[A-Za-z0-9_-]+$/, 'saveState must contain only letters, digits, dash, underscore').optional(),
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
