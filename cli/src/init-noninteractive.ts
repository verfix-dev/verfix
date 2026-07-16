import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { DEFAULT_CONFIG, getRunnerMode } from './constants';
import { generateAgentsSection, generateAgentsStub } from './agents-md';
import { detectAllAgentPlatforms } from './agent-platform';
import { writeAgentsMd, writeVerfixInstructions, writePlatformAgentFiles } from './agent-writer';
import {
  isDockerInstalled, isDockerRunning, pullImage, startContainer,
  getContainerState, syncRuntimePortsFromContainer,
} from './docker';
import { waitForHealth } from './health';
import { getRuntimePorts } from './runtime';
import { PROVIDER_REGISTRY } from './providers/registry';
import type { ProviderId } from './providers/types';
import { saveAIConfig } from './config/loader';
import { detectFramework, type DetectedFramework } from './framework-detect';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NonInteractiveOptions {
  yes: boolean;
  aiProvider?: string;
  aiModel?: string;
  aiKey?: string;
  baseUrl?: string;
  mode?: string;
  skipRuntime?: boolean;
  skipAgentFiles?: boolean;
  dryRun?: boolean;
}

interface ResolvedConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  mode: string;
  skipRuntime: boolean;
  skipAgentFiles: boolean;
  /** Detected framework (Next.js/Vite/…), or null when none matched. Drives
   *  the scaffolded starter flow — null means today's behavior (flows: []). */
  framework: DetectedFramework | null;
}

// ─── Provider auto-detect from key format ────────────────────────────────────

const VALID_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter'];

export function maskApiKey(key: string): string {
  if (key.startsWith('sk-ant-')) return `sk-ant-****${key.slice(-4)}`;
  if (key.startsWith('sk-or-')) return `sk-or-****${key.slice(-4)}`;
  if (key.startsWith('sk-')) return `sk-****${key.slice(-4)}`;
  if (key.startsWith('gemini-')) return `gemini-****${key.slice(-4)}`;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function detectProviderFromKey(key: string): ProviderId | null {
  // Order matters: prefixes must be checked specifically first
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('gemini-') || key.startsWith('AIza') || key.startsWith('AQ')) return 'gemini';
  return null;
}

export function getDefaultModel(provider: ProviderId): string {
  const def = PROVIDER_REGISTRY[provider];
  if (provider === 'openrouter') return 'openrouter/auto';
  const recommended = def.models.find(m => m.recommended);
  return recommended?.id ?? def.models[0]?.id ?? 'gpt-4o-mini';
}

// ─── Resolve API key from all sources ────────────────────────────────────────

function resolveApiKey(opts: NonInteractiveOptions): string | null {
  // 1. CLI flag
  if (opts.aiKey) return opts.aiKey;

  // 2. VERFIX_AI_KEY env var
  if (process.env.VERFIX_AI_KEY) return process.env.VERFIX_AI_KEY;

  // 3. Provider-specific env vars
  const providerEnvVars = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
  ];

  for (const envVar of providerEnvVars) {
    if (process.env[envVar]) return process.env[envVar]!;
  }

  return null;
}

export function resolveConfig(opts: NonInteractiveOptions, cwd: string = process.cwd()): ResolvedConfig {
  // Framework detection (lookup, not a plugin system) — only fills in
  // defaults; an explicit --base-url/env var always wins below.
  const framework = detectFramework(cwd);

  // Resolve mode first — strict needs no AI key at all
  const modeValue = opts.mode || process.env.VERFIX_MODE || 'strict';
  const validModes = ['strict', 'assisted', 'exploratory'];
  if (!validModes.includes(modeValue)) {
    throw new Error(`Invalid mode: '${modeValue}'. Valid modes: ${validModes.join(', ')}`);
  }

  // Resolve API key — required only for AI-backed modes
  const apiKey = resolveApiKey(opts);

  if (!apiKey && modeValue !== 'strict' && !opts.dryRun) {
    throw new Error(`AI API key is required for '${modeValue}' mode. Supply it via --ai-key CLI flag or VERFIX_AI_KEY environment variable, or use --mode strict (no AI needed).`);
  }

  // Resolve provider
  let provider: ProviderId | undefined;

  // From CLI flag
  const cliProvider = opts.aiProvider || process.env.VERFIX_AI_PROVIDER;
  if (cliProvider) {
    if (!VALID_PROVIDERS.includes(cliProvider as ProviderId)) {
      throw new Error(`Invalid provider: '${cliProvider}'. Valid providers: ${VALID_PROVIDERS.join(', ')}`);
    }
    provider = cliProvider as ProviderId;
  }

  // Auto-detect from key format
  if (!provider && apiKey) {
    const detected = detectProviderFromKey(apiKey);
    if (detected) {
      provider = detected;
    } else if (!opts.aiProvider && !process.env.VERFIX_AI_PROVIDER) {
      throw new Error('Cannot auto-detect provider from key format. Pass --ai-provider explicitly.');
    }
  }

  // Fallback for dry-run with no key
  if (!provider) {
    provider = 'openai';
  }

  // Resolve model
  const model = opts.aiModel
    || process.env.VERFIX_AI_MODEL
    || getDefaultModel(provider);

  // Resolve base URL — explicit flag/env var always wins; detected framework
  // fills in the default only when neither was supplied.
  const baseUrl = opts.baseUrl
    || process.env.VERFIX_BASE_URL
    || framework?.defaultUrl
    || 'http://localhost:3000';

  return {
    provider,
    model,
    apiKey: apiKey || '',
    baseUrl,
    mode: modeValue,
    skipRuntime: opts.skipRuntime ?? false,
    skipAgentFiles: opts.skipAgentFiles ?? false,
    framework,
  };
}

// ─── Main non-interactive init ───────────────────────────────────────────────

export async function runNonInteractiveInit(opts: NonInteractiveOptions): Promise<void> {
  const cwd = process.cwd();
  const runnerMode = getRunnerMode();

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ Verfix Non-Interactive Setup'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log('');

  // ── Step 1: Resolve and validate config ──
  const config = resolveConfig(opts, cwd);
  if (config.framework) {
    console.log(chalk.gray(`  ℹ Detected ${config.framework.name} — defaulting base URL to ${config.framework.defaultUrl} and scaffolding a starter flow (${config.framework.scaffoldFlow.id})`));
  }

  // ── Step 2: Dry run ──
  if (opts.dryRun) {
    const dryRunOutput = {
      mode: 'dry-run',
      provider: config.apiKey ? config.provider : '(none)',
      model: config.apiKey ? config.model : '(none)',
      apiKey: config.apiKey ? maskApiKey(config.apiKey) : '(none)',
      baseUrl: config.baseUrl,
      verificationMode: config.mode,
      skipRuntime: config.skipRuntime,
      skipAgentFiles: config.skipAgentFiles,
      framework: config.framework?.name ?? null,
      files: {
        '.verfix/.env': 'AI provider config (provider, key, model)',
        'verfix.config.json': config.framework
          ? `{ baseUrl: "${config.baseUrl}", mode: "${config.mode}", flows: [{ id: "${config.framework.scaffoldFlow.id}", ... }] }`
          : `{ baseUrl: "${config.baseUrl}", mode: "${config.mode}", flows: [] }`,
        'AGENTS.md': 'Verfix agent instructions with setup section',
        ...(!config.skipAgentFiles ? {
          '.cursorrules': 'Cursor agent rules (if platform detected)',
          'CLAUDE.md': 'Claude agent instructions (if platform detected)',
          'CODEX.md': 'Codex agent instructions (if platform detected)',
        } : {}),
      },
    };

    console.log(chalk.bold('  Dry run — the following would be configured:'));
    console.log('');
    console.log(JSON.stringify(dryRunOutput, null, 2));
    console.log('');
    return;
  }

  // ── Step 3: Save AI config to .verfix/.env (only when a key was supplied) ──
  const hasAI = Boolean(config.apiKey);
  if (hasAI) {
    const spinner1 = ora('Saving AI configuration...').start();
    saveAIConfig(cwd, config.provider, config.model, config.apiKey);
    spinner1.succeed(`AI configuration saved (${PROVIDER_REGISTRY[config.provider].displayName} / ${config.model})`);
  } else {
    console.log(chalk.gray('  ⏭ Strict mode — no AI key needed, skipping AI configuration'));
  }

  // ── Step 4: Runtime — local mode just needs a browser; server mode needs Docker ──
  if (runnerMode === 'local') {
    if (config.skipRuntime) {
      console.log(chalk.gray('  ⏭ Skipping browser check (--skip-runtime)'));
    } else {
      const { isChromiumInstalled, ensureChromium } = await import('./local-runner');
      if (isChromiumInstalled()) {
        console.log(chalk.green('  ✓ Chromium ready'));
      } else {
        try {
          await ensureChromium();
          console.log(chalk.green('  ✓ Chromium installed'));
        } catch (e: any) {
          console.log(chalk.yellow(`  ⚠ ${e.message}`));
          console.log(chalk.gray('    verfix run will retry the download on first use'));
        }
      }
    }
  } else if (!config.skipRuntime) {
    const state = getContainerState();
    if (state?.status === 'running') {
      syncRuntimePortsFromContainer();
      console.log(chalk.green('  ✓ Verfix runtime is already running'));
    } else {
      // Check Docker availability
      if (!isDockerInstalled() || !isDockerRunning()) {
        console.log(chalk.yellow('  ⚠ Docker is not available. Skipping runtime start.'));
        console.log(chalk.gray('    Install Docker from https://docker.com and run: verfix start'));
      } else {
        const pullSpinner = ora('Pulling verfix runtime image...').start();
        try {
          pullImage();
          pullSpinner.succeed('Image pulled');
        } catch (e: any) {
          pullSpinner.fail(`Failed to pull image: ${e.message}`);
          console.log(chalk.yellow('  ⚠ Continuing without runtime. Run: verfix start'));
        }

        const startSpinner = ora('Starting runtime...').start();
        try {
          await startContainer({ aiApiKey: config.apiKey, aiModel: config.model, aiProvider: config.provider });
          startSpinner.text = 'Waiting for health check...';
          const healthy = await waitForHealth();
          if (!healthy) {
            startSpinner.fail('Runtime started but health check failed after 30s');
            console.log(chalk.yellow('  ⚠ Continuing anyway. Check: verfix doctor'));
          } else {
            startSpinner.succeed('Runtime started and healthy');
          }
        } catch (e: any) {
          startSpinner.fail(`Failed to start runtime: ${e.message}`);
          console.log(chalk.yellow('  ⚠ Continuing without runtime. Run: verfix start'));
        }
      }
    }
  } else {
    console.log(chalk.gray('  ⏭ Skipping runtime (--skip-runtime)'));
  }

  // ── Step 5: Write verfix.config.json ──
  // Unknown framework ⇒ flows: [] (exactly today's behavior). Detected
  // framework ⇒ scaffold a flow that passes against its default starter page.
  const scaffoldedFlows = config.framework ? [config.framework.scaffoldFlow] : [];
  const configPath = path.join(cwd, DEFAULT_CONFIG);
  const configData: Record<string, unknown> = {
    baseUrl: config.baseUrl,
    mode: config.mode,
    ...(hasAI ? { ai: { provider: config.provider, model: config.model } } : {}),
    flows: scaffoldedFlows,
  };
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
  console.log(chalk.green('  ✓ verfix.config.json created'));
  if (config.framework) {
    console.log(chalk.green(`  ✓ Scaffolded starter flow: ${config.framework.scaffoldFlow.id}`));
  }

  // ── Step 6: Write .verfix/INSTRUCTIONS.md (full reference) + AGENTS.md stub ──
  const flowSummaries: { id: string }[] = scaffoldedFlows.map((f) => ({ id: f.id }));
  const verfixSection = generateAgentsSection(flowSummaries, config.mode, config.baseUrl);

  writeVerfixInstructions(cwd, verfixSection);
  console.log(chalk.green('  ✓ .verfix/INSTRUCTIONS.md created'));

  const createdAgentsMd = writeAgentsMd(cwd, generateAgentsStub());
  if (createdAgentsMd) {
    console.log(chalk.green('  ✓ AGENTS.md created'));
  } else {
    console.log(chalk.green('  ✓ AGENTS.md Verfix section updated'));
  }

  // ── Step 7: Write platform-specific agent files ──
  if (!config.skipAgentFiles) {
    const detectedPlatforms = detectAllAgentPlatforms(cwd);
    const platformsToWrite = detectedPlatforms.length > 0 ? detectedPlatforms : [];
    const written = writePlatformAgentFiles(cwd, platformsToWrite, config.mode, config.baseUrl);
    for (const file of written) {
      console.log(chalk.green(`  ✓ ${file} created/updated`));
    }
  } else {
    console.log(chalk.gray('  ⏭ Skipping agent files (--skip-agent-files)'));
  }

  // ── Summary ──
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  if (hasAI) {
    console.log(chalk.green(`  ✓ AI configured: ${PROVIDER_REGISTRY[config.provider].displayName} / ${config.model}`));
  }
  console.log(chalk.green('  ✓ verfix.config.json created'));
  console.log(chalk.green('  ✓ AGENTS.md updated'));
  if (runnerMode === 'server' && !config.skipRuntime) {
    const state = getContainerState();
    if (state?.status === 'running') {
      const ports = getRuntimePorts();
      console.log(chalk.green('  ✓ Runtime running'));
      console.log(`    API:       ${chalk.cyan(`http://localhost:${ports.apiPort}`)}`);
      console.log(`    Dashboard: ${chalk.cyan(`http://localhost:${ports.dashboardPort}`)}`);
    }
  }
  console.log('');
  console.log(chalk.bold('  Next step — add your first flow:'));
  console.log(`    Edit ${chalk.cyan('verfix.config.json')} and add a flow to the ${chalk.cyan('flows')} array`);
  console.log(`    Then run: ${chalk.cyan('verfix run --flow <id> --output json')}`);
  console.log('');
}
