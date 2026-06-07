import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import {
  DOCKER_IMAGE, CONTAINER_NAME, DEFAULT_CONFIG,
  AI_MODELS, SCAFFOLD_FLOWS,
} from './constants';
import {
  generateAgentsSection,
  generateCursorRules,
  generateClaudeSection,
  generateCodexInstructions,
} from './agents-md';
import { detectAgentPlatform, getAgentFilePath } from './agent-platform';
import {
  isDockerRunning, pullImage, startContainer, getContainerState, syncRuntimePortsFromContainer,
} from './docker';
import { waitForHealth } from './health';
import axios from 'axios';
import net from 'net';
import { getRuntimePorts } from './runtime';

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

  // ── Step 2: Collect env vars ──
  // Always prompt during init so the user can update keys even if .verfix/.env exists.
  const existingKey = process.env.AI_API_KEY || '';
  const existingModel = process.env.AI_MODEL || '';

  let aiApiKey = await input({
    message: existingKey
      ? 'AI API key (press Enter to keep existing)'
      : 'AI API key for Assisted/Exploratory mode (optional, press Enter to skip)',
    default: existingKey,
  });

  let aiModel = existingModel;

  if (aiApiKey && aiApiKey !== existingKey) {
    // Key changed — reset model so user picks again
    aiModel = '';
  }

  if (aiApiKey && !aiModel) {
    const modelChoice = await select({
      message: 'AI model to use',
      choices: AI_MODELS,
      default: 'gpt-5.5',
    });

    if (modelChoice === '__custom__') {
      aiModel = await input({ message: 'Enter custom model name', default: 'gpt-4o-mini' });
    } else {
      aiModel = modelChoice;
    }
  }

  // Write .verfix/.env if keys provided
  if (aiApiKey) {
    const envDir = path.join(cwd, '.verfix');
    if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
    const envContent = [
      `AI_API_KEY=${aiApiKey}`,
      aiModel ? `AI_MODEL=${aiModel}` : '',
    ].filter(Boolean).join('\n') + '\n';
    fs.writeFileSync(path.join(envDir, '.env'), envContent, 'utf-8');
  }

  // ── Step 3: Pull + Start Runtime ──
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
      await startContainer({ aiApiKey, aiModel });
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

  // ── Step 6: Select flows to scaffold ──
  const flowChoices = [
    { name: 'login', value: 'login', checked: true },
    { name: 'dashboard-load', value: 'dashboard-load', checked: true },
    { name: 'signup', value: 'signup', checked: false },
    { name: 'checkout', value: 'checkout', checked: false },
    { name: 'custom', value: '__custom__', checked: false },
  ];

  const selectedFlowIds = await checkbox({
    message: 'Which flows do you want to scaffold?',
    choices: flowChoices,
  });

  // Handle custom flow
  const flowIds = [...selectedFlowIds];
  if (flowIds.includes('__custom__')) {
    const customName = await input({ message: 'Custom flow name (e.g. profile-edit)', default: 'custom-flow' });
    flowIds.splice(flowIds.indexOf('__custom__'), 1, customName);
  }

  // Build flows array
  const flows = flowIds.map(id => {
    const scaffold = SCAFFOLD_FLOWS[id];
    if (scaffold) {
      return { id, ...scaffold };
    }
    // Custom or unknown flow — minimal scaffold
    return {
      id,
      steps: [{ action: 'navigate', url: `/${id}` }],
      assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }],
    };
  });

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
    const config = { baseUrl, mode, flows };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`  ✓ verfix.config.json created`));
  } else {
    console.log(chalk.gray('  ⏭ Keeping existing verfix.config.json'));
  }

  // ── Step 7.5: Inject npm scripts ──
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkg.scripts = pkg.scripts || {};
      
      const hasVerify = 'verify' in pkg.scripts;
      const hasVerifyAll = 'verify:all' in pkg.scripts;
      
      if (!hasVerify || !hasVerifyAll) {
        const injectScripts = await confirm({
          message: 'Add Verfix scripts (verify, verify:all) to package.json?',
          default: true,
        });

        if (injectScripts) {
          let updated = false;
          if (!hasVerify) {
            pkg.scripts.verify = 'verfix run --output json';
            updated = true;
          }
          if (!hasVerifyAll) {
            pkg.scripts['verify:all'] = 'verfix run --output json';
            updated = true;
          }
          if (updated) {
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
            console.log(chalk.green('  ✓ package.json scripts added'));
          }
        }
      } else {
        console.log(chalk.gray('  ⏭ package.json already contains verify scripts'));
      }
    } catch (e: any) {
      console.log(chalk.yellow(`  ⚠ Could not parse package.json: ${e.message}`));
    }
  }

  // ── Step 8: Write/update AGENTS.md ──
  const agentsPath = path.join(cwd, 'AGENTS.md');
  const flowSummaries = flows.map(f => ({ id: f.id }));
  const runtimePorts = getRuntimePorts();
  const verfixSection = generateAgentsSection(flowSummaries, mode, baseUrl, runtimePorts);

  if (!fs.existsSync(agentsPath)) {
    // Create fresh
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
      // Append section
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
      console.log(chalk.green('  ✓ AGENTS.md updated (Verfix section appended)'));
    }
  }

  // ── Step 8.5: Write/update platform-specific agent file ──
  const platform = detectAgentPlatform(cwd);
  let platformFileUpdated = false;
  let platformFileName = '';

  if (platform !== 'generic') {
    const platformPath = getAgentFilePath(platform, cwd);
    platformFileName = path.basename(platformPath);
    let platformContent = '';

    if (platform === 'cursor') {
      platformContent = generateCursorRules(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'claude') {
      platformContent = generateClaudeSection(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'codex') {
      platformContent = generateCodexInstructions(flowSummaries, mode, baseUrl, runtimePorts);
    }

    if (platformContent) {
      if (!fs.existsSync(platformPath)) {
        fs.writeFileSync(platformPath, platformContent + '\n', 'utf-8');
        console.log(chalk.green(`  ✓ ${platformFileName} created`));
        platformFileUpdated = true;
      } else {
        const existingPlatform = fs.readFileSync(platformPath, 'utf-8');
        const hasVerfix = existingPlatform.includes('Verfix') || existingPlatform.includes('project that uses Verfix');

        let updatePlatform = true;
        if (hasVerfix) {
          updatePlatform = await confirm({
            message: `${platformFileName} already references Verfix. Update/Overwrite it?`,
            default: true,
          });
        }

        if (updatePlatform) {
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
          platformFileUpdated = true;
        } else {
          console.log(chalk.gray(`  ⏭ Keeping existing ${platformFileName}`));
        }
      }
    }
  }

  // ── Step 8.7: Write/update README.md ──
  const readmePath = path.join(cwd, 'README.md');
  let readmeUpdated = false;
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    const hasVerfixSection = readmeContent.includes('## Verification') || readmeContent.includes('Verfix');
    
    let updateReadme = true;
    if (hasVerfixSection) {
      updateReadme = await confirm({
        message: 'README.md already references Verfix. Update/Overwrite it?',
        default: false,
      });
    } else {
      updateReadme = await confirm({
        message: 'Add Verfix Verification section to README.md?',
        default: true,
      });
    }

    if (updateReadme) {
      const verfixReadmeSection = `
## Verification

This project uses [Verfix](https://verfix.dev) for browser verification.

\`\`\`bash
npx verfix run --flow <flow-id> --output json
\`\`\`

See [AGENTS.md](./AGENTS.md) for full verification documentation.
`;

      if (hasVerfixSection) {
        const regex = /## Verification[\s\S]*?(?=\n## |$)/;
        if (regex.test(readmeContent)) {
          const updated = readmeContent.replace(regex, verfixReadmeSection.trim());
          fs.writeFileSync(readmePath, updated, 'utf-8');
        } else {
          const separator = readmeContent.endsWith('\n') ? '\n' : '\n\n';
          fs.writeFileSync(readmePath, readmeContent + separator + verfixReadmeSection.trim() + '\n', 'utf-8');
        }
      } else {
        const separator = readmeContent.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(readmePath, readmeContent + separator + verfixReadmeSection.trim() + '\n', 'utf-8');
      }
      console.log(chalk.green('  ✓ README.md updated'));
      readmeUpdated = true;
    }
  }

  // ── Step 9: Print summary ──
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  console.log(chalk.green('  ✓ Runtime started'));
  if (writeConfig) console.log(chalk.green('  ✓ verfix.config.json created'));
  console.log(chalk.green('  ✓ AGENTS.md updated'));
  if (platform !== 'generic' && platformFileUpdated) {
    console.log(chalk.green(`  ✓ ${platformFileName} updated`));
  }
  if (readmeUpdated) {
    console.log(chalk.green('  ✓ README.md updated'));
  }
  console.log('');
  console.log(chalk.bold('  Your flows:'));
  for (const f of flows) {
    console.log(`    verfix run --flow ${f.id} --output json`);
  }
  console.log('');
  console.log(`  Dashboard: ${chalk.cyan(`http://localhost:${runtimePorts.dashboardPort}`)}`);
  console.log(`  Docs:      ${chalk.cyan('https://verfix.dev/docs')}`);
  console.log('');
}
