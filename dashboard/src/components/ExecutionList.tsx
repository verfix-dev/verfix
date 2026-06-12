'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Loader2, RefreshCw, Search, XCircle, AlertTriangle } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Execution } from '@/types';

type FilterStatus = 'all' | 'running' | 'passed' | 'failed' | 'flaky';

const FILTERS: FilterStatus[] = ['all', 'running', 'passed', 'failed', 'flaky'];

export default function ExecutionList() {
  const {
    executions,
    selected,
    selectExecution,
    fetchList,
    flakyUrls,
  } = useWorkspace();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');

  const counts = useMemo(() => {
    const flakySet = new Set((flakyUrls || []).map(f => f.url));
    return {
      all: executions.length,
      running: executions.filter(e => e.status === 'running' || e.status === 'queued').length,
      passed: executions.filter(e => e.passed && e.status === 'completed').length,
      failed: executions.filter(e => !e.passed && (e.status === 'completed' || e.status === 'failed')).length,
      flaky: executions.filter(e => flakySet.has(e.url)).length,
    };
  }, [executions, flakyUrls]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const flakySet = new Set((flakyUrls || []).map(f => f.url));
    return executions.filter(e => {
      const matchSearch = !query || e.task.toLowerCase().includes(query) || e.url.toLowerCase().includes(query) || e.executionId.toLowerCase().includes(query);
      const matchFilter =
        filter === 'all' ? true :
        filter === 'passed' ? e.passed && e.status === 'completed' :
        filter === 'failed' ? !e.passed && (e.status === 'completed' || e.status === 'failed') :
        filter === 'flaky' ? flakySet.has(e.url) :
        e.status === 'running' || e.status === 'queued';
      return matchSearch && matchFilter;
    });
  }, [executions, filter, search, flakyUrls]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Run history</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{executions.length} executions tracked</div>
          </div>
          <button className="icon-button" type="button" onClick={fetchList} aria-label="Refresh executions" title="Refresh executions">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} aria-hidden="true" />
          <input
            aria-label="Search executions"
            className="control-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search task, URL, or ID"
            style={{ paddingLeft: 30 }}
          />
        </div>

        <div className="filter-pill-list" role="tablist" aria-label="Filter executions">
          {FILTERS.map(f => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className="filter-pill"
              data-active={filter === f}
              data-type={f}
            >
              <span>{f}</span>
              {counts[f] > 0 && (
                <span className="filter-pill-count">
                  {counts[f]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }} aria-live="polite">
        {filtered.length === 0 && (
          <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {search || filter !== 'all' ? 'No executions match this view.' : 'No executions yet. Start a verification to populate history.'}
          </div>
        )}
        {filtered.map(e => (
          <ExecutionRow 
            key={e.executionId} 
            execution={e} 
            isSelected={selected?.executionId === e.executionId} 
            onSelect={() => selectExecution(e)}
            isFlaky={(flakyUrls || []).some(f => f.url === e.url)}
          />
        ))}
      </div>
    </div>
  );
}

function ExecutionRow({ 
  execution: e, 
  isSelected, 
  onSelect,
  isFlaky
}: { 
  execution: Execution; 
  isSelected: boolean; 
  onSelect: () => void;
  isFlaky: boolean;
}) {
  const color = statusColor(e.status, e.passed);
  const isLive = e.status === 'running' || e.status === 'queued';
  const passedAssertions = (e.assertions || []).filter(a => a.passed).length;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      style={{
        width: '100%',
        display: 'block',
        textAlign: 'left',
        padding: '11px 14px',
        border: 0,
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-highlight)' : 'transparent',
        color: 'var(--text-primary)',
        animation: 'fade-in 120ms ease',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9 }}>
        <div style={{ paddingTop: 2 }}>
          <StatusIcon status={e.status} passed={e.passed} size={14} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.task || 'Untitled verification'}</div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{relativeTime(e.created_at)}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
            {e.url || 'No target URL'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: colorMix(color, 14), color, border: `1px solid ${colorMix(color, 34)}` }}>
            {isLive ? e.status : e.passed ? 'passed' : 'failed'}
          </span>
          {isFlaky && (
            <span 
              style={{ 
                fontSize: 9, 
                fontWeight: 800, 
                padding: '2px 6px', 
                borderRadius: 999, 
                background: 'rgba(230, 169, 61, 0.12)', 
                color: 'var(--accent-yellow)', 
                border: '1px solid rgba(230, 169, 61, 0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3
              }}
              title="URL has flaky history"
            >
              <AlertTriangle size={8} aria-hidden="true" /> flaky
            </span>
          )}
          {e.mode && <span style={{ fontSize: 10, fontWeight: 650, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{e.mode}</span>}
          {e.assertions?.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{passedAssertions}/{e.assertions.length} checks</span>}
        </div>
        {e.duration_ms > 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.duration_ms}ms</span>}
      </div>
    </button>
  );
}

function StatusIcon({ status, passed, size }: { status: string; passed: boolean; size: number }) {
  const color = statusColor(status, passed);
  if (status === 'running') return <Loader2 size={size} color={color} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />;
  if (status === 'queued') return <Clock size={size} color={color} aria-hidden="true" />;
  if (passed) return <CheckCircle2 size={size} color={color} aria-hidden="true" />;
  return <XCircle size={size} color={color} aria-hidden="true" />;
}

function statusColor(status: string, passed: boolean) {
  if (status === 'running') return 'var(--accent-blue)';
  if (status === 'queued') return 'var(--accent-yellow)';
  if (status === 'completed') return passed ? 'var(--accent-green)' : 'var(--accent-red)';
  return 'var(--accent-red)';
}

function colorMix(color: string, amount: number) {
  return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
}

function relativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}
