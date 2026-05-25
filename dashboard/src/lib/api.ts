'use client';

/**
 * Derive API base from the dashboard origin so custom runtime ports keep
 * working without requiring extra dashboard configuration.
 */
export function getApiBase(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3611';
  }

  const { protocol, hostname, port } = window.location;
  const defaultPort = protocol === 'https:' ? 443 : 80;
  const dashboardPort = Number.parseInt(port || String(defaultPort), 10);
  const apiPort = Number.isFinite(dashboardPort) ? dashboardPort + 1 : 3611;

  return `${protocol}//${hostname}:${apiPort}`;
}
