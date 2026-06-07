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
