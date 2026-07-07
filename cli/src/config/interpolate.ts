// ${VAR}-style env-var substitution for config values. Resolved from
// process.env (which already includes .verfix/.env, merged at CLI startup)
// so secrets never have to live in verfix.config.json.

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class MissingEnvVarError extends Error {
  constructor(public readonly varName: string, public readonly fieldPath: string) {
    super(`Environment variable "${varName}" referenced at ${fieldPath} is not set. Set it in .verfix/.env.`);
  }
}

/** Replace every ${VAR} in `value` with process.env[VAR]. Throws MissingEnvVarError if unset. */
export function interpolateEnv(value: string, fieldPath: string): string {
  return value.replace(VAR_PATTERN, (_match, varName: string) => {
    const resolved = process.env[varName];
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
