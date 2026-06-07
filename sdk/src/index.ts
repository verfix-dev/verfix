import axios from 'axios';
import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';

export type FailureType =
  | 'selector_not_found'
  | 'selector_not_visible'
  | 'text_mismatch'
  | 'url_mismatch'
  | 'console_error'
  | 'network_failure'
  | 'timeout'
  | 'assertion_failed';

export type VerifyConfig = {
  baseUrl?: string;
  url?: string;
  task?: string;
  mode?: 'strict' | 'assisted' | 'smoke' | 'exploratory';
  assertions?: Array<Record<string, unknown>>;
  flows?: Array<Record<string, unknown>>;
  selectors?: Record<string, string>;
  metadata?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
};

export type VerifyFailure = {
  type: FailureType;
  selector?: string;
  detail?: string;
  fix_hint?: string;
};

export type VerifyResult = {
  passed: boolean;
  failures: VerifyFailure[];
  timeline_url: string;
  exit_code: 0 | 1;
  execution_id: string;
  raw: any;
};

export type VerifyOptions = {
  config?: string | VerifyConfig;
  flow?: string;
  url?: string;
  task?: string;
  mode?: 'strict' | 'assisted' | 'smoke' | 'exploratory';
  apiBase?: string;
  dashboardBase?: string;
  timeout?: number;
  retries?: number;
};

export interface FlowInfo {
  id: string;
  steps: number;
  assertions: number;
  mode?: string;
}

export interface HealthStatus {
  healthy: boolean;
  api: string;       // 'healthy' | 'unreachable'
  dashboard: string; // 'healthy' | 'unreachable'
}

export interface ExecutionStatus {
  executionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  passed?: boolean;
  duration_ms?: number;
  task: string;
  url: string;
}

const DEFAULT_CONFIG = 'verfix.config.json';

// Keep verify() for backward compatibility
export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const apiBase = options.apiBase || process.env.VERIFY_API || 'http://localhost:3611';
  const dashboardBase = options.dashboardBase || process.env.VERIFY_DASHBOARD || 'http://localhost:3610';

  const { config, didLoadConfig } = loadConfig(options.config);
  if (didLoadConfig) {
    validateConfigSchema(config);
  }
  const selectedFlow = selectFlow(config?.flows as any[] | undefined, options.flow);
  const flows = selectedFlow ? normalizeFlows([selectedFlow]) : normalizeFlows((config?.flows as any[]) || []);
  const assertions = (selectedFlow as any)?.assertions ? undefined : config.assertions;

  const baseUrl = options.url || config.baseUrl || config.url;
  if (!baseUrl) {
    throw new Error('url is required (or set baseUrl in config file)');
  }

  const payload: any = {
    url: baseUrl,
    task: options.task || config.task || (options.flow ? `Verify flow ${options.flow}` : `Verify ${baseUrl}`),
    mode: options.mode || config.mode || 'strict',
    assertions,
    flows: flows.length > 0 ? flows : undefined,
    selectors: config.selectors,
    metadata: config.metadata,
    timeout: options.timeout || config.timeout || 15000,
    retries: options.retries || config.retries || 2,
  };

  const submit = await axios.post(`${apiBase}/api/v1/verify`, payload);
  const executionId = submit.data.executionId;

  const result = await pollResult(apiBase, executionId);
  const timelineUrl = buildTimelineUrl(dashboardBase, executionId);
  const failures = buildFailures(result);

  return {
    passed: result.passed,
    failures,
    timeline_url: timelineUrl,
    exit_code: result.passed ? 0 : 1,
    execution_id: result.executionId,
    raw: result,
  };
}

export class Verfix {
  private apiBase: string;
  private dashboardBase: string;
  private config?: string | VerifyConfig;

  constructor(options?: {
    apiBase?: string;
    dashboardBase?: string;
    config?: string | VerifyConfig;
  }) {
    this.apiBase = options?.apiBase || process.env.VERIFY_API || 'http://localhost:3611';
    this.dashboardBase = options?.dashboardBase || process.env.VERIFY_DASHBOARD || 'http://localhost:3610';
    this.config = options?.config;
  }

  async runFlow(flowId: string, options?: { mode?: string; url?: string }): Promise<VerifyResult> {
    return verify({
      config: this.config,
      flow: flowId,
      url: options?.url,
      mode: options?.mode as any,
      apiBase: this.apiBase,
      dashboardBase: this.dashboardBase,
    });
  }

  async runAll(options?: { mode?: string; url?: string }): Promise<VerifyResult[]> {
    const flows = await this.listFlows();
    const results: VerifyResult[] = [];
    for (const flow of flows) {
      const result = await this.runFlow(flow.id, options);
      results.push(result);
    }
    return results;
  }

  async exploratory(task: string, options?: { url?: string }): Promise<VerifyResult> {
    return verify({
      config: this.config,
      task,
      mode: 'exploratory',
      url: options?.url,
      apiBase: this.apiBase,
      dashboardBase: this.dashboardBase,
    });
  }

  async listFlows(): Promise<FlowInfo[]> {
    let flows: any[] = [];
    if (this.config && typeof this.config !== 'string') {
      flows = (this.config as VerifyConfig).flows || [];
    } else {
      const configPath = (this.config as string) || path.resolve(process.cwd(), DEFAULT_CONFIG);
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        flows = config.flows || [];
      }
    }
    return flows.map((f: any, idx: number) => ({
      id: f.id || f.name || `flow_${idx + 1}`,
      steps: f.steps ? f.steps.length : 0,
      assertions: f.assertions ? f.assertions.length : 0,
      mode: f.mode,
    }));
  }

  async status(executionId: string): Promise<ExecutionStatus> {
    const res = await axios.get(`${this.apiBase}/api/v1/executions/${executionId}`);
    return res.data;
  }

  async health(): Promise<HealthStatus> {
    try {
      const res = await axios.get(`${this.apiBase}/api/v1/health`);
      const apiHealthy = res.status === 200 && res.data.status === 'healthy';
      const dashboardReachable = await this.checkDashboardReachable();
      return {
        healthy: apiHealthy && dashboardReachable,
        api: apiHealthy ? 'healthy' : 'unreachable',
        dashboard: dashboardReachable ? 'healthy' : 'unreachable',
      };
    } catch {
      return {
        healthy: false,
        api: 'unreachable',
        dashboard: 'unreachable',
      };
    }
  }

  async listExecutions(options?: { limit?: number }): Promise<ExecutionStatus[]> {
    const limit = options?.limit || 50;
    const res = await axios.get(`${this.apiBase}/api/v1/executions`, { params: { limit } });
    return res.data.executions || [];
  }

  private async checkDashboardReachable(): Promise<boolean> {
    try {
      await axios.get(this.dashboardBase, { timeout: 2000 });
      return true;
    } catch (e: any) {
      if (e.code && e.code === 'ECONNREFUSED') {
        return false;
      }
      return true;
    }
  }
}

// Internal helpers (moved below)
function loadConfig(input?: string | VerifyConfig): { config: VerifyConfig; didLoadConfig: boolean } {
  if (!input) {
    const defaultPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
    if (fs.existsSync(defaultPath)) {
      return { config: JSON.parse(fs.readFileSync(defaultPath, 'utf-8')) as VerifyConfig, didLoadConfig: true };
    }
    return { config: {}, didLoadConfig: false };
  }
  if (typeof input === 'string') {
    const configPath = path.resolve(input);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    return { config: JSON.parse(fs.readFileSync(configPath, 'utf-8')) as VerifyConfig, didLoadConfig: true };
  }
  return { config: input, didLoadConfig: true };
}

async function pollResult(apiBase: string, executionId: string): Promise<any> {
  const maxWait = 120000;
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await sleep(pollInterval);
    try {
      const res = await axios.get(`${apiBase}/api/v1/executions/${executionId}`);
      if (res.data.status === 'completed' || res.data.status === 'failed') {
        return res.data;
      }
    } catch {
      // keep polling
    }
  }

  throw new Error('Timed out waiting for verification result');
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Timeline url generator
function buildTimelineUrl(base: string, executionId: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/?executionId=${encodeURIComponent(executionId)}`;
}

function selectFlow(flows: any[] | undefined, idOrName?: string): any | undefined {
  if (!idOrName || !flows || flows.length === 0) return undefined;
  const found = flows.find(f => f.id === idOrName || f.name === idOrName);
  if (!found) throw new Error(`Flow not found: ${idOrName}`);
  return found;
}

function normalizeFlows(flows: any[]): any[] {
  if (!flows || flows.length === 0) return [];
  return flows.map((flow, idx) => ({
    name: flow.name || flow.id || `flow_${idx + 1}`,
    steps: (flow.steps || []).map((step: any) => ({
      action: step.action,
      target: step.testId
        ? { testId: step.testId }
        : step.selector
          ? { selector: step.selector }
          : step.text
            ? { text: step.text }
            : undefined,
      value: step.value ?? step.url,
      url: step.url,
      timeout: step.timeout,
    })),
    assertions: flow.assertions,
  }));
}

function validateConfigSchema(config: VerifyConfig): void {
  const schemaPath = path.resolve(process.cwd(), 'verfix.config.schema.json');
  if (!fs.existsSync(schemaPath)) return;

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(config);
  if (!valid) {
    const errors = (validate.errors || []).map(err => {
      const loc = err.instancePath || '/';
      return `${loc} ${err.message || 'is invalid'}`;
    });
    throw new Error(`Config schema validation failed: ${errors.join('; ')}`);
  }
}

function buildFailures(result: any): VerifyFailure[] {
  const failures = (result.assertions || [])
    .filter((a: any) => !a.passed)
    .map((a: any) => ({
      type: (a.failure_type || 'assertion_failed') as FailureType,
      selector: a.details?.selector || a.details?.resolved_selector,
      detail: a.error,
      fix_hint: a.fix_hint,
    }));

  if (failures.length === 0 && result.error) {
    const type = inferFailureTypeFromError(result.error);
    failures.push({
      type,
      detail: result.error,
      fix_hint: renderFixHint(type),
    });
  }

  return failures;
}

function inferFailureTypeFromError(error: string): FailureType {
  if (/timeout|timed out|waiting for/i.test(error)) return 'timeout';
  return 'assertion_failed';
}

function renderFixHint(type: FailureType): string {
  switch (type) {
    case 'timeout':
      return 'Operation timed out. Increase timeout or wait for network/DOM to settle before retrying.';
    default:
      return 'Assertion failed. Verify assertion inputs and app state before retrying.';
  }
}
