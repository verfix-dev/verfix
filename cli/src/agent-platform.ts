import fs from 'fs';
import path from 'path';

// AGENTS.md is the universal standard (read by Codex, Cursor, Copilot coding
// agent, Kilo, opencode, Zed, Jules, and 20+ others) and is always written as
// `generic`. The platform entries below are only for tools that don't read
// AGENTS.md natively: Claude Code (CLAUDE.md), the GitHub Copilot IDE
// (.github/copilot-instructions.md), and Cline (.clinerules/).
export type AgentPlatform = 'claude' | 'copilot' | 'cline' | 'generic';

export function detectAgentPlatform(cwd: string): AgentPlatform {
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) {
    return 'claude';
  }
  if (fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md'))) {
    return 'copilot';
  }
  if (fs.existsSync(path.join(cwd, '.clinerules'))) {
    return 'cline';
  }
  return 'generic';
}

/** Returns all platforms whose config files exist in the project directory. */
export function detectAllAgentPlatforms(cwd: string): Exclude<AgentPlatform, 'generic'>[] {
  const found: Exclude<AgentPlatform, 'generic'>[] = [];
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md')) || fs.existsSync(path.join(cwd, '.claude'))) {
    found.push('claude');
  }
  if (fs.existsSync(path.join(cwd, '.github', 'copilot-instructions.md'))) {
    found.push('copilot');
  }
  if (fs.existsSync(path.join(cwd, '.clinerules'))) {
    found.push('cline');
  }
  return found;
}

export function getAgentFilePath(platform: AgentPlatform, cwd: string): string {
  switch (platform) {
    case 'claude':
      return path.join(cwd, 'CLAUDE.md');
    case 'copilot':
      return path.join(cwd, '.github', 'copilot-instructions.md');
    case 'cline':
      return path.join(cwd, '.clinerules', 'verfix.md');
    case 'generic':
      return path.join(cwd, 'AGENTS.md');
  }
}
