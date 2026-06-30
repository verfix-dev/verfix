export type ExecutionEventType = 
  | 'assertion_failed'
  | 'assertion_passed'
  | 'navigation'
  | 'action'
  | 'dom_change'
  | 'retry'
  | 'ai_reasoning';

export type ExecutionEvent = {
  id: string;
  type: ExecutionEventType;
  timestamp: string;
  message: string;
  metadata?: Record<string, unknown>;
  category?: 'signal' | 'summary' | 'info';
  capture_reason?: 'failure' | 'retry';
  signal_flags?: string[];
  summary?: string;
  screenshot?: string;
  dom_snippet?: string;
};

export type Execution = {
  executionId: string;
  task: string;
  url: string;
  mode: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  passed: boolean;
  duration_ms: number;
  retry_count: number;
  events?: ExecutionEvent[];
  assertions: AssertionResult[];
  artifacts: Record<string, string>;
  console_logs: ConsoleLine[];
  network_requests: NetworkRequest[];
  error?: string;
  created_at: string;
  completed_at?: string;
  ai_summary?: {
    likely_root_cause: string;
    evidence: string[];
    suggested_fix: string | null;
    confidence: number;
    model: string;
    generated_at: string;
  };
};

export type AssertionResult = {
  type: string;
  passed: boolean;
  duration_ms: number;
  error?: string;
  details?: Record<string, unknown>;
  screenshot_on_failure?: string;
  failure_type?: string;
  fix_hint?: string;
  flow_name?: string;
};

export type ConsoleLine = { type: string; text: string; timestamp: string };
export type NetworkRequest = { url: string; method: string; status: number; timing_ms: number; timestamp: string };

export type FlakyURL = {
  task: string;
  url: string;
  total_runs: number;
  pass_count: number;
  fail_count: number;
  flake_rate: number;
  avg_duration_ms: number;
  last_run: string;
};
