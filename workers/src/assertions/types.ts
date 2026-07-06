// Assertion types shared across the worker, CLI, and API
export type AssertionType =
  | 'page_loaded'
  | 'selector_visible'
  | 'text_visible'
  | 'url_contains'
  | 'no_console_errors'
  | 'network_request_success'
  | 'title_contains'
  | 'exploration_result';

export const ASSERTION_TYPES: AssertionType[] = [
  'page_loaded', 'selector_visible', 'text_visible', 'url_contains',
  'no_console_errors', 'network_request_success', 'title_contains', 'exploration_result',
];

export type FailureType =
  | 'selector_not_found'
  | 'selector_not_visible'
  | 'text_mismatch'
  | 'url_mismatch'
  | 'console_error'
  | 'network_failure'
  | 'timeout'
  | 'assertion_failed';

export interface AssertionDefinition {
  type: AssertionType;
  selector?: string;      // for selector_visible
  value?: string;         // for text_visible, url_contains, title_contains, network_request_success
  timeout?: number;
  acceptStatuses?: number[]; // network_request_success: replaces the default 200-399 range when set
  exclude?: string[];        // no_console_errors: regex patterns to ignore
}

export interface AssertionResult {
  type: AssertionType;
  passed: boolean;
  duration_ms: number;
  error?: string;
  details?: Record<string, unknown>;
  screenshot_on_failure?: string;
  failure_type?: FailureType;
  fix_hint?: string;
  // Identifier of the flow these assertions belong to. Absent for top-level /
  // default (page_loaded / no_console_errors) assertions. Used by the dashboard
  // assertion tab to group results by flow.
  flow_name?: string;
}

export interface FlowStep {
  action: 'click' | 'type' | 'navigate' | 'wait_for_selector';
  target?: {
    testId?: string;
    selector?: string;
    text?: string;
  };
  value?: string;
  url?: string;
  timeout?: number;
  // Best-effort: any failure within the step's timeout is skipped, not fatal.
  optional?: boolean;
}

export interface Flow {
  name: string;
  mode?: string;
  steps: FlowStep[];
  assertions?: AssertionDefinition[];
  // Clear cookies + local/session storage before this flow runs.
  clearState?: boolean;
}

export interface JobPayload {
  id: string;
  task: string;
  url: string;
  mode?: 'strict' | 'assisted' | 'smoke' | 'exploratory';
  assertions?: AssertionDefinition[];
  flows?: Flow[];
  selectors?: Record<string, string>;
  metadata?: {
    framework?: string;
    authProvider?: string;
    [key: string]: unknown;
  };
  timeout?: number;
  retries?: number;
  // Legacy field support
  expectedBehavior?: string[];
}

export interface AISummary {
  likely_root_cause: string;
  evidence: string[];
  suggested_fix: string | null;
  confidence: number;
  model: string;
  generated_at: string;
}

export type ExecutionEventType = 
  | 'assertion_failed'
  | 'assertion_passed'
  | 'navigation'
  | 'action'
  | 'dom_change'
  | 'retry'
  | 'ai_reasoning';

export interface ExecutionEvent {
  id: string;
  type: ExecutionEventType;
  timestamp: string;
  message: string;
  metadata?: Record<string, unknown>;
  category?: 'signal' | 'summary' | 'info';
  capture_reason?: 'failure' | 'retry' | 'step';
  signal_flags?: string[];
  summary?: string;
  screenshot?: string;
  dom_snippet?: string;
  dom_snapshot?: string;
}

export interface ExecutionResult {
  executionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  task: string;
  url: string;
  mode: string;
  passed: boolean;
  duration_ms: number;
  retry_count: number;
  events?: ExecutionEvent[];
  assertions: AssertionResult[];
  artifacts: {
    screenshot?: string;
    failed_screenshot?: string;
    trace?: string;
    har?: string;
    console_log?: string;
    network_log?: string;
    dom_snapshot?: string;
  };
  console_logs: ConsoleLine[];
  network_requests: NetworkRequest[];
  error?: string;
  created_at: string;
  completed_at?: string;
  ai_summary?: AISummary;
}

export interface ConsoleLine {
  type: string;
  text: string;
  timestamp: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  timing_ms: number;
  timestamp: string;
}
