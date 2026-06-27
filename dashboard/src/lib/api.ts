'use client';

/**
 * Derive API base from the dashboard origin so custom runtime ports keep
 * working without requiring extra dashboard configuration.
 */
export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window === 'undefined') {
    return 'http://localhost:3611';
  }

  const { protocol, hostname, port } = window.location;
  const defaultPort = protocol === 'https:' ? 443 : 80;
  const dashboardPort = Number.parseInt(port || String(defaultPort), 10);
  const apiPort = (dashboardPort >= 3600 && dashboardPort < 4000) ? dashboardPort + 1 : 3611;

  return `${protocol}//${hostname}:${apiPort}`;
}
