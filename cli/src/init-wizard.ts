import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, checkbox, confirm, password } from '@inquirer/prompts';
import {
  DOCKER_IMAGE, CONTAINER_NAME, DEFAULT_CONFIG,
} from './constants';
import {
  generateAgentsSection,
  generateCursorRules,
  generateClaudeSection,
  generateCodexInstructions,
} from './agents-md';
import { detectAllAgentPlatforms, getAgentFilePath } from './agent-platform';
import {
  isDockerRunning, pullImage, startContainer, getContainerState, syncRuntimePortsFromContainer,
} from './docker';
import { waitForHealth } from './health';
import axios from 'axios';
import net from 'net';
import { getRuntimePorts } from './runtime';
import { PROVIDER_REGISTRY, getAllProviders, getProviderChoices, detectProviderFromModel } from './providers/registry';
import type { ProviderId } from './providers/types';
import { detectLegacyConfig } from './config/migration';
import { saveAIConfig, updateAIConfigInFile } from './config/loader';

// ─── Port scanning ───────────────────────────────────────────────────────────

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

async function isVerfixApiPort(port: number): Promise<boolean> {
  try {
    const res = await axios.get(`http://localhost:${port}/api/v1/health`, { timeout: 700 });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function isLikelyFrontendPort(port: number): Promise<boolean> {
  try {
    const res = await axios.get(`http://localhost:${port}`, {
      timeout: 700,
      validateStatus: () => true,
      responseType: 'text',
      headers: { Accept: 'text/html' },
    });

    const contentType = String(res.headers['content-type'] || '').toLowerCase();
    const body = typeof res.data === 'string' ? res.data.toLowerCase() : '';

    return contentType.includes('text/html') || body.includes('<html') || body.includes('<!doctype html');
  } catch {
    return false;
  }
}

async function detectAppPort(): Promise<number | null> {
  const runtimePorts = getRuntimePorts();
  const candidates = [3000, 3001, 3002, 5173, 4173, 8080];
  const exclude = [runtimePorts.apiPort, runtimePorts.dashboardPort, 3610, 3611];
  for (const port of candidates) {
    if (exclude.includes(port)) continue;
    if (!(await isPortOpen(port))) continue;
    if (await isVerfixApiPort(port)) continue;
    if (await isLikelyFrontendPort(port)) return port;
  }
  return null;
}

// ─── README section builder ───────────────────────────────────────────────────

function buildReadmeSection(anchor: string): string {
  return `${anchor}
## Verification

This project uses [Verfix](https://verfix.dev) for browser verification.

\`\`\`bash
verfix run --flow <flow-id> --output json
\`\`\`

See [AGENTS.md](./AGENTS.md) for full verification documentation.`;
}

// ─── Provider-aware AI config flow ───────────────────────────────────────────

/**
 * Run the 4-step provider-aware AI configuration flow.
 * Returns the selected provider, model, and API key, or null if skipped.
 */
async function runProviderFlow(cwd: string): Promise<{
  provider: ProviderId;
  model: string;
  apiKey: string;
} | null> {
  // Check for legacy config and offer migration
  const legacy = detectLegacyConfig(cwd);
  if (legacy.migrated && legacy.notice) {
    console.log('');
    console.log(chalk.yellow(`  ⚠ ${legacy.notice}`));
    if (legacy.provider) {
      console.log(chalk.gray(`    Auto-migrating to provider: ${chalk.bold(legacy.provider)}`));
    } else {
      console.log(chalk.gray('    Could not auto-detect provider from model name. Please re-enter your config below.'));
    }
    console.log('');
  }

  // Check for pre-existing env vars from any provider
  const prefilledProvider = detectPrefilledProvider();

  // ── Step 1: Provider Selection ──
  console.log(chalk.bold.cyan('  Step 1/4 — Select AI Provider'));
  console.log('');

  const choices = getProviderChoices().map((c) => ({
    name: c.value === prefilledProvider
      ? `${c.name} ${chalk.green('(key found in environment)')}`
      : c.name,
    value: c.value,
  }));

  const provider = await select<ProviderId>({
    message: 'AI provider',
    choices,
    default: prefilledProvider ?? 'openai',
  });

  const def = PROVIDER_REGISTRY[provider];

  // ── Step 2: API Key Input ──
  console.log('');
  console.log(chalk.bold.cyan('  Step 2/4 — API Key'));
  console.log('');

  // Check if key already exists
  const existingKey = process.env[def.envVar] || '';
  const existingKeyMasked = existingKey ? `${existingKey.slice(0, 8)}${'*'.repeat(Math.max(0, existingKey.length - 8))}` : '';

  if (existingKey) {
    console.log(chalk.gray(`  ℹ Found ${def.envVar} in environment: ${existingKeyMasked}`));
    console.log('');
  }

  let apiKey: string;

  if (existingKey) {
    const useExisting = await confirm({
      message: `Use existing ${def.envVar} from environment?`,
      default: true,
    });
    if (useExisting) {
      apiKey = existingKey;
    } else {
      apiKey = await password({
        message: `Enter ${def.displayName} API key (${def.keyPatternHint}):`,
        mask: '*',
      });
    }
  } else {
    apiKey = await password({
      message: `Enter ${def.displayName} API key (${def.keyPatternHint}):`,
      mask: '*',
    });
  }

  if (!apiKey || apiKey.trim() === '') {
    console.log(chalk.gray('  ⏭ Skipping AI configuration (no key provided)'));
    return null;
  }

  apiKey = apiKey.trim();

  // Validate key format
  if (!def.keyPattern.test(apiKey)) {
    console.log(chalk.red(`  ✗ Key format invalid — expected a key that ${def.keyPatternHint}`));
    const retry = await confirm({
      message: 'Re-enter the API key?',
      default: true,
    });
    if (retry) {
      apiKey = (await password({
        message: `${def.displayName} API key:`,
        mask: '*',
      })).trim();
      if (!def.keyPattern.test(apiKey)) {
        console.log(chalk.red('  ✗ Key format still invalid. Skipping AI configuration.'));
        return null;
      }
    } else {
      return null;
    }
  }

  console.log(chalk.green('  ✓ Key format looks valid'));

  // Optional connectivity test
  console.log('');
  const runTest = await confirm({
    message: 'Test API key connectivity now? (recommended)',
    default: true,
  });

  if (runTest) {
    const connectSpinner = ora(`Testing ${def.displayName} connectivity...`).start();
    try {
      const { testConnectivity } = await getProviderImpl(provider);
      const result = await testConnectivity(apiKey);
      if (result.ok) {
        connectSpinner.succeed(`Connected to ${def.displayName} API`);
      } else {
        connectSpinner.fail(`Connectivity test failed: ${result.error}`);
        const continueAnyway = await confirm({
          message: 'Continue with this key anyway?',
          default: false,
        });
        if (!continueAnyway) return null;
      }
    } catch {
      connectSpinner.warn('Connectivity test skipped (timeout)');
    }
  }

  // ── Step 3: Model Selection ──
  console.log('');
  console.log(chalk.bold.cyan('  Step 3/4 — Select Model'));
  console.log('');

  let model: string;

  if (def.freeformModel) {
    // OpenRouter: freeform input
    console.log(chalk.gray(`  ℹ OpenRouter supports any model. Enter the model ID (e.g. openai/gpt-4o-mini)`));
    console.log('');
    model = await input({
      message: 'Model ID',
      default: 'openai/gpt-4o-mini',
    });
  } else {
    // Curated model list
    const modelChoices = def.models.map((m) => ({
      name: m.recommended ? `${m.name} ⭐` : m.name,
      value: m.id,
    }));

    model = await select({
      message: `${def.displayName} model`,
      choices: modelChoices,
      default: def.models.find((m) => m.recommended)?.id ?? def.models[0]?.id,
    });
  }

  // ── Step 4: Confirm & Persist ──
  console.log('');
  console.log(chalk.bold.cyan('  Step 4/4 — Confirm'));
  console.log('');
  console.log(`  Provider: ${chalk.cyan(def.displayName)}`);
  console.log(`  Model:    ${chalk.cyan(model)}`);
  console.log(`  Key:      ${chalk.gray(apiKey.slice(0, 8) + '*'.repeat(Math.max(0, apiKey.length - 8)))}`);
  console.log('');

  const confirmed = await confirm({
    message: 'Save this configuration?',
    default: true,
  });

  if (!confirmed) {
    console.log(chalk.gray('  ⏭ AI configuration skipped'));
    return null;
  }

  return { provider, model, apiKey };
}

/**
 * Detect if any provider has a key already set in process.env.
 */
function detectPrefilledProvider(): ProviderId | null {
  const providers = getAllProviders();
  for (const p of providers) {
    if (process.env[p.envVar]) return p.id;
  }
  return null;
}

/**
 * Lazy-load provider implementation for connectivity testing.
 */
async function getProviderImpl(provider: ProviderId): Promise<{
  testConnectivity: (key: string) => Promise<{ ok: boolean; error?: string }>;
}> {
  switch (provider) {
    case 'openai': {
      const { OpenAIProvider } = await import('./providers/openai');
      return new OpenAIProvider();
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./providers/anthropic');
      return new AnthropicProvider();
    }
    case 'gemini': {
      const { GeminiProvider } = await import('./providers/gemini');
      return new GeminiProvider();
    }
    case 'openrouter': {
      const { OpenRouterProvider } = await import('./providers/openrouter');
      return new OpenRouterProvider();
    }
  }
}

// ─── Main init wizard ────────────────────────────────────────────────────────

export async function runInitWizard(): Promise<void> {
  const cwd = process.cwd();

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ Verfix Setup Wizard'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log('');

  // ── Step 1: Check Docker ──
  const dockerSpinner = ora('Checking Docker...').start();
  if (!isDockerRunning()) {
    dockerSpinner.fail('Docker is not running. Start Docker Desktop and re-run verfix init.');
    process.exit(1);
  }
  dockerSpinner.succeed('Docker is running');
  console.log('');

  // ── Step 2: Provider-Aware AI Config ──
  const aiConfig = await runProviderFlow(cwd);

  let aiApiKey = '';
  let aiModel = '';
  let aiProvider: ProviderId | undefined;

  if (aiConfig) {
    aiProvider = aiConfig.provider;
    aiApiKey = aiConfig.apiKey;
    aiModel = aiConfig.model;

    // Persist to .verfix/.env
    saveAIConfig(cwd, aiProvider, aiModel, aiApiKey);
    console.log(chalk.green('  ✓ AI configuration saved'));
  }

  // ── Step 3: Pull + Start Runtime ──
  console.log('');
  const state = getContainerState();
  if (state?.status === 'running') {
    syncRuntimePortsFromContainer();
    console.log(chalk.green('  ✓ Verfix runtime is already running'));
  } else {
    const pullSpinner = ora('Pulling verfix runtime (this takes ~2 min on first run)...').start();
    try {
      pullImage();
      pullSpinner.succeed('Image pulled');
    } catch (e: any) {
      pullSpinner.fail(`Failed to pull image: ${e.message}`);
      process.exit(1);
    }

    const startSpinner = ora('Starting runtime...').start();
    try {
      await startContainer({ aiApiKey, aiModel, aiProvider });
      startSpinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        startSpinner.fail('Runtime started but health check failed after 30s');
        process.exit(1);
      }
      startSpinner.succeed('Runtime started and healthy');
    } catch (e: any) {
      startSpinner.fail(`Failed to start runtime: ${e.message}`);
      process.exit(1);
    }
  }

  // ── Step 4: Detect or ask base URL ──
  let baseUrl = 'http://localhost:3000';
  const detectedPort = await detectAppPort();
  if (detectedPort) {
    const useDetected = await confirm({
      message: `Detected your app on http://localhost:${detectedPort}. Is this correct?`,
      default: true,
    });
    if (useDetected) {
      baseUrl = `http://localhost:${detectedPort}`;
    } else {
      baseUrl = await input({ message: 'What URL is your app running on?', default: baseUrl });
    }
  } else {
    baseUrl = await input({ message: 'What URL is your app running on?', default: baseUrl });
  }

  // ── Step 5: Select mode ──
  const mode = await select({
    message: 'Verification mode (Preferred)',
    choices: [
      { name: 'Assisted — deterministic with AI fallback (recommended)', value: 'assisted' },
      { name: 'Strict — fully deterministic, best for CI', value: 'strict' },
      { name: 'Exploratory — natural language tasks', value: 'exploratory' },
    ],
    default: 'assisted',
  });

  // ── Step 6: Write verfix.config.json ──
  const configPath = path.join(cwd, DEFAULT_CONFIG);
  let writeConfig = true;

  if (fs.existsSync(configPath)) {
    writeConfig = await confirm({
      message: 'verfix.config.json already exists. Overwrite?',
      default: false,
    });
  }

  if (writeConfig) {
    const config: Record<string, unknown> = { baseUrl, mode, flows: [] };
    if (aiProvider && aiModel) {
      config.ai = { provider: aiProvider, model: aiModel };
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`  ✓ verfix.config.json created`));
  } else {
    // If config exists, update just the ai block without overwriting flows
    if (aiProvider && aiModel && fs.existsSync(configPath)) {
      updateAIConfigInFile(configPath, aiProvider, aiModel);
      console.log(chalk.green(`  ✓ verfix.config.json ai block updated`));
    } else {
      console.log(chalk.gray('  ⏭ Keeping existing verfix.config.json'));
    }
  }

  // ── Step 7: Write/update AGENTS.md ──
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const flowSummaries: { id: string }[] = [];
  const runtimePorts = getRuntimePorts();
  const verfixSection = generateAgentsSection(flowSummaries, mode, baseUrl, runtimePorts);

  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, verfixSection + '\n', 'utf-8');
    console.log(chalk.green('  ✓ AGENTS.md created'));
  } else {
    const existing = fs.readFileSync(agentsPath, 'utf-8');
    const sectionRegex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;

    if (sectionRegex.test(existing)) {
      const updateIt = await confirm({
        message: 'AGENTS.md already has a Verfix section. Update it?',
        default: true,
      });
      if (updateIt) {
        const updated = existing.replace(sectionRegex, verfixSection);
        fs.writeFileSync(agentsPath, updated, 'utf-8');
        console.log(chalk.green('  ✓ AGENTS.md Verfix section updated'));
      } else {
        console.log(chalk.gray('  ⏭ Keeping existing AGENTS.md'));
      }
    } else {
      const appendIt = await confirm({
        message: 'AGENTS.md exists. Append Verfix section to it?',
        default: true,
      });
      if (appendIt) {
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
        console.log(chalk.green('  ✓ AGENTS.md updated (Verfix section appended)'));
      } else {
        console.log(chalk.gray('  ⏭ Skipping AGENTS.md'));
      }
    }
  }

  // ── Step 8: Platform-specific agent files ──
  const detectedPlatforms = detectAllAgentPlatforms(cwd);

  const platformChoices = [
    {
      name: 'Cursor (.cursorrules)',
      value: 'cursor' as const,
      checked: detectedPlatforms.includes('cursor'),
    },
    {
      name: 'Claude (CLAUDE.md)',
      value: 'claude' as const,
      checked: detectedPlatforms.includes('claude'),
    },
    {
      name: 'Codex / OpenAI (CODEX.md)',
      value: 'codex' as const,
      checked: detectedPlatforms.includes('codex'),
    },
  ];

  console.log(chalk.gray('  ℹ AGENTS.md is always written as the default. Select agents below for'));
  console.log(chalk.gray('    additional platform-specific files (.cursorrules, CLAUDE.md, CODEX.md).'));
  console.log(chalk.gray('    Press Enter with nothing selected to use AGENTS.md only.'));
  console.log('');

  const detectedLabel = detectedPlatforms.length > 0
    ? ` — detected: ${detectedPlatforms.join(', ')}`
    : '';

  const selectedPlatforms = await checkbox({
    message: `Coding agents to configure${detectedLabel} (space to toggle, Enter to confirm):`,
    choices: platformChoices,
  });

  const updatedPlatformFiles: string[] = [];

  for (const platform of selectedPlatforms) {
    const platformPath = getAgentFilePath(platform, cwd);
    const platformFileName = path.basename(platformPath);
    let platformContent = '';

    if (platform === 'cursor') {
      platformContent = generateCursorRules(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'claude') {
      platformContent = generateClaudeSection(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'codex') {
      platformContent = generateCodexInstructions(flowSummaries, mode, baseUrl, runtimePorts);
    }

    if (!platformContent) continue;

    if (!fs.existsSync(platformPath)) {
      fs.writeFileSync(platformPath, platformContent + '\n', 'utf-8');
      console.log(chalk.green(`  ✓ ${platformFileName} created`));
      updatedPlatformFiles.push(platformFileName);
    } else {
      const existingPlatform = fs.readFileSync(platformPath, 'utf-8');
      const hasVerfixSection = existingPlatform.includes('Verfix') || existingPlatform.includes('project that uses Verfix');

      if (hasVerfixSection) {
        const updatePlatform = await confirm({
          message: `${platformFileName} already references Verfix. Update it?`,
          default: true,
        });
        if (!updatePlatform) {
          console.log(chalk.gray(`  ⏭ Keeping existing ${platformFileName}`));
          continue;
        }
      } else {
        const appendPlatform = await confirm({
          message: `${platformFileName} exists. Append Verfix section to it?`,
          default: true,
        });
        if (!appendPlatform) {
          console.log(chalk.gray(`  ⏭ Skipping ${platformFileName}`));
          continue;
        }
      }

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
      updatedPlatformFiles.push(platformFileName);
    }
  }

  // ── Step 9: README.md ──
  const readmePath = path.join(cwd, 'README.md');
  const README_VERFIX_ANCHOR = '<!-- verfix -->';
  let readmeUpdated = false;

  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    const hasVerfixAnchor = readmeContent.includes(README_VERFIX_ANCHOR);

    if (hasVerfixAnchor) {
      const updateReadme = await confirm({
        message: 'README.md already has a Verfix section. Update it?',
        default: true,
      });
      if (updateReadme) {
        const verfixReadmeSection = buildReadmeSection(README_VERFIX_ANCHOR);
        const regex = new RegExp(`${README_VERFIX_ANCHOR}[\\s\\S]*?(?=\\n## |$)`);
        const updated = regex.test(readmeContent)
          ? readmeContent.replace(regex, verfixReadmeSection.trim())
          : readmeContent + '\n' + verfixReadmeSection.trim() + '\n';
        fs.writeFileSync(readmePath, updated, 'utf-8');
        console.log(chalk.green('  ✓ README.md updated'));
        readmeUpdated = true;
      } else {
        console.log(chalk.gray('  ⏭ Keeping existing README.md'));
      }
    } else {
      const addToReadme = await confirm({
        message: 'Add a Verfix section to README.md?',
        default: false,
      });
      if (addToReadme) {
        const verfixReadmeSection = buildReadmeSection(README_VERFIX_ANCHOR);
        const separator = readmeContent.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(readmePath, readmeContent + separator + verfixReadmeSection.trim() + '\n', 'utf-8');
        console.log(chalk.green('  ✓ README.md updated'));
        readmeUpdated = true;
      }
    }
  }

  // ── Summary ──
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  console.log(chalk.green('  ✓ Runtime started'));
  if (aiProvider) {
    console.log(chalk.green(`  ✓ AI configured: ${PROVIDER_REGISTRY[aiProvider].displayName} / ${aiModel}`));
  }
  if (writeConfig) console.log(chalk.green('  ✓ verfix.config.json created'));
  console.log(chalk.green('  ✓ AGENTS.md updated'));
  for (const f of updatedPlatformFiles) {
    console.log(chalk.green(`  ✓ ${f} updated`));
  }
  if (readmeUpdated) {
    console.log(chalk.green('  ✓ README.md updated'));
  }
  console.log('');
  console.log(chalk.bold('  Next step — add your first flow:'));
  console.log(`    Edit ${chalk.cyan('verfix.config.json')} and add a flow to the ${chalk.cyan('flows')} array`);
  console.log(`    Then run: ${chalk.cyan('verfix run --flow <id> --output json')}`);
  console.log('');
  console.log(`  Dashboard: ${chalk.cyan(`http://localhost:${runtimePorts.dashboardPort}`)}`);
  console.log(`  Docs:      ${chalk.cyan('https://verfix.dev/docs')}`);
  console.log('');
}
