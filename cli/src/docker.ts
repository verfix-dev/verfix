// ─── Docker helpers ──────────────────────────────────────────────────────────
// All Docker operations use child_process with stdio: 'pipe' and explicit
// error handling. No silent error swallowing.

import { execSync, spawnSync } from 'child_process';
import {
  DOCKER_IMAGE,
  CONTAINER_NAME,
  API_PORT,
  DASHBOARD_PORT,
  VOLUMES,
} from './constants';

export interface DockerRunOptions {
  aiApiKey?: string;
  aiModel?: string;
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
 * Start the verfix container. Handles:
 * - Already running: returns 'already_running'
 * - Exists but stopped: starts it, returns 'started'
 * - Doesn't exist: creates and starts it, returns 'created'
 */
export function startContainer(opts?: DockerRunOptions): 'already_running' | 'started' | 'created' {
  const state = getContainerState();

  if (state) {
    if (state.status === 'running') {
      // Container is running — if no new env vars, keep it as-is
      if (!opts?.aiApiKey && !opts?.aiModel) {
        return 'already_running';
      }
      // New env vars provided — stop and remove so we can recreate with them
      dockerExec(`stop ${CONTAINER_NAME}`);
      dockerExec(`rm ${CONTAINER_NAME}`);
    } else {
      // Exists but stopped
      if (!opts?.aiApiKey && !opts?.aiModel) {
        // No env vars to inject — just start it
        const result = dockerExec(`start ${CONTAINER_NAME}`);
        if (result.status !== 0) {
          throw new Error(`Failed to start existing container: ${result.stderr?.toString()}`);
        }
        return 'started';
      }
      // Env vars provided — remove and recreate so they are injected properly
      dockerExec(`rm ${CONTAINER_NAME}`);
    }
  }

  // Create new container
  const envArgs: string[] = [];

  // Pass through host env vars if set, or use provided values
  const aiKey = opts?.aiApiKey || process.env.AI_API_KEY;
  const aiModel = opts?.aiModel || process.env.AI_MODEL;

  if (aiKey) envArgs.push('-e', `AI_API_KEY=${aiKey}`);
  if (aiModel) envArgs.push('-e', `AI_MODEL=${aiModel}`);

  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    '-p', `${API_PORT}:${API_PORT}`,
    '-p', `${DASHBOARD_PORT}:${DASHBOARD_PORT}`,
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
        `Port conflict: ports ${API_PORT} or ${DASHBOARD_PORT} are already in use.\n` +
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
