import fs from 'fs';
import path from 'path';
import {
  generateCursorRules,
  generateClaudeSection,
  generateCodexInstructions,
} from './agents-md';
import { getAgentFilePath } from './agent-platform';
import { getRuntimePorts } from './runtime';

/**
 * Write or update AGENTS.md with Verfix agent instructions.
 */
export function writeAgentsMd(cwd: string, verfixSection: string): boolean {
  const agentsPath = path.join(cwd, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, verfixSection + '\n', 'utf-8');
    return true;
  }

  const existing = fs.readFileSync(agentsPath, 'utf-8');
  const sectionRegex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;

  if (sectionRegex.test(existing)) {
    const updated = existing.replace(sectionRegex, verfixSection);
    fs.writeFileSync(agentsPath, updated, 'utf-8');
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
  }
  return false; // indicates updated
}

/**
 * Write or update platform-specific files (.cursorrules, CLAUDE.md, CODEX.md).
 */
export function writePlatformAgentFiles(
  cwd: string,
  platforms: ('cursor' | 'claude' | 'codex')[],
  mode: string,
  baseUrl: string,
): string[] {
  const updatedFiles: string[] = [];
  const runtimePorts = getRuntimePorts();
  const flowSummaries: { id: string }[] = [];

  for (const platform of platforms) {
    const platformPath = getAgentFilePath(platform, cwd);
    const platformFileName = path.basename(platformPath);
    let platformContent = '';

    if (platform === 'cursor') {
      platformContent = generateCursorRules(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'claude') {
      platformContent = generateClaudeSection(flowSummaries, mode, baseUrl, runtimePorts);
    } else if (platform === 'codex') {
      platformContent = generateCodexInstructions(flowSummaries, mode, baseUrl, runtimePorts);
    }

    if (!platformContent) continue;

    if (!fs.existsSync(platformPath)) {
      fs.writeFileSync(platformPath, platformContent + '\n', 'utf-8');
      updatedFiles.push(platformFileName);
    } else {
      const existingPlatform = fs.readFileSync(platformPath, 'utf-8');

      if (platform === 'cursor') {
        const startMarker = 'You are working in a project that uses Verfix';
        if (existingPlatform.includes(startMarker)) {
          const index = existingPlatform.indexOf(startMarker);
          const baseContent = existingPlatform.substring(0, index);
          fs.writeFileSync(platformPath, baseContent + platformContent + '\n', 'utf-8');
        } else {
          const separator = existingPlatform.endsWith('\n') ? '\n' : '\n\n';
          fs.writeFileSync(platformPath, existingPlatform + separator + platformContent + '\n', 'utf-8');
        }
      } else {
        const regex = /## Verfix[\s\S]*?(?=\n## |$)/;
        if (regex.test(existingPlatform)) {
          const updated = existingPlatform.replace(regex, platformContent.trim());
          fs.writeFileSync(platformPath, updated, 'utf-8');
        } else {
          const separator = existingPlatform.endsWith('\n') ? '\n' : '\n\n';
          fs.writeFileSync(platformPath, existingPlatform + separator + platformContent + '\n', 'utf-8');
        }
      }
      updatedFiles.push(platformFileName);
    }
  }

  return updatedFiles;
}
