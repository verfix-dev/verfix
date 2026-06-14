import * as fs from 'fs';
import * as path from 'path';

/**
 * Artifact files (screenshots, DOM snapshots, traces, HAR, per-execution
 * directories) accumulate on disk indefinitely, while their corresponding
 * Redis results expire after 24h. This sweep deletes artifacts older than the
 * retention window so the disk does not grow without bound.
 */

const RETENTION_HOURS = parseInt(process.env.ARTIFACT_RETENTION_HOURS || '24');
const SWEEP_INTERVAL_MS = parseInt(process.env.ARTIFACT_CLEANUP_INTERVAL_MS || '3600000');

export async function cleanupOldArtifacts(artifactsDir: string): Promise<void> {
  const cutoff = Date.now() - RETENTION_HOURS * 60 * 60 * 1000;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(artifactsDir, { withFileTypes: true });
  } catch (e: any) {
    console.warn(`⚠ Artifact cleanup: could not read ${artifactsDir}: ${e.message}`);
    return;
  }

  let removed = 0;
  for (const entry of entries) {
    const fullPath = path.join(artifactsDir, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.mtimeMs >= cutoff) continue;
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      removed++;
    } catch (e: any) {
      console.warn(`⚠ Artifact cleanup: could not remove ${fullPath}: ${e.message}`);
    }
  }

  if (removed > 0) {
    console.log(`🧹 Artifact cleanup: removed ${removed} item(s) older than ${RETENTION_HOURS}h`);
  }
}

/**
 * Run an immediate sweep and schedule periodic ones. Returns the interval
 * handle so callers can clear it on shutdown if desired.
 */
export function startArtifactCleanup(artifactsDir: string): NodeJS.Timeout {
  void cleanupOldArtifacts(artifactsDir);
  const handle = setInterval(() => {
    void cleanupOldArtifacts(artifactsDir);
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive solely for the cleanup timer.
  handle.unref?.();
  return handle;
}
