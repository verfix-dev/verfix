'use client';
import { useState } from 'react';
import { Execution } from '@/app/page';
import { CheckCircle2, XCircle, Clock, Loader2, Search, Filter, RefreshCw } from 'lucide-react';

type FilterStatus = 'all' | 'passed' | 'failed' | 'running';

export default function ExecutionList({ executions, selected, onSelect, onRefresh }: {
  executions: Execution[];
  selected: Execution | null;
  onSelect: (e: Execution) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');

  const filtered = executions.filter(e => {
    const matchSearch = !search || e.task.toLowerCase().includes(search.toLowerCase()) || e.url.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all' ? true :
      filter === 'passed' ? e.passed && e.status === 'completed' :
      filter === 'failed' ? (!e.passed && (e.status === 'completed' || e.status === 'failed')) :
      e.status === 'running' || e.status === 'queued';
    return matchSearch && matchFilter;
  });

  const counts = {
    all: executions.length,
    running: executions.filter(e => e.status === 'running' || e.status === 'queued').length,
    passed: executions.filter(e => e.passed && e.status === 'completed').length,
    failed: executions.filter(e => !e.passed && (e.status === 'completed' || e.status === 'failed')).length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>History</span>
          <button onClick={onRefresh} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, borderRadius: 4, display: 'flex' }}>
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by task or URL..."
            style={{ width: '100%', padding: '6px 8px 6px 26px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
          />
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all','running','passed','failed'] as FilterStatus[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, padding: '4px 2px', borderRadius: 5, border: '1px solid', fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.1s', fontFamily: 'inherit', borderColor: filter === f ? filterColor(f) : 'var(--border)', background: filter === f ? `${filterColor(f)}15` : 'transparent', color: filter === f ? filterColor(f) : 'var(--text-muted)' }}>
              {f} {counts[f] > 0 && <span style={{ opacity: 0.7 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {search || filter !== 'all' ? 'No matching executions' : 'No executions yet. Start a new verification!'}
          </div>
        )}
        {filtered.map(e => (
          <ExecutionRow key={e.executionId} execution={e} isSelected={selected?.executionId === e.executionId} onClick={() => onSelect(e)} />
        ))}
      </div>
    </div>
  );
}

function ExecutionRow({ execution: e, isSelected, onClick }: { execution: Execution; isSelected: boolean; onClick: () => void }) {
  const color = statusColor(e.status, e.passed);
  const isLive = e.status === 'running' || e.status === 'queued';

  return (
    <div
      onClick={onClick}
      style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSelected ? 'var(--bg-highlight)' : 'transparent', borderLeft: `2px solid ${isSelected ? 'var(--accent-blue)' : 'transparent'}`, transition: 'all 0.1s', animation: 'slide-in 0.15s ease' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ marginTop: 1, flexShrink: 0 }}>
          <StatusIcon status={e.status} passed={e.passed} size={13} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
            {e.task || 'Untitled'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>
            {e.url || '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${color}15`, color, border: `1px solid ${color}30` }}>
            {isLive ? (e.status === 'running' ? '● running' : '⏳ queued') : e.passed ? '✓ pass' : '✗ fail'}
          </span>
          {e.mode && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{e.mode}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {e.duration_ms > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{e.duration_ms}ms</span>}
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{relativeTime(e.created_at)}</span>
        </div>
      </div>

      {/* Assertion mini bar */}
      {e.assertions && e.assertions.length > 0 && (e.status === 'completed' || e.status === 'failed') && (
        <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
          {e.assertions.map((a, i) => (
            <div key={i} title={`${a.type}: ${a.passed ? 'passed' : 'failed'}`} style={{ flex: 1, height: 3, borderRadius: 2, background: a.passed ? 'var(--accent-green)' : 'var(--accent-red)', opacity: 0.7 }} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status, passed, size }: { status: string; passed: boolean; size: number }) {
  const color = statusColor(status, passed);
  if (status === 'running') return <Loader2 size={size} color={color} style={{ animation: 'spin 1s linear infinite' }} />;
  if (status === 'queued') return <Clock size={size} color={color} />;
  if (passed) return <CheckCircle2 size={size} color={color} />;
  return <XCircle size={size} color={color} />;
}

function statusColor(status: string, passed: boolean) {
  if (status === 'running') return 'var(--accent-blue)';
  if (status === 'queued') return 'var(--accent-yellow)';
  if (status === 'completed') return passed ? 'var(--accent-green)' : 'var(--accent-red)';
  return 'var(--accent-red)';
}

function filterColor(f: string) {
  return f === 'running' ? 'var(--accent-blue)' : f === 'passed' ? 'var(--accent-green)' : f === 'failed' ? 'var(--accent-red)' : 'var(--text-secondary)';
}

function relativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
