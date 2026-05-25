import fs from 'fs';
import path from 'path';
import net from 'net';

const VERFIX_DIR = '.verfix';
const RUNTIME_FILE = 'runtime.json';

export const DEFAULT_DASHBOARD_PORT = 3610;
export const DEFAULT_API_PORT = 3611;

export interface RuntimePorts {
  dashboardPort: number;
  apiPort: number;
}

function getRuntimePath(cwd = process.cwd()): string {
  return path.join(cwd, VERFIX_DIR, RUNTIME_FILE);
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

export function getDefaultRuntimePorts(): RuntimePorts {
  return {
    dashboardPort: DEFAULT_DASHBOARD_PORT,
    apiPort: DEFAULT_API_PORT,
  };
}

export function loadRuntimePorts(cwd = process.cwd()): RuntimePorts {
  const defaults = getDefaultRuntimePorts();
  const runtimePath = getRuntimePath(cwd);

  if (!fs.existsSync(runtimePath)) {
    return defaults;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as Partial<RuntimePorts>;
    if (!isValidPort(raw.dashboardPort) || !isValidPort(raw.apiPort)) {
      return defaults;
    }
    return {
      dashboardPort: raw.dashboardPort,
      apiPort: raw.apiPort,
    };
  } catch {
    return defaults;
  }
}

export function saveRuntimePorts(ports: RuntimePorts, cwd = process.cwd()): void {
  const runtimePath = getRuntimePath(cwd);
  const runtimeDir = path.dirname(runtimePath);
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }
  fs.writeFileSync(runtimePath, JSON.stringify(ports, null, 2) + '\n', 'utf-8');
}

export function getRuntimePorts(cwd = process.cwd()): RuntimePorts {
  const envApi = Number.parseInt(process.env.VERIFY_API_PORT || '', 10);
  const envDashboard = Number.parseInt(process.env.VERIFY_DASHBOARD_PORT || '', 10);

  if (isValidPort(envApi) && isValidPort(envDashboard)) {
    return { dashboardPort: envDashboard, apiPort: envApi };
  }

  return loadRuntimePorts(cwd);
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '0.0.0.0');
  });
}

/**
 * Reserve dashboard/api as a pair while preserving api = dashboard + 1.
 * If 3610/3611 are busy, the next attempt is 3612/3613, etc.
 */
export async function resolveAvailableRuntimePorts(preferred: RuntimePorts): Promise<RuntimePorts> {
  for (let offset = 0; offset <= 100; offset += 2) {
    const dashboardPort = preferred.dashboardPort + offset;
    const apiPort = preferred.apiPort + offset;

    const dashboardFree = await isPortAvailable(dashboardPort);
    const apiFree = await isPortAvailable(apiPort);

    if (dashboardFree && apiFree) {
      return { dashboardPort, apiPort };
    }
  }

  throw new Error('Could not find available ports for Verfix runtime');
}

export function buildApiBase(ports: RuntimePorts): string {
  return process.env.VERIFY_API || `http://localhost:${ports.apiPort}`;
}

export function buildDashboardBase(ports: RuntimePorts): string {
  return process.env.VERIFY_DASHBOARD || `http://localhost:${ports.dashboardPort}`;
}
