// ─── Docker helpers ──────────────────────────────────────────────────────────
// All Docker operations use child_process with stdio: 'pipe' and explicit
// error handling. No silent error swallowing.

import { execSync, spawnSync } from 'child_process';
import os from 'os';
import {
  DOCKER_IMAGE,
  CONTAINER_NAME,
  VOLUMES,
} from './constants';
import { getRuntimePorts, resolveAvailableRuntimePorts, saveRuntimePorts, type RuntimePorts } from './runtime';

/**
 * On Linux, Docker containers can use --network=host to share the host's
 * network namespace. This means localhost inside the container resolves to
 * the same loopback as the host — including IPv6 (::1) bound services.
 *
 * Docker Desktop on Mac/Windows runs containers in a Linux VM, so
 * --network=host only reaches the VM's network, not the actual host.
 * We use host.docker.internal (bridge mode) there instead.
 */
export function isHostNetworkMode(): boolean {
  return os.platform() === 'linux';
}

export interface DockerRunOptions {
  aiApiKey?: string;
  aiModel?: string;
  /** Provider ID — used to pass provider-specific env var to container */
  aiProvider?: string;
}

/**
 * Run a docker command synchronously with stdio piped.
 * Returns the result object — caller decides what to do with errors.
 */
export function dockerExec(args: string) {
  return spawnSync('docker', args.split(/\s+/), {
    stdio: 'pipe',
  });
}

/**
 * Run a docker command and return stdout as string.
 * Throws with a descriptive message on failure.
 */
export function dockerExecOrThrow(args: string, errorMessage?: string): string {
  const result = spawnSync('docker', args.split(/\s+/), {
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || '';
    throw new Error(errorMessage || `Docker command failed: docker ${args}\n${stderr}`);
  }
  return result.stdout?.toString().trim() || '';
}

/**
 * Check if Docker is installed.
 */
export function isDockerInstalled(): boolean {
  const result = dockerExec('--version');
  return result.status === 0;
}

/**
 * Check if Docker daemon is running.
 */
export function isDockerRunning(): boolean {
  const result = dockerExec('info');
  return result.status === 0;
}

/**
 * Get the current state of the verfix container.
 * Returns null if not found.
 */
export function getContainerState(): { status: string; startedAt?: string; image?: string } | null {
  const result = spawnSync('docker', [
    'inspect',
    '--format',
    '{{.State.Status}}|{{.State.StartedAt}}|{{.Config.Image}}',
    CONTAINER_NAME,
  ], { stdio: 'pipe' });

  if (result.status !== 0) return null;

  const output = result.stdout?.toString().trim() || '';
  const parts = output.split('|');
  return {
    status: parts[0] || 'unknown',
    startedAt: parts[1],
    image: parts[2],
  };
}

/**
 * Read runtime ports from container env vars and persist them locally.
 * This keeps CLI output aligned even if the running container predates
 * local runtime.json or was started with non-default ports.
 */
export function syncRuntimePortsFromContainer(): RuntimePorts | null {
  const result = spawnSync('docker', [
    'inspect',
    '--format',
    '{{range .Config.Env}}{{println .}}{{end}}',
    CONTAINER_NAME,
  ], { stdio: 'pipe' });

  if (result.status !== 0) return null;

  const envLines = (result.stdout?.toString() || '').split('\n').map(s => s.trim()).filter(Boolean);
  const envMap = new Map<string, string>();
  for (const line of envLines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    envMap.set(line.slice(0, idx), line.slice(idx + 1));
  }

  const apiPort = Number.parseInt(envMap.get('API_PORT') || '', 10);
  const dashboardPort = Number.parseInt(envMap.get('DASHBOARD_PORT') || '', 10);

  if (!Number.isInteger(apiPort) || !Number.isInteger(dashboardPort)) {
    return null;
  }

  const ports = { apiPort, dashboardPort };
  saveRuntimePorts(ports);
  return ports;
}

/**
 * Start the verfix container. Handles:
 * - Already running: returns 'already_running'
 * - Exists but stopped: starts it, returns 'started'
 * - Doesn't exist: creates and starts it, returns 'created'
 */
export async function startContainer(opts?: DockerRunOptions): Promise<'already_running' | 'started' | 'created'> {
  const state = getContainerState();

  if (state) {
    if (state.status === 'running') {
      syncRuntimePortsFromContainer();
      // Container is running — if no new env vars, keep it as-is
      if (!opts?.aiApiKey && !opts?.aiModel) {
        return 'already_running';
      }
      // New env vars provided — stop and remove so we can recreate with them
      dockerExec(`stop ${CONTAINER_NAME}`);
      dockerExec(`rm ${CONTAINER_NAME}`);
    } else {
      // Exists but stopped — always remove and recreate.
      // Reusing a stopped container with `docker start` would keep whatever
      // network args it was created with (possibly wrong platform, old network
      // mode, or missing VERFIX_HOST_NETWORK). Recreating is always safe and
      // ensures --network=host (Linux) vs bridge (Mac/Windows) is correct.
      dockerExec(`rm ${CONTAINER_NAME}`);
    }
  }

  const preferredPorts = getRuntimePorts();
  const resolvedPorts = await resolveAvailableRuntimePorts(preferredPorts);
  saveRuntimePorts(resolvedPorts);

  // Create new container
  const envArgs: string[] = [];

  // Pass through AI config to the container.
  // New format: provider-specific env var + AI_PROVIDER + AI_MODEL
  // Legacy bridge: also pass AI_API_KEY for backward compat with older runtime images.
  const aiProvider = opts?.aiProvider || process.env.AI_PROVIDER;
  const aiModel = opts?.aiModel || process.env.AI_MODEL;

  // Map provider IDs to their env var names
  const providerKeyMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  let aiKey = opts?.aiApiKey;
  if (!aiKey && aiProvider && providerKeyMap[aiProvider]) {
    aiKey = process.env[providerKeyMap[aiProvider]];
  }
  if (!aiKey) {
    // Fall back to legacy generic key
    aiKey = process.env.AI_API_KEY;
  }

  if (aiProvider) envArgs.push('-e', `AI_PROVIDER=${aiProvider}`);
  if (aiKey) {
    // Pass provider-specific key if we know the provider
    if (aiProvider && providerKeyMap[aiProvider]) {
      envArgs.push('-e', `${providerKeyMap[aiProvider]}=${aiKey}`);
    }
    // Always pass legacy AI_API_KEY for backward compat with older runtime images
    envArgs.push('-e', `AI_API_KEY=${aiKey}`);
  }
  if (aiModel) envArgs.push('-e', `AI_MODEL=${aiModel}`);
  envArgs.push('-e', `API_PORT=${resolvedPorts.apiPort}`);
  envArgs.push('-e', `DASHBOARD_PORT=${resolvedPorts.dashboardPort}`);

  const hostNetwork = isHostNetworkMode();

  // Signal to workers inside the container whether they are on host network.
  // On host network: localhost == host's localhost, no URL rewriting needed.
  // On bridge network: must rewrite localhost → host.docker.internal.
  envArgs.push('-e', `VERFIX_HOST_NETWORK=${hostNetwork ? '1' : '0'}`);

  const networkArgs: string[] = hostNetwork
    ? [
        // ── Linux: share host network namespace ────────────────────────────
        // The container's localhost IS the host's localhost (IPv4 + IPv6).
        // No port mapping needed — services are directly on host ports.
        // No host.docker.internal needed — localhost works natively.
        '--network=host',
      ]
    : [
        // ── Mac / Windows Docker Desktop: bridge mode ──────────────────────
        // Docker runs in a VM so localhost doesn't reach the real host.
        // host.docker.internal is the stable alias that points to the host.
        '--add-host=host.docker.internal:host-gateway',
        '-p', `${resolvedPorts.apiPort}:${resolvedPorts.apiPort}`,
        '-p', `${resolvedPorts.dashboardPort}:${resolvedPorts.dashboardPort}`,
      ];

  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    ...networkArgs,
    '-v', VOLUMES.data,
    '-v', VOLUMES.artifacts,
    ...envArgs,
    DOCKER_IMAGE,
  ];

  const result = spawnSync('docker', args, { stdio: 'pipe' });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || '';
    if (stderr.includes('port is already allocated') || stderr.includes('address already in use')) {
      throw new Error(
        `Port conflict: ports ${resolvedPorts.apiPort} or ${resolvedPorts.dashboardPort} are already in use.\n` +
        `Stop whatever is using those ports, or use 'verfix stop' first.`
      );
    }
    if (stderr.includes('Conflict') && stderr.includes('name')) {
      throw new Error(
        `Container name conflict. Run 'docker rm ${CONTAINER_NAME}' first, or use 'verfix stop'.`
      );
    }
    throw new Error(`Failed to create container:\n${stderr}`);
  }

  return 'created';
}

/**
 * Stop and remove the verfix container.
 * Returns true if something was stopped, false if it wasn't running.
 */
export function stopContainer(): boolean {
  const state = getContainerState();
  if (!state) return false;

  if (state.status === 'running') {
    dockerExec(`stop ${CONTAINER_NAME}`);
  }
  dockerExec(`rm ${CONTAINER_NAME}`);
  return true;
}

/**
 * Pull the latest verfix image.
 */
export function pullImage(): void {
  const result = spawnSync('docker', ['pull', DOCKER_IMAGE], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to pull image: ${DOCKER_IMAGE}`);
  }
}

/**
 * Pull image if not already present locally.
 */
export function pullImageIfMissing(): boolean {
  const result = spawnSync('docker', ['image', 'inspect', DOCKER_IMAGE], {
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    pullImage();
    return true; // pulled
  }
  return false; // already present
}

/**
 * Get container logs.
 */
export function tailLogs(tail: number): void {
  const args = ['logs', '-f', '--tail', String(tail), CONTAINER_NAME];
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.status !== 0 && result.status !== null) {
    const stderr = result.stderr?.toString().trim() || '';
    if (stderr.includes('No such container')) {
      throw new Error(`Container '${CONTAINER_NAME}' is not running. Start it with 'verfix start'.`);
    }
    throw new Error(`Failed to get logs: ${stderr}`);
  }
}

/**
 * Calculate human-readable uptime from a StartedAt timestamp.
 */
export function formatUptime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  if (diffMs < 0) return 'just started';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
