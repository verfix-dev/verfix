import fs from 'fs';
import path from 'path';

// Framework-aware init (Roadmap Phase 5): a lookup table, not a plugin system.
// Detects a small set of well-known frameworks from package.json deps so
// `verfix init` can default the base URL and scaffold a flow that actually
// passes against a fresh starter project, instead of the generic
// SCAFFOLD_FLOWS placeholder that needs hand-editing before first success.

export interface ScaffoldFlow {
  id: string;
  name: string;
  steps: Array<Record<string, unknown>>;
  assertions: Array<Record<string, unknown>>;
}

export interface DetectedFramework {
  /** Human-readable name, used in wizard/CLI messaging (e.g. "Detected Next.js"). */
  name: string;
  /** Conventional dev-server URL for this framework. */
  defaultUrl: string;
  /** A flow that passes against the framework's default starter page. */
  scaffoldFlow: ScaffoldFlow;
}

/** A flow that just loads the root route and checks it rendered cleanly.
 *  Deliberately generic — no framework-specific text/selectors, since
 *  starter templates change copy across versions/flags. */
function homeLoadsFlow(): ScaffoldFlow {
  return {
    id: 'home-loads',
    name: 'Home page loads without errors',
    steps: [
      { action: 'navigate', url: '/' },
    ],
    assertions: [
      { type: 'page_loaded' },
      { type: 'no_console_errors' },
    ],
  };
}

// Keyed by the package.json dependency name that identifies the framework.
// Checked in this order — first match wins (relevant for setups that could
// carry both, e.g. a Next.js project with vite for a separate tool).
const FRAMEWORK_TABLE: Record<string, DetectedFramework> = {
  next: {
    name: 'Next.js',
    defaultUrl: 'http://localhost:3000',
    scaffoldFlow: homeLoadsFlow(),
  },
  vite: {
    name: 'Vite',
    defaultUrl: 'http://localhost:5173',
    scaffoldFlow: homeLoadsFlow(),
  },
};

/**
 * Detect a known framework from the project's package.json
 * dependencies/devDependencies. Returns null on any miss — missing/unreadable
 * package.json, or no known dependency — so callers fall back to exactly
 * today's behavior.
 */
export function detectFramework(dir: string): DetectedFramework | null {
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const key of Object.keys(FRAMEWORK_TABLE)) {
      if (deps[key]) return FRAMEWORK_TABLE[key];
    }
  } catch {
    // Malformed package.json etc. — detection is best-effort, never fatal.
    return null;
  }
  return null;
}
