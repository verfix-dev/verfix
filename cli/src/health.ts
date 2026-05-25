import axios from 'axios';
import { HEALTH_ENDPOINT } from './constants';
import { buildApiBase, buildDashboardBase, getRuntimePorts, saveRuntimePorts } from './runtime';

function uniquePorts(values: number[]): number[] {
  return Array.from(new Set(values.filter(v => Number.isInteger(v) && v > 0)));
}

async function isHealthyAtBase(base: string, timeout = 1200): Promise<boolean> {
  try {
    const res = await axios.get(`${base}${HEALTH_ENDPOINT}`, { timeout });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Resolve the best API base URL by probing current and legacy fallback ports.
 * Persists discovered port to .verfix/runtime.json when VERIFY_API is not set.
 */
export async function resolveApiBase(): Promise<string> {
  const runtime = getRuntimePorts();
  const configuredBase = buildApiBase(runtime);

  if (process.env.VERIFY_API) {
    return configuredBase;
  }

  const candidates = uniquePorts([
    runtime.apiPort,
    runtime.dashboardPort + 1,
    3611,
    3001,
  ]);

  for (const port of candidates) {
    const base = `http://localhost:${port}`;
    if (await isHealthyAtBase(base)) {
      if (port !== runtime.apiPort) {
        saveRuntimePorts({ ...runtime, apiPort: port });
      }
      return base;
    }
  }

  return configuredBase;
}

/**
 * Poll the API health endpoint until it returns 200 or we exhaust retries.
 */
export async function waitForHealth(maxRetries = 30, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const apiBase = await resolveApiBase();
    if (await isHealthyAtBase(apiBase, 2000)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Check if the API is healthy right now (single attempt).
 */
export async function isApiHealthy(): Promise<boolean> {
  const apiBase = await resolveApiBase();
  return isHealthyAtBase(apiBase, 3000);
}

/**
 * Check if the dashboard is reachable right now (single attempt).
 */
export async function isDashboardReachable(): Promise<boolean> {
  try {
    const dashboardBase = buildDashboardBase(getRuntimePorts());
    const res = await axios.get(dashboardBase, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
