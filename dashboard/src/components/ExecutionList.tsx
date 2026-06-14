'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, X, RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Execution } from '@/types';

type FilterStatus = 'all' | 'running' | 'passed' | 'failed' | 'flaky';

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'all',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  flaky: 'unstable',
};

const FILTERS: FilterStatus[] = ['all', 'running', 'passed', 'failed', 'flaky'];

function groupByDate(items: Execution[]): { label: string; items: Execution[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 86400000;
  const weekMs = todayMs - 7 * 86400000;
  const groups: { label: string; items: Execution[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Past 7 days', items: [] },
    { label: 'Earlier', items: [] },
  ];
  items.forEach(e => {
    const t = new Date(e.created_at).getTime();
    if (t >= todayMs) groups[0].items.push(e);
    else if (t >= yesterdayMs) groups[1].items.push(e);
    else if (t >= weekMs) groups[2].items.push(e);
    else groups[3].items.push(e);
  });
  return groups.filter(g => g.items.length > 0);
}

export default function ExecutionList() {
  const { executions, selected, selectExecution, fetchList, flakyExecutionIds } = useWorkspace();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearch('');
        setFilter('all');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
      setFilter('all');
    }
  }, [searchOpen]);

  const flakySet = useMemo(() => flakyExecutionIds || new Set(), [flakyExecutionIds]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return executions.filter(e => {
      const matchSearch = !query
        || e.task.toLowerCase().includes(query)
        || e.url.toLowerCase().includes(query)
        || e.executionId.toLowerCase().includes(query);
      const matchFilter =
        filter === 'all' ? true :
        filter === 'passed' ? e.passed && e.status === 'completed' :
        filter === 'failed' ? !e.passed && (e.status === 'completed' || e.status === 'failed') :
        filter === 'flaky' ? flakySet.has(e.executionId) :
        e.status === 'running' || e.status === 'queued';
      return matchSearch && matchFilter;
    });
  }, [executions, filter, search, flakySet]);

  const groups = useMemo(() => groupByDate(executions), [executions]);

  return (
    <div className="sl-root">
      {/* ── Header ─────────────────────────────────── */}
      <div className="sl-header">
        <span className="sl-section-label">History</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className="sl-icon-btn"
            onClick={() => setSearchOpen(true)}
            title="Search (⌘K)"
            aria-label="Search verifications"
          >
            <Search size={13} />
          </button>
          <button
            className="sl-icon-btn"
            onClick={fetchList}
            title="Refresh"
            aria-label="Refresh history"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Grouped list ───────────────────────────── */}
      <div className="sl-scroll" aria-live="polite">
        {executions.length === 0 ? (
          <div className="sl-empty">No verifications yet.<br />Start one to see history here.</div>
        ) : (
          groups.map(({ label, items }) => (
            <div key={label} className="sl-group">
              <div className="sl-group-label">{label}</div>
              {items.map(e => (
                <ExecRow
                  key={e.executionId}
                  execution={e}
                  isSelected={selected?.executionId === e.executionId}
                  onSelect={() => selectExecution(e)}
                  isFlaky={flakySet.has(e.executionId)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── Search overlay ─────────────────────────── */}
      {searchOpen && (
        <div
          className="sl-search-overlay"
          role="dialog"
          aria-label="Search verifications"
          aria-modal="true"
        >
          <div className="sl-search-header">
            <div className="sl-search-input-wrap">
              <Search size={13} className="sl-search-icon" />
              <input
                ref={searchInputRef}
                className="sl-search-input"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tasks, URLs, IDs…"
                aria-label="Search verifications"
              />
              {search && (
                <button
                  className="sl-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="sl-filter-row" role="tablist" aria-label="Filter by status">
              {FILTERS.map(f => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className="sl-filter-chip"
                  data-active={filter === f}
                  title={f === 'flaky' ? 'Verification flows that pass sometimes and fail with different errors other times — results you can\'t rely on' : undefined}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="sl-search-results" aria-live="polite">
            {filtered.length === 0 ? (
              <div className="sl-empty">
                {search || filter !== 'all' ? 'No results found' : 'No verifications yet'}
              </div>
            ) : (
              filtered.map(e => (
                <ExecRow
                  key={e.executionId}
                  execution={e}
                  isSelected={selected?.executionId === e.executionId}
                  onSelect={() => { selectExecution(e); setSearchOpen(false); }}
                  isFlaky={flakySet.has(e.executionId)}
                />
              ))
            )}
          </div>

          <div className="sl-search-footer">
            <button className="sl-search-close-btn" onClick={() => setSearchOpen(false)}>
              <X size={12} /> Close
            </button>
            <span className="sl-search-hint">ESC · ⌘K</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ExecRow({
  execution: e,
  isSelected,
  onSelect,
  isFlaky,
}: {
  execution: Execution;
  isSelected: boolean;
  onSelect: () => void;
  isFlaky: boolean;
}) {
  const color = statusColor(e.status, e.passed);
  const isLive = e.status === 'running' || e.status === 'queued';

  return (
    <button
      type="button"
      onClick={onSelect}
      className="sl-exec-row"
      data-selected={isSelected}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className="sl-exec-dot" style={{ background: color }} />
      <div className="sl-exec-body">
        <div className="sl-exec-title">{e.task || 'Untitled verification'}</div>
        <div className="sl-exec-meta">
          {isLive ? (
            <><span className="sl-live-dot" />Running</>
          ) : (
            e.passed ? 'Passed' : 'Failed'
          )}
          {e.duration_ms > 0 && !isLive && ` · ${e.duration_ms}ms`}
          {isFlaky && <span className="sl-flaky-tag" title="This verification flow gives different results each time — it passes sometimes and fails with different errors other times"> · unstable</span>}
        </div>
      </div>
      <span className="sl-exec-time">{relativeTime(e.created_at)}</span>
    </button>
  );
}

function statusColor(status: string, passed: boolean) {
  if (status === 'running') return 'var(--accent-blue)';
  if (status === 'queued') return 'var(--accent-yellow)';
  if (status === 'completed') return passed ? 'var(--accent-green)' : 'var(--accent-red)';
  return 'var(--accent-red)';
}

function relativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}
