import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, checkbox, confirm, password } from '@inquirer/prompts';
import {
  DEFAULT_CONFIG, getRunnerMode,
} from './constants';
import {
  generateAgentsSection,
  generateAgentsStub,
} from './agents-md';
import { detectAllAgentPlatforms, getAgentFilePath } from './agent-platform';
import { writeVerfixInstructions } from './agent-writer';
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
      console.log(chalk.gray(`    Detected provider from legacy config: ${chalk.bold(legacy.provider)}`));
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
    console.log(chalk.gray(`  ℹ OpenRouter supports any model. Enter the model ID (e.g. openrouter/auto)`));
    console.log('');
    model = await input({
      message: 'Model ID',
      default: 'openrouter/auto',
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
  const runnerMode = getRunnerMode();

  console.log('');
  console.log(chalk.bold.cyan('  ⚡ Verfix Setup Wizard'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log('');


  // ── Step 1: Detect or ask base URL ──
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

  // ── Step 2: Select mode ──
  const mode = await select({
    message: 'Verification mode',
    choices: [
      { name: 'Strict — fully deterministic, no AI key needed (recommended)', value: 'strict' },
      { name: 'Assisted — deterministic with AI fallback', value: 'assisted' },
      { name: 'Exploratory — natural language tasks', value: 'exploratory' },
    ],
    default: 'strict',
  });

  // ── Step 3: Provider-Aware AI Config (only modes that use AI) ──
  let aiConfig: { provider: ProviderId; model: string; apiKey: string } | null = null;
  if (mode !== 'strict') {
    aiConfig = await runProviderFlow(cwd);
  } else {
    console.log(chalk.gray('  ⏭ Strict mode is fully deterministic — no AI key needed'));
    console.log('');
  }

  let aiApiKey = '';
  let aiModel = '';
  let aiProvider: ProviderId | undefined;
  if (aiConfig) {
    aiProvider = aiConfig.provider;
    aiApiKey = aiConfig.apiKey;
    aiModel = aiConfig.model;
  }

  // browserChannel is set when the user opts to reuse an installed Chrome/Edge
  // instead of the bundled Chromium; persisted to config.browser.channel below.
  let browserChannel: string | undefined;

  if (runnerMode === 'local') {
    // ── Step 4 (local): persist AI config + make sure a browser exists ──
    // No Docker, no runtime container — verifications run in-process.
    if (aiConfig) {
      saveAIConfig(cwd, aiConfig.provider, aiConfig.model, aiConfig.apiKey);
      console.log(chalk.green('  ✓ AI configuration saved'));
    }

    const { isChromiumInstalled, ensureChromium, detectInstalledBrowser } = await import('./local-runner');
    if (isChromiumInstalled()) {
      console.log(chalk.green('  ✓ Chromium ready'));
    } else {
      const detected = detectInstalledBrowser();
      if (detected) {
        // Offer the installed browser — but make the determinism tradeoff explicit
        // so the choice is informed. Chromium stays the default (opt-in to Chrome).
        console.log(chalk.gray(`  ℹ Found ${detected.displayName} at ${detected.path}`));
        console.log(chalk.gray('    The bundled Chromium is recommended for reliable verification (pinned version,'));
        console.log(chalk.gray('    no policies/extensions). Chrome/Edge work for quick local checks but can vary'));
        console.log(chalk.gray('    by version/policy and are less deterministic — prefer Chromium for CI.'));
        const useInstalled = await confirm({
          message: `Use ${detected.displayName} instead of downloading Chromium? (saves ~130MB)`,
          default: false,
        });
        if (useInstalled) {
          browserChannel = detected.channel;
          console.log(chalk.green(`  ✓ Using ${detected.displayName} (browser.channel: "${detected.channel}")`));
        } else {
          try {
            await ensureChromium();
            console.log(chalk.green('  ✓ Chromium installed'));
          } catch (e: any) {
            console.log(chalk.yellow(`  ⚠ ${e.message}`));
          }
        }
      } else {
        const download = await confirm({
          message: 'Download Chromium for verification runs now? (~130MB, one-time, cached in ~/.cache/ms-playwright)',
          default: true,
        });
        if (download) {
          try {
            await ensureChromium();
            console.log(chalk.green('  ✓ Chromium installed'));
          } catch (e: any) {
            console.log(chalk.yellow(`  ⚠ ${e.message}`));
          }
        } else {
          console.log(chalk.gray('  ⏭ Skipped — verfix run downloads it on first use'));
        }
      }
    }
  } else {
    await runServerRuntimeSetup(cwd, aiConfig);
  }

  // ── Step 7: Write verfix.config.json ──
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
    if (browserChannel) {
      config.browser = { channel: browserChannel };
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

  // ── Step 8: Write .verfix/INSTRUCTIONS.md (full reference) + AGENTS.md stub ──
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const flowSummaries: { id: string }[] = [];
  const verfixSection = generateAgentsSection(flowSummaries, mode, baseUrl);
  const verfixStub = generateAgentsStub();

  // The full reference always goes to the file Verfix owns.
  writeVerfixInstructions(cwd, verfixSection);
  console.log(chalk.green('  ✓ .verfix/INSTRUCTIONS.md created'));

  // AGENTS.md carries only the short stub pointing at the reference file.
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, verfixStub + '\n', 'utf-8');
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
        const updated = existing.replace(sectionRegex, verfixStub.trimEnd());
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
        fs.writeFileSync(agentsPath, existing + separator + verfixStub + '\n', 'utf-8');
        console.log(chalk.green('  ✓ AGENTS.md updated (Verfix section appended)'));
      } else {
        console.log(chalk.gray('  ⏭ Skipping AGENTS.md'));
      }
    }
  }

  // ── Step 9: Platform-specific agent files ──
  // AGENTS.md (written above) is the universal standard read by Codex, Cursor,
  // Copilot coding agent, Kilo, opencode, Zed, Jules, and 20+ others. The files
  // below are only for tools that don't read AGENTS.md natively.
  const detectedPlatforms = detectAllAgentPlatforms(cwd);

  const platformChoices = [
    {
      name: 'Claude Code (CLAUDE.md)',
      value: 'claude' as const,
      checked: detectedPlatforms.includes('claude'),
    },
    {
      name: 'GitHub Copilot IDE (.github/copilot-instructions.md)',
      value: 'copilot' as const,
      checked: detectedPlatforms.includes('copilot'),
    },
    {
      name: 'Cline (.clinerules/verfix.md)',
      value: 'cline' as const,
      checked: detectedPlatforms.includes('cline'),
    },
  ];

  console.log(chalk.gray('  ℹ AGENTS.md is always written and is read natively by most agents'));
  console.log(chalk.gray('    (Codex, Cursor, Copilot, Kilo, opencode, Zed, Jules, …). Select below'));
  console.log(chalk.gray('    only for tools that need their own file. Press Enter to skip.'));
  console.log('');

  const detectedLabel = detectedPlatforms.length > 0
    ? ` — detected: ${detectedPlatforms.join(', ')}`
    : '';

  const selectedPlatforms = await checkbox({
    message: `Extra agent files to write${detectedLabel} (space to toggle, Enter to confirm):`,
    choices: platformChoices,
  });

  const updatedPlatformFiles: string[] = [];
  const platformStub = generateAgentsStub();

  for (const platform of selectedPlatforms) {
    const platformPath = getAgentFilePath(platform, cwd);
    const platformFileName = path.basename(platformPath);

    // Copilot / Cline live in subdirectories that may not exist yet.
    fs.mkdirSync(path.dirname(platformPath), { recursive: true });

    if (!fs.existsSync(platformPath)) {
      fs.writeFileSync(platformPath, platformStub + '\n', 'utf-8');
      console.log(chalk.green(`  ✓ ${platformFileName} created`));
      updatedPlatformFiles.push(platformFileName);
    } else {
      const existingPlatform = fs.readFileSync(platformPath, 'utf-8');
      const hasVerfixSection = existingPlatform.includes('Verfix — Browser Verification');

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

      const regex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;
      if (regex.test(existingPlatform)) {
        fs.writeFileSync(platformPath, existingPlatform.replace(regex, platformStub.trimEnd()), 'utf-8');
      } else {
        const separator = existingPlatform.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(platformPath, existingPlatform + separator + platformStub + '\n', 'utf-8');
      }
      console.log(chalk.green(`  ✓ ${platformFileName} updated`));
      updatedPlatformFiles.push(platformFileName);
    }
  }

  // ── Step 10: README.md ──
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
  if (runnerMode === 'server') {
    console.log(chalk.green('  ✓ Runtime started'));
  }
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
  if (runnerMode === 'server') {
    console.log(`  Dashboard: ${chalk.cyan(`http://localhost:${getRuntimePorts().dashboardPort}`)}`);
  } else {
    console.log(`  Traces:    ${chalk.cyan('verfix show <execution_id>')} ${chalk.gray('after a run')}`);
  }
  console.log(`  Docs:      ${chalk.cyan('https://verfix.dev/docs')}`);
  console.log('');
}

/**
 * Server-mode init (--server / VERFIX_RUNNER=server): today's Docker runtime
 * flow — check Docker, pull the image, start the container.
 */
async function runServerRuntimeSetup(
  cwd: string,
  aiConfig: { provider: ProviderId; model: string; apiKey: string } | null,
): Promise<void> {
  // ── Check Docker ──
  const dockerSpinner = ora('Checking Docker...').start();
  if (!isDockerRunning()) {
    dockerSpinner.fail('Docker is not running. Start Docker Desktop and re-run verfix init.');
    throw new Error('Docker is not running');
  }
  dockerSpinner.succeed('Docker is running');
  console.log('');

  if (aiConfig) {
    // Persist to .verfix/.env
    saveAIConfig(cwd, aiConfig.provider, aiConfig.model, aiConfig.apiKey);
    console.log(chalk.green('  ✓ AI configuration saved'));
  }

  // ── Pull + Start Runtime ──
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
      throw new Error(`Failed to pull image: ${e.message}`);
    }

    const startSpinner = ora('Starting runtime...').start();
    try {
      await startContainer({
        aiApiKey: aiConfig?.apiKey ?? '',
        aiModel: aiConfig?.model ?? '',
        aiProvider: aiConfig?.provider,
      });
      startSpinner.text = 'Waiting for health check...';
      const healthy = await waitForHealth();
      if (!healthy) {
        startSpinner.fail('Runtime started but health check failed after 30s');
        throw new Error('Runtime started but health check failed');
      }
      startSpinner.succeed('Runtime started and healthy');
    } catch (e: any) {
      startSpinner.fail(`Failed to start runtime: ${e.message}`);
      throw new Error(`Failed to start runtime: ${e.message}`);
    }
  }
}
