import fs from 'fs';
import path from 'path';
import { generatePlatformStub, VERFIX_INSTRUCTIONS_FILE } from './agents-md';
import { getAgentFilePath, type AgentPlatform } from './agent-platform';

/**
 * Write the full Verfix reference to `.verfix/INSTRUCTIONS.md`.
 * Verfix owns this file, so it is always overwritten cleanly (unlike AGENTS.md,
 * which may contain the project's own content alongside the Verfix stub).
 */
export function writeVerfixInstructions(cwd: string, fullSection: string): void {
  const instructionsPath = path.join(cwd, VERFIX_INSTRUCTIONS_FILE);
  fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
  fs.writeFileSync(instructionsPath, fullSection.trimEnd() + '\n', 'utf-8');
}

/**
 * Write or update AGENTS.md with the Verfix stub (the short pointer section).
 * The full reference lives in `.verfix/INSTRUCTIONS.md` — see writeVerfixInstructions.
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
    const updated = existing.replace(sectionRegex, verfixSection.trimEnd());
    fs.writeFileSync(agentsPath, updated, 'utf-8');
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(agentsPath, existing + separator + verfixSection + '\n', 'utf-8');
  }
  return false; // indicates updated
}

/**
 * Write or update platform-specific agent files for tools that don't read
 * AGENTS.md natively: CLAUDE.md (Claude Code), .github/copilot-instructions.md
 * (Copilot IDE), and .clinerules/verfix.md (Cline). Each carries the same short
 * Verfix stub, pointing at the full reference in `.verfix/INSTRUCTIONS.md`.
 */
export function writePlatformAgentFiles(
  cwd: string,
  platforms: Exclude<AgentPlatform, 'generic'>[],
  _mode: string,
  _baseUrl: string,
): string[] {
  const updatedFiles: string[] = [];
  const stub = generatePlatformStub();

  for (const platform of platforms) {
    const platformPath = getAgentFilePath(platform, cwd);
    const platformFileName = path.basename(platformPath);

    // Copilot / Cline live in subdirectories that may not exist yet.
    fs.mkdirSync(path.dirname(platformPath), { recursive: true });

    if (!fs.existsSync(platformPath)) {
      fs.writeFileSync(platformPath, stub + '\n', 'utf-8');
    } else {
      const existing = fs.readFileSync(platformPath, 'utf-8');
      const regex = /## Verfix — Browser Verification[\s\S]*?(?=\n## [^V]|\n## $|$)/;
      if (regex.test(existing)) {
        fs.writeFileSync(platformPath, existing.replace(regex, stub.trimEnd()), 'utf-8');
      } else {
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(platformPath, existing + separator + stub + '\n', 'utf-8');
      }
    }
    updatedFiles.push(platformFileName);
  }

  return updatedFiles;
}
