/**
 * Centralized JSON output for --output json mode.
 * All JSON mode output MUST go through these functions.
 * No chalk, no ora, no console.log outside these.
 */

export interface JsonError {
  error: string;          // machine-readable error code
  message: string;        // human-readable description
  hint?: string;          // suggested next action
}

export function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function emitJsonError(error: JsonError, exitCode: number = 2): never {
  console.log(JSON.stringify(error, null, 2));
  process.exit(exitCode);
  throw new Error('unreachable'); // satisfy TS never return type
}

export function isJsonMode(opts: { output?: string }): boolean {
  return opts.output === 'json';
}
