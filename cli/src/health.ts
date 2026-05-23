import axios from 'axios';
import { API_BASE, DASHBOARD_BASE, HEALTH_ENDPOINT } from './constants';

/**
 * Poll the API health endpoint until it returns 200 or we exhaust retries.
 */
export async function waitForHealth(maxRetries = 30, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axios.get(`${API_BASE}${HEALTH_ENDPOINT}`, { timeout: 2000 });
      if (res.status === 200) return true;
    } catch {
      // keep polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Check if the API is healthy right now (single attempt).
 */
export async function isApiHealthy(): Promise<boolean> {
  try {
    const res = await axios.get(`${API_BASE}${HEALTH_ENDPOINT}`, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Check if the dashboard is reachable right now (single attempt).
 */
export async function isDashboardReachable(): Promise<boolean> {
  try {
    const res = await axios.get(DASHBOARD_BASE, { timeout: 3000 });
    return res.status === 200;
  } catch {
    return false;
  }
}
