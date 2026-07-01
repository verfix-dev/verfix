/**
 * Source-change guard — deterministic detection of project-code edits made
 * during a verification loop.
 *
 * Philosophy (matches Verfix's contract model): agents should verify UI changes
 * by editing Verfix configuration (the `selectors` alias map, flow steps, or by
 * using assisted-mode self-healing) — NOT by rewriting project source to satisfy
 * a broken selector. Editing project code is legitimate ONLY when Verfix surfaces
 * a genuine app bug (e.g. a console error or real regression).
 *
 * This module turns "did the agent touch project source during the fix loop"
 * into a typed signal the agent must react to, instead of relying on the prompt
 * alone. It is stateless per-run but persists a per-cycle baseline in
 * `.verfix/verify-baseline.json`.
 *
 * How the baseline works:
 *   - A "verify cycle" is the sequence of `verfix run` invocations for one change.
 *   - The FIRST run of a cycle snapshots the working tree (the agent's original
 *     feature work). That work is intentionally NOT flagged.
 *   - Subsequent runs report project files that changed *since* the baseline —
 *     i.e. edits made inside the edit → verify → fix loop, which is exactly where
 *     the "hacking source to satisfy a selector" anti-pattern lives.
 *   - A passing run ends the cycle and clears the baseline.
 *   - A new commit (HEAD moves) also starts a fresh cycle.
 *
 * Degrades gracefully: if git is unavailable or the directory is not a repo, the
 * guard reports `status: 'unavailable'` and never blocks or crashes a run.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

export type SourceCodePolicy = 'warn' | 'block' | 'off';

export interface SourceChangeFile {
  path: string;
  classification: 'project' | 'config';
}

export interface SourceChanges {
  /** 'ok' when the guard ran, 'unavailable' when git/repo checks could not run. */
  status: 'ok' | 'unavailable';
  /** True on the run that established a fresh baseline (nothing to compare yet). */
  baseline_captured: boolean;
  files: SourceChangeFile[];
  project_count: number;
  config_count: number;
  note?: string;
}

interface Fingerprint {
  head: string;
  files: Record<string, string>; // path → content hash (or 'deleted')
}

const BASELINE_FILE = 'verify-baseline.json';

// ─── Path classification ─────────────────────────────────────────────────────

/**
 * Files that ARE Verfix/agent configuration — editing these is the preferred
 * path and is never flagged as a project-source change.
 */
function isConfigPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (p === 'verfix.config.json') return true;
  if (/^verfix\.config\.[^/]+$/.test(p)) return true; // verfix.config.js/ts/schema.json
  if (p.startsWith('.verfix/')) return true;
  // Agent instruction files — steering the agent is config, not project code.
  if (p === 'AGENTS.md' || p === 'CLAUDE.md' || p === 'GEMINI.md' || p === 'CODEX.md' || p === '.cursorrules') return true;
  if (p === '.github/copilot-instructions.md' || p.startsWith('.github/instructions/')) return true;
  if (p.startsWith('.cursor/') || p.startsWith('.clinerules/') || p.startsWith('.agents/')) return true;
  return false;
}

// ─── Git helpers (all guarded, never throw to caller) ────────────────────────

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return null;
  }
}

function isGitRepo(cwd: string): boolean {
  const out = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return out !== null && out.trim() === 'true';
}

/** Parse `git status --porcelain` into the list of changed paths (new path on renames). */
function changedPaths(cwd: string): string[] | null {
  const out = git(cwd, ['status', '--porcelain', '--untracked-files=all']);
  if (out === null) return null;
  const paths: string[] = [];
  for (const rawLine of out.split('\n')) {
    if (!rawLine.trim()) continue;
    // Format: "XY <path>" or "R  old -> new"
    const body = rawLine.slice(3);
    const arrow = body.indexOf(' -> ');
    const p = (arrow !== -1 ? body.slice(arrow + 4) : body).trim().replace(/^"|"$/g, '');
    if (p) paths.push(p);
  }
  return paths;
}

function hashFile(cwd: string, relPath: string): string {
  try {
    const buf = fs.readFileSync(path.join(cwd, relPath));
    return crypto.createHash('sha1').update(buf).digest('hex');
  } catch {
    return 'deleted';
  }
}

function fingerprint(cwd: string): Fingerprint | null {
  const paths = changedPaths(cwd);
  if (paths === null) return null;
  const head = (git(cwd, ['rev-parse', 'HEAD']) || '').trim();
  const files: Record<string, string> = {};
  for (const p of paths) {
    // The baseline file is the guard's own bookkeeping — never report it.
    if (p.replace(/\\/g, '/') === `.verfix/${BASELINE_FILE}`) continue;
    files[p] = hashFile(cwd, p);
  }
  return { head, files };
}

// ─── Baseline persistence ────────────────────────────────────────────────────

function baselinePath(cwd: string): string {
  return path.join(cwd, '.verfix', BASELINE_FILE);
}

function readBaseline(cwd: string): Fingerprint | null {
  try {
    const raw = fs.readFileSync(baselinePath(cwd), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.files) return parsed as Fingerprint;
    return null;
  } catch {
    return null;
  }
}

function writeBaseline(cwd: string, fp: Fingerprint): void {
  try {
    const dir = path.join(cwd, '.verfix');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Keep .verfix/ local — it holds runtime state and secrets (.env) that must
    // never be committed. Self-ignore so the baseline can't dirty the user's repo.
    const gi = path.join(dir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n', 'utf-8');
    fs.writeFileSync(baselinePath(cwd), JSON.stringify(fp, null, 2), 'utf-8');
  } catch {
    // Non-fatal: guard simply won't persist across runs.
  }
}

export function clearSourceBaseline(cwd: string): void {
  try {
    fs.rmSync(baselinePath(cwd), { force: true });
  } catch {
    // ignore
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluate project-source changes since the current verify cycle began, updating
 * the persisted baseline as needed. Call this at the START of a `verfix run`,
 * before executing the browser flow.
 */
export function evaluateSourceChanges(cwd: string, opts: { reset?: boolean } = {}): SourceChanges {
  const unavailable = (note: string): SourceChanges => ({
    status: 'unavailable',
    baseline_captured: false,
    files: [],
    project_count: 0,
    config_count: 0,
    note,
  });

  if (!isGitRepo(cwd)) {
    return unavailable('Not a git repository — source-change detection is disabled.');
  }

  const current = fingerprint(cwd);
  if (current === null) {
    return unavailable('git status failed — source-change detection is disabled.');
  }

  if (opts.reset) clearSourceBaseline(cwd);

  const baseline = opts.reset ? null : readBaseline(cwd);

  // New cycle: no baseline yet, or a commit moved HEAD since the baseline.
  if (!baseline || baseline.head !== current.head) {
    writeBaseline(cwd, current);
    return {
      status: 'ok',
      baseline_captured: true,
      files: [],
      project_count: 0,
      config_count: 0,
      note: 'Baseline captured for this verify cycle. Existing changes are treated as prior work.',
    };
  }

  // Compare: files new or content-changed vs the baseline are edits made during
  // this verify cycle (i.e. inside the fix loop).
  const files: SourceChangeFile[] = [];
  for (const [p, hash] of Object.entries(current.files)) {
    const prior = baseline.files[p];
    if (prior === undefined || prior !== hash) {
      files.push({ path: p, classification: isConfigPath(p) ? 'config' : 'project' });
    }
  }

  const project_count = files.filter(f => f.classification === 'project').length;
  const config_count = files.filter(f => f.classification === 'config').length;

  return {
    status: 'ok',
    baseline_captured: false,
    files,
    project_count,
    config_count,
  };
}

/**
 * Given the source-change result and the configured policy, decide whether the
 * run should be blocked and produce a structured failure/warning finding.
 */
export function buildSourceFinding(
  changes: SourceChanges,
  policy: SourceCodePolicy,
): { block: boolean; finding?: { type: string; detail: string; fix_hint: string; files: string[] } } {
  if (policy === 'off' || changes.status !== 'ok' || changes.project_count === 0) {
    return { block: false };
  }

  const projectFiles = changes.files.filter(f => f.classification === 'project').map(f => f.path);
  const fileList = projectFiles.join(', ');

  const fix_hint =
    'Project source changed during this verify cycle. If this was to satisfy a ' +
    'selector, REVERT it and use the config path instead: add the target to the ' +
    '`selectors` alias map in verfix.config.json, or use assisted mode (self-healing ' +
    'resolves elements by aria/role/text — no data-testid needed). Editing project ' +
    'source is only appropriate to fix a genuine app bug Verfix surfaced (e.g. a ' +
    'console error or real regression).';

  return {
    block: policy === 'block',
    finding: {
      type: policy === 'block' ? 'source_edit_blocked' : 'source_edit_warning',
      detail: `Modified project source during verify loop: ${fileList}`,
      fix_hint,
      files: projectFiles,
    },
  };
}
