// ${VAR}-style substitution for config values: env vars from process.env
// (which already includes .verfix/.env, merged at CLI startup) plus built-in
// dynamic macros for run-unique values, so "create X" flows stay idempotent
// against backends with uniqueness validation.

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// Built-in macros, resolved lazily and cached for the rest of the CLI
// invocation: the same token yields the same value in every step and assertion
// of a run (type ${RANDOM} in one step, assert it visible in another).
// An explicitly-set env var of the same name takes precedence.
let runMacros: Record<string, string> | undefined;
function builtinMacro(name: string): string | undefined {
  if (name !== 'TIMESTAMP' && name !== 'RANDOM') return undefined;
  runMacros ??= {
    TIMESTAMP: String(Date.now()),
    RANDOM: Math.random().toString(36).slice(2, 10),
  };
  return runMacros[name];
}

export class MissingEnvVarError extends Error {
  constructor(public readonly varName: string, public readonly fieldPath: string) {
    super(`Environment variable "${varName}" referenced at ${fieldPath} is not set. Set it in .verfix/.env.`);
  }
}

/** Replace every ${VAR} in `value` with process.env[VAR], falling back to the
 *  built-in ${TIMESTAMP}/${RANDOM} macros. Throws MissingEnvVarError if unset. */
export function interpolateEnv(value: string, fieldPath: string): string {
  return value.replace(VAR_PATTERN, (_match, varName: string) => {
    const resolved = process.env[varName] ?? builtinMacro(varName);
    if (resolved === undefined) {
      throw new MissingEnvVarError(varName, fieldPath);
    }
    return resolved;
  });
}

/** Interpolate a flow step's `value`/`url`/`file`-path fields in place, given its 0-based index for error messages. */
export function interpolateStep(step: any, fieldPrefix: string): any {
  if (!step) return step;
  return {
    ...step,
    value: typeof step.value === 'string' ? interpolateEnv(step.value, `${fieldPrefix}.value`) : step.value,
    url: typeof step.url === 'string' ? interpolateEnv(step.url, `${fieldPrefix}.url`) : step.url,
    // upload_file fixture paths may be machine-specific; inline file content is not interpolated.
    file: typeof step.file === 'string' ? interpolateEnv(step.file, `${fieldPrefix}.file`) : step.file,
  };
}

/** Interpolate each assertion's `value` field, given a field-path prefix for error messages. */
export function interpolateAssertions(assertions: any[] | undefined, fieldPrefix: string): any[] | undefined {
  if (!assertions) return assertions;
  return assertions.map((a, i) => ({
    ...a,
    value: typeof a.value === 'string' ? interpolateEnv(a.value, `${fieldPrefix}[${i}].value`) : a.value,
  }));
}
