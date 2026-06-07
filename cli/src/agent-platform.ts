import fs from 'fs';
import path from 'path';

export type AgentPlatform = 'cursor' | 'claude' | 'codex' | 'generic';

export function detectAgentPlatform(cwd: string): AgentPlatform {
  if (fs.existsSync(path.join(cwd, '.cursor')) || fs.existsSync(path.join(cwd, '.cursorrules'))) {
    return 'cursor';
  }
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) {
    return 'claude';
  }
  if (fs.existsSync(path.join(cwd, 'CODEX.md'))) {
    return 'codex';
  }
  return 'generic';
}

/** Returns all platforms whose config files exist in the project directory. */
export function detectAllAgentPlatforms(cwd: string): Exclude<AgentPlatform, 'generic'>[] {
  const found: Exclude<AgentPlatform, 'generic'>[] = [];
  if (fs.existsSync(path.join(cwd, '.cursor')) || fs.existsSync(path.join(cwd, '.cursorrules'))) {
    found.push('cursor');
  }
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) {
    found.push('claude');
  }
  if (fs.existsSync(path.join(cwd, 'CODEX.md'))) {
    found.push('codex');
  }
  return found;
}

export function getAgentFilePath(platform: AgentPlatform, cwd: string): string {
  switch (platform) {
    case 'cursor':
      return path.join(cwd, '.cursorrules');
    case 'claude':
      return path.join(cwd, 'CLAUDE.md');
    case 'codex':
      return path.join(cwd, 'CODEX.md');
    case 'generic':
      return path.join(cwd, 'AGENTS.md');
  }
}
