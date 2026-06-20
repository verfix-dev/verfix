import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { DEFAULT_CONFIG } from './constants';
import {
  generateAgentsSection,
  generateCursorRules,
  generateClaudeSection,
  generateCodexInstructions,
} from './agents-md';
import { detectAllAgentPlatforms, getAgentFilePath } from './agent-platform';
import {
  isDockerInstalled, isDockerRunning, pullImage, startContainer,
  getContainerState, syncRuntimePortsFromContainer,
} from './docker';
import { waitForHealth } from './health';
import { getRuntimePorts } from './runtime';
import { PROVIDER_REGISTRY } from './providers/registry';
import type { ProviderId } from './providers/types';
import { saveAIConfig } from './config/loader';

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
}

// ─── Provider auto-detect from key format ────────────────────────────────────

const VALID_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter'];

function detectProviderFromKey(key: string): ProviderId | null {
  // Order matters: sk-ant-* must be checked before sk-*
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AIza') || key.startsWith('AQ')) return 'gemini';
  // We can't auto-detect openrouter — it uses sk-or- prefix
  if (key.startsWith('sk-or-')) return 'openrouter';
  return null;
}

function getDefaultModel(provider: ProviderId): string {
  const def = PROVIDER_REGISTRY[provider];
  if (def.freeformModel) return 'openai/gpt-4o-mini';
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

// ─── Resolve all config values ───────────────────────────────────────────────

function resolveConfig(opts: NonInteractiveOptions): ResolvedConfig {
  // Resolve API key
  const apiKey = resolveApiKey(opts);

  if (!apiKey && !opts.dryRun) {
    console.error(chalk.red('✗ API key required. Pass --ai-key or set VERFIX_AI_KEY (or provider-specific env var like OPENAI_API_KEY)'));
    process.exit(1);
  }

  // Resolve provider
  let provider: ProviderId | undefined;

  // From CLI flag
  const cliProvider = opts.aiProvider || process.env.VERFIX_AI_PROVIDER;
  if (cliProvider) {
    if (!VALID_PROVIDERS.includes(cliProvider as ProviderId)) {
      console.error(chalk.red(`✗ Invalid provider: '${cliProvider}'. Valid providers: ${VALID_PROVIDERS.join(', ')}`));
      process.exit(1);
    }
    provider = cliProvider as ProviderId;
  }

  // Auto-detect from key format
  if (!provider && apiKey) {
    const detected = detectProviderFromKey(apiKey);
    if (detected) {
      provider = detected;
    } else if (!opts.aiProvider && !process.env.VERFIX_AI_PROVIDER) {
      console.error(chalk.red('✗ Cannot auto-detect provider from key format. Pass --ai-provider explicitly.'));
      process.exit(1);
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

  // Resolve base URL
  const baseUrl = opts.baseUrl
    || process.env.VERFIX_BASE_URL
    || 'http://localhost:3000';

  // Resolve mode
  const modeValue = opts.mode || process.env.VERFIX_MODE || 'assisted';
  const validModes = ['strict', 'assisted', 'exploratory'];
  if (!validModes.includes(modeValue)) {
    console.error(chalk.red(`✗ Invalid mode: '${modeValue}'. Valid modes: ${validModes.join(', ')}`));
    process.exit(1);
  }

  return {
    provider,
    model,
    apiKey: apiKey || '',
    baseUrl,
    mode: modeValue,
    skipRuntime: opts.skipRuntime ?? false,
    skipAgentFiles: opts.skipAgentFiles ?? false,
  };
}

// ─── Main non-interactive init ───────────────────────────────────────────────

export async function runNonInteractiveInit(opts: NonInteractiveOptions): Promise<void> {
  const cwd = process.cwd();

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ Verfix Non-Interactive Setup'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log('');

  // ── Step 1: Resolve and validate config ──
  const config = resolveConfig(opts);

  // ── Step 2: Dry run ──
  if (opts.dryRun) {
    const dryRunOutput = {
      mode: 'dry-run',
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}${'*'.repeat(Math.max(0, config.apiKey.length - 8))}` : '(none)',
      baseUrl: config.baseUrl,
      verificationMode: config.mode,
      skipRuntime: config.skipRuntime,
      skipAgentFiles: config.skipAgentFiles,
      files: {
        '.verfix/.env': 'AI provider config (provider, key, model)',
        'verfix.config.json': `{ baseUrl: "${config.baseUrl}", mode: "${config.mode}", flows: [] }`,
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
    process.exit(0);
  }

  // ── Step 3: Save AI config to .verfix/.env ──
  const spinner1 = ora('Saving AI configuration...').start();
  saveAIConfig(cwd, config.provider, config.model, config.apiKey);
  spinner1.succeed(`AI configuration saved (${PROVIDER_REGISTRY[config.provider].displayName} / ${config.model})`);

  // ── Step 4: Docker runtime ──
  if (!config.skipRuntime) {
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
  const configPath = path.join(cwd, DEFAULT_CONFIG);
  const configData: Record<string, unknown> = {
    baseUrl: config.baseUrl,
    mode: config.mode,
    ai: { provider: config.provider, model: config.model },
    flows: [],
  };
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
  console.log(chalk.green('  ✓ verfix.config.json created'));

  // ── Step 6: Write AGENTS.md ──
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const flowSummaries: { id: string }[] = [];
  const runtimePorts = getRuntimePorts();
  const verfixSection = generateAgentsSection(flowSummaries, config.mode, config.baseUrl, runtimePorts);

  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, verfixSection + '\n', 'utf-8');
    console.log(chalk.green('  ✓ AGENTS.md created'));
  } else {
    const existing = fs.readFileSync(agentsPath, 'utf-8');
    const sectionRegex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;

    if (sectionRegex.test(existing)) {
      const updated = existing.replace(sectionRegex, verfixSection);
      fs.writeFileSync(agentsPath, updated, 'utf-8');
      console.log(chalk.green('  ✓ AGENTS.md Verfix section updated'));
    } else {
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
      console.log(chalk.green('  ✓ AGENTS.md updated (Verfix section appended)'));
    }
  }

  // ── Step 7: Write platform-specific agent files ──
  if (!config.skipAgentFiles) {
    const detectedPlatforms = detectAllAgentPlatforms(cwd);
    // In non-interactive mode, write files for all detected platforms
    const platformsToWrite = detectedPlatforms.length > 0 ? detectedPlatforms : [];

    for (const platform of platformsToWrite) {
      const platformPath = getAgentFilePath(platform, cwd);
      const platformFileName = path.basename(platformPath);
      let platformContent = '';

      if (platform === 'cursor') {
        platformContent = generateCursorRules(flowSummaries, config.mode, config.baseUrl, runtimePorts);
      } else if (platform === 'claude') {
        platformContent = generateClaudeSection(flowSummaries, config.mode, config.baseUrl, runtimePorts);
      } else if (platform === 'codex') {
        platformContent = generateCodexInstructions(flowSummaries, config.mode, config.baseUrl, runtimePorts);
      }

      if (!platformContent) continue;

      if (!fs.existsSync(platformPath)) {
        fs.writeFileSync(platformPath, platformContent + '\n', 'utf-8');
        console.log(chalk.green(`  ✓ ${platformFileName} created`));
      } else {
        // In non-interactive mode, overwrite existing platform files
        const existingPlatform = fs.readFileSync(platformPath, 'utf-8');

        if (platform === 'cursor') {
          const startMarker = 'You are working in a project that uses Verfix';
          if (existingPlatform.includes(startMarker)) {
            const index = existingPlatform.indexOf(startMarker);
            const baseContent = existingPlatform.substring(0, index);
            fs.writeFileSync(platformPath, baseContent + platformContent + '\n', 'utf-8');
          } else {
            const separator = existingPlatform.endsWith('\n') ? '\n' : '\n\n';
            fs.writeFileSync(platformPath, existingPlatform + separator + platformContent + '\n', 'utf-8');
          }
        } else {
          const regex = /## Verfix[\s\S]*?(?=\n## |$)/;
          if (regex.test(existingPlatform)) {
            const updated = existingPlatform.replace(regex, platformContent.trim());
            fs.writeFileSync(platformPath, updated, 'utf-8');
          } else {
            const separator = existingPlatform.endsWith('\n') ? '\n' : '\n\n';
            fs.writeFileSync(platformPath, existingPlatform + separator + platformContent + '\n', 'utf-8');
          }
        }
        console.log(chalk.green(`  ✓ ${platformFileName} updated`));
      }
    }
  } else {
    console.log(chalk.gray('  ⏭ Skipping agent files (--skip-agent-files)'));
  }

  // ── Summary ──
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  console.log(chalk.green(`  ✓ AI configured: ${PROVIDER_REGISTRY[config.provider].displayName} / ${config.model}`));
  console.log(chalk.green('  ✓ verfix.config.json created'));
  console.log(chalk.green('  ✓ AGENTS.md updated'));
  if (!config.skipRuntime) {
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
