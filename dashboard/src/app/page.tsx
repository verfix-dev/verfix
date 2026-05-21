'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import NewJobPanel from '@/components/NewJobPanel';
import ExecutionList from '@/components/ExecutionList';
import ExecutionDetail from '@/components/ExecutionDetail';
import Link from 'next/link';
import { Zap, BarChart2, AlertTriangle, Activity, CheckCircle2, Clock, Plus, X } from 'lucide-react';

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
};

export type ConsoleLine = { type: string; text: string; timestamp: string };
export type NetworkRequest = { url: string; method: string; status: number; timing_ms: number; timestamp: string };

const API = 'http://localhost:3001';

import { Suspense } from 'react';

export default function Home() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const pollingRef = useRef<Set<string>>(new Set());
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const searchParams = useSearchParams();
  // Fetch FULL execution detail (with assertions, logs, artifacts)
  const fetchDetail = useCallback(async (id: string): Promise<Execution | null> => {
    try {
      const res = await fetch(`${API}/api/v1/executions/${id}`);
      return await res.json();
    } catch {
      return null;
    }
  }, []);
  // Load execution list on mount
  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/executions?limit=100`);
      const data = await res.json();
      if (data.executions) {
        setExecutions(prev => {
          // Merge: keep full detail for already-loaded ones, update status for rest
          const map = new Map(prev.map(e => [e.executionId, e]));
          data.executions.forEach((e: Execution) => {
            const existing = map.get(e.executionId);
            if (!existing || existing.status === 'queued') {
              map.set(e.executionId, e);
            } else {
              // Only update status/passed/duration — preserve assertions/logs from full fetch
              map.set(e.executionId, { ...existing, status: e.status, passed: e.passed, duration_ms: e.duration_ms });
            }
          });
          return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
      }
    } catch {}
  }, []);

  // Deep-link to an execution from the query param
  useEffect(() => {
    const id = searchParams.get('executionId');
    if (!id) return;
    (async () => {
      const full = await fetchDetail(id);
      if (full) {
        setSelected(full);
        setExecutions(prev => {
          const exists = prev.find(e => e.executionId === full.executionId);
          if (exists) {
            return prev.map(e => e.executionId === full.executionId ? { ...e, ...full } : e);
          }
          return [full, ...prev];
        });
      }
    })();
  }, [searchParams, fetchDetail]);

  useEffect(() => {
    fetchList();
    const t = setInterval(fetchList, 10000);
    return () => clearInterval(t);
  }, [fetchList]);



  // Select an execution — always fetch full detail
  const selectExecution = useCallback(async (e: Execution) => {
    setSelected(e); // Show immediately with what we have
    
    if (e.status === 'completed' || e.status === 'failed') {
      // Only fetch detail if we don't already have assertions
      if (!e.assertions || e.assertions.length === 0) {
        setLoadingDetail(true);
        const full = await fetchDetail(e.executionId);
        if (full) {
          setSelected(full);
          setExecutions(prev => prev.map(ex => ex.executionId === full.executionId ? { ...ex, ...full } : ex));
        }
        setLoadingDetail(false);
      }
    } else {
      // Start polling for live status
      startPolling(e.executionId);
    }
  }, [fetchDetail]);

  const startPolling = useCallback((id: string) => {
    if (pollingRef.current.has(id)) return;
    pollingRef.current.add(id);

    const interval = setInterval(async () => {
      const data = await fetchDetail(id);
      if (!data) return;

      setExecutions(prev => prev.map(e => e.executionId === id ? { ...e, ...data } : e));
      setSelected(prev => prev?.executionId === id ? data : prev);

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
        intervalsRef.current.delete(id);
        pollingRef.current.delete(id);
      }
    }, 2000);

    intervalsRef.current.set(id, interval);
  }, [fetchDetail]);

  const onJobSubmitted = (id: string) => {
    const placeholder: Execution = {
      executionId: id, task: 'Initializing...', url: '', mode: 'strict',
      status: 'queued', passed: false, duration_ms: 0, retry_count: 0,
      assertions: [], artifacts: {}, console_logs: [], network_requests: [],
      created_at: new Date().toISOString(),
    };
    setExecutions(prev => [placeholder, ...prev]);
    setSelected(placeholder);
    setShowNewJob(false);
    startPolling(id);
  };

  const completedExecs = executions.filter(e => e.status === 'completed' || e.status === 'failed');
  const passRate = completedExecs.length > 0
    ? Math.round(completedExecs.filter(e => e.passed).length / completedExecs.length * 100)
    : 0;
  const activeCount = executions.filter(e => e.status === 'running' || e.status === 'queued').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)' }}>
      {/* ── Top Bar ─────────────────────────────────────── */}
      <div style={{ height: 44, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 0, flexShrink: 0 }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 20, borderRight: '1px solid var(--border)' }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--gradient-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={11} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.01em' }}>Verfix</span>
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 12, gap: 2 }}>
          <NavBtn href="/" active>Executions</NavBtn>
          <NavBtn href="/metrics"><BarChart2 size={11} style={{ marginRight: 4 }} />Metrics</NavBtn>
          <NavBtn href="/flaky"><AlertTriangle size={11} style={{ marginRight: 4 }} />Flaky</NavBtn>
        </div>

        <div style={{ flex: 1 }} />

        {/* Status pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 16 }}>
          {activeCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
              <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{activeCount} running</span>
            </div>
          )}
          {completedExecs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <CheckCircle2 size={11} color={passRate >= 80 ? 'var(--accent-green)' : 'var(--accent-yellow)'} />
              <span style={{ color: passRate >= 80 ? 'var(--accent-green)' : 'var(--accent-yellow)', fontWeight: 600 }}>{passRate}% pass</span>
            </div>
          )}
        </div>

        {/* New Job button */}
        <button
          onClick={() => setShowNewJob(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: showNewJob ? 'var(--bg-highlight)' : 'var(--gradient-brand)', border: 'none', borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
        >
          {showNewJob ? <X size={12} /> : <Plus size={12} />}
          {showNewJob ? 'Cancel' : 'New Verification'}
        </button>
      </div>

      {/* ── Main Layout ──────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Sidebar: Execution History ────────────── */}
        <div style={{ width: 'var(--sidebar-width)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <ExecutionList
            executions={executions}
            selected={selected}
            onSelect={selectExecution}
            onRefresh={fetchList}
          />
        </div>

        {/* ── Right: Detail or New Job Panel ─────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Slide-in New Job panel */}
          {showNewJob && (
            <div style={{ width: 'var(--panel-width)', borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', overflow: 'auto', flexShrink: 0, animation: 'slide-in 0.15s ease' }}>
              <NewJobPanel apiBase={API} onJobSubmitted={onJobSubmitted} onClose={() => setShowNewJob(false)} />
            </div>
          )}

          {/* Execution Detail */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {selected
              ? <ExecutionDetail execution={selected} apiBase={API} loadingDetail={loadingDetail} />
              : <EmptyState onNew={() => setShowNewJob(true)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'var(--text-muted)', textDecoration: 'none', background: active ? 'var(--bg-elevated)' : 'transparent', transition: 'all 0.1s' }}>
      {children}
    </Link>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, animation: 'fade-in 0.2s ease' }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
        <Zap size={26} color="var(--text-muted)" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No execution selected</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Select one from the history or start a new verification</p>
      </div>
      <button onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: 'var(--gradient-brand)', border: 'none', borderRadius: 8, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Plus size={13} /> New Verification
      </button>
    </div>
  );
}
