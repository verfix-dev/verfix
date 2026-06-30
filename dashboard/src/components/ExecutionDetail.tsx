'use client';
import { Execution, ExecutionEvent, AssertionResult } from '@/app/page';
import { useState } from 'react';
import { Activity, CheckCircle2, XCircle, Clock, Image, FileText, Network, Terminal, AlertTriangle, Download, Copy, Loader2, Sparkles, Play, Brain, Globe, ChevronLeft, ChevronRight } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';

type Tab = 'assertions' | 'console' | 'network' | 'artifacts' | 'ai' | 'replay' | 'exploration';

export default function ExecutionDetail({ execution: e, apiBase, loadingDetail }: {
  execution: Execution;
  apiBase: string;
  loadingDetail?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('assertions');
  const [copied, setCopied] = useState(false);
  const { flakyUrls, flakyExecutionIds } = useWorkspace();

  const isFlaky = flakyExecutionIds?.has(e.executionId);
  const flakyDetails = flakyUrls?.find(f => f.url === e.url && f.task === e.task);

  const isLive = e.status === 'running' || e.status === 'queued';
  const color = statusColor(e.status, e.passed);

  const copyId = () => {
    navigator.clipboard.writeText(e.executionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const errCount = (e.console_logs || []).filter(l => l.type === 'error').length;
  const netCount = (e.network_requests || []).length;
  const assertCount = (e.assertions || []).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', animation: 'fade-in 0.15s ease' }}>

      {/* ── Execution Header (compact) ────────────────────────── */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        {/* Title + URL + ID + Status in one row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <StatusIcon status={e.status} passed={e.passed} size={14} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.task || 'Untitled'}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 10 }}>
                <Globe size={9} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.url || '—'}</span>
                <span style={{ opacity: 0.35 }}>·</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>ID {e.executionId.slice(-8)}</span>
                <button onClick={copyId} title="Copy ID" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--accent-green)' : 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                  <Copy size={9} />
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {e.mode && (
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 99, background: 'rgba(167,139,250,0.1)', color: 'var(--accent-purple)', border: '1px solid rgba(167,139,250,0.35)' }}>
                {e.mode}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color, border: `1px solid ${color}35` }}>
              {isLive ? (e.status === 'running' ? '● Running' : '⏳ Queued') : e.passed ? '✓ Passed' : '✗ Failed'}
            </span>
            {e.duration_ms > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {e.duration_ms}ms · {e.retry_count} {e.retry_count === 1 ? 'retry' : 'retries'}
              </span>
            )}
          </div>
        </div>

        {/* Live banner */}
        {isLive && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(92,142,247,0.07)', borderRadius: 6, border: '1px solid rgba(92,142,247,0.18)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-blue)', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
            <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>Browser verification in progress — results will appear automatically</span>
          </div>
        )}

        {/* Error banner */}
        {e.error && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(248,113,113,0.07)', borderRadius: 6, border: '1px solid rgba(248,113,113,0.2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={12} color="var(--accent-red)" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--accent-red)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{e.error}</span>
          </div>
        )}

        {/* Unstable Target Diagnostics */}
        {isFlaky && flakyDetails && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(230,169,61,0.06)', borderRadius: 6, border: '1px solid rgba(230,169,61,0.25)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-yellow)' }}>
              <AlertTriangle size={12} aria-hidden="true" />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Unstable Results Detected</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              This verification flow gives <strong>different results each time</strong> it runs — it passes sometimes and fails with different errors other times. This usually means something about this specific check is unreliable, not that every test on this website is broken.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <CompactStat label="Failure Rate" value={`${flakyDetails.flake_rate.toFixed(0)}%`} color="var(--accent-yellow)" />
              <CompactStat label="Total Runs" value={flakyDetails.total_runs} color="var(--accent-blue)" />
              <CompactStat label="Passed" value={flakyDetails.pass_count} color="var(--accent-green)" />
              <CompactStat label="Failed" value={flakyDetails.fail_count} color="var(--accent-red)" />
              <CompactStat label="Avg Duration" value={`${Math.round(flakyDetails.avg_duration_ms)}ms`} color="var(--accent-cyan)" />
            </div>
            <div style={{ marginTop: 2, height: 3, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${100 - flakyDetails.flake_rate}%`, background: 'var(--accent-green)', borderRadius: 2 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '0 20px', flexShrink: 0 }}>
        {([
          ...(e.events && e.events.length > 0 ? [{ id: 'replay', label: 'Replay', icon: Play, count: e.events.length, badgeColor: 'var(--accent-cyan)' }] : []),
          ...(e.mode === 'exploratory' ? [{ id: 'exploration', label: 'Exploration', icon: Brain, count: 0, badgeColor: 'var(--accent-purple)' }] : []),
          ...(e.ai_summary ? [{ id: 'ai', label: 'AI Analysis', icon: Sparkles, count: 0, badgeColor: 'var(--accent-purple)' }] : []),
          { id: 'assertions', label: 'Assertions', icon: CheckCircle2, count: assertCount, badgeColor: (e.assertions||[]).every(a=>a.passed) && assertCount > 0 ? 'var(--accent-green)' : assertCount > 0 ? 'var(--accent-red)' : undefined },
          { id: 'console', label: 'Console', icon: Terminal, count: (e.console_logs||[]).length, badgeColor: errCount > 0 ? 'var(--accent-red)' : undefined },
          { id: 'network', label: 'Network', icon: Network, count: netCount, badgeColor: undefined },
          { id: 'artifacts', label: 'Artifacts', icon: Image, count: Object.values(e.artifacts||{}).filter(Boolean).length, badgeColor: undefined },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id as Tab)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === t.id ? 600 : 500, color: tab === t.id ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: tab === t.id ? '2px solid var(--accent-blue)' : '2px solid transparent', marginBottom: -1, fontFamily: 'inherit', transition: 'color 0.1s' }}>
            <t.icon size={11} />
            {t.label}
            {t.count > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: `${t.badgeColor || 'var(--text-muted)'}20`, color: t.badgeColor || 'var(--text-muted)', minWidth: 16, textAlign: 'center' }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        {loadingDetail && tab === 'assertions' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
            Loading execution details...
          </div>
        ) : (
          <>
            {tab === 'replay' && e.events && <ReplayTab execution={e} apiBase={apiBase} />}
            {tab === 'assertions' && <AssertionsTab execution={e} apiBase={apiBase} />}
            {tab === 'console' && <ConsoleTab execution={e} />}
            {tab === 'network' && <NetworkTab execution={e} />}
            {tab === 'artifacts' && <ArtifactsTab execution={e} apiBase={apiBase} />}
            {tab === 'exploration' && <ExplorationTab execution={e} />}
            {tab === 'ai' && e.ai_summary && <AITab execution={e} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Replay Tab ───────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { color: string; icon: React.FC<{size?: number}> }> = {
  assertion_failed:  { color: 'var(--accent-red)', icon: ({ size }) => <XCircle size={size} /> },
  assertion_passed:  { color: 'var(--accent-green)', icon: ({ size }) => <CheckCircle2 size={size} /> },
  navigation:        { color: 'var(--accent-cyan)', icon: ({ size }) => <Globe size={size} /> },
  action:            { color: 'var(--accent-blue)', icon: ({ size }) => <Activity size={size} /> },
  dom_change:        { color: 'var(--accent-purple)', icon: ({ size }) => <Sparkles size={size} /> },
  retry:             { color: 'var(--accent-yellow, #f59e0b)', icon: ({ size }) => <AlertTriangle size={size} /> },
  ai_reasoning:      { color: 'var(--accent-purple)', icon: ({ size }) => <Brain size={size} /> },
};

function ReplayTab({ execution: e, apiBase }: { execution: Execution; apiBase: string }) {
  const events = e.events || [];
  const [activeIdx, setActiveIdx] = useState(0);
  const activeEvent: ExecutionEvent | undefined = events[activeIdx];

  const counts = {
    total: events.length,
    captures: events.filter(ev => ev.screenshot).length,
    retries: events.filter(ev => ev.type === 'retry').length,
    failures: events.filter(ev => ev.type === 'assertion_failed').length,
  };

  // Filter console/network logs to within 2s of the active event
  const activeTime = activeEvent ? new Date(activeEvent.timestamp).getTime() : 0;
  const nextEventTime = events[activeIdx + 1] ? new Date(events[activeIdx + 1].timestamp).getTime() : activeTime + 60000;
  const windowLogs = (e.console_logs || []).filter(l => {
    const t = new Date(l.timestamp).getTime();
    return t >= activeTime - 50 && t <= nextEventTime + 50;
  });
  const windowNet = (e.network_requests || []).filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= activeTime - 50 && t <= nextEventTime + 50;
  });

  if (events.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No events recorded for this execution.</div>;
  }

  const getScreenshotUrl = (event?: ExecutionEvent | null) => {
    return formatArtifactUrl(apiBase, event?.screenshot);
  };

  const cleanMessage = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  const truncate = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}…` : value;
  const screenshotUrl = getScreenshotUrl(activeEvent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 420, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-surface)' }}>
        {/* Left: Event Timeline */}
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--bg-base)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '8px 10px 6px' }}>
            Signal Timeline · {events.length} events
          </div>
          {events.map((ev, idx) => {
            const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--text-muted)', icon: ({ size }: { size?: number }) => <Clock size={size} /> };
            const Ico = cfg.icon;
            const isActive = idx === activeIdx;
            const relTime = idx === 0 ? 0 : new Date(ev.timestamp).getTime() - new Date(events[0].timestamp).getTime();
            return (
              <button
                key={ev.id}
                onClick={() => setActiveIdx(idx)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '7px 10px',
                  background: isActive ? `${cfg.color}14` : 'transparent',
                  border: 'none', borderLeft: `2px solid ${isActive ? cfg.color : 'transparent'}`,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s', fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2, flexShrink: 0 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: `${cfg.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${isActive ? cfg.color : 'transparent'}` }}>
                    <Ico size={8} />
                  </div>
                  {idx < events.length - 1 && (
                    <div style={{ width: 1, height: 12, background: 'var(--border)', marginTop: 2 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400, lineHeight: 1.3, wordBreak: 'break-word' }}>
                    {truncate(cleanMessage(ev.message), 85)}
                  </div>
                  <div style={{ fontSize: 8, color: cfg.color, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                    +{relTime}ms · {ev.type.replace(/_/g, ' ')}{ev.capture_reason ? ` · capture: ${ev.capture_reason.replace(/_/g, ' ')}` : ''}
                  </div>
                </div>
                {ev.screenshot && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent-cyan)', flexShrink: 0, marginTop: 5 }} title="Has screenshot" />}
              </button>
            );
          })}
        </div>

        {/* Right: Active Event Detail */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent-blue) 4%, var(--bg-surface)), var(--bg-surface))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
            <button
              onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
              disabled={activeIdx === 0}
              className="replay-nav-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: activeIdx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: activeIdx === 0 ? 'not-allowed' : 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600, opacity: activeIdx === 0 ? 0.5 : 1, transition: 'all 0.15s' }}
            >
              <ChevronLeft size={13} />
              <span>Prev</span>
            </button>
            <button
              onClick={() => setActiveIdx(i => Math.min(events.length - 1, i + 1))}
              disabled={activeIdx === events.length - 1}
              className="replay-nav-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: activeIdx === events.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: activeIdx === events.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600, opacity: activeIdx === events.length - 1 ? 0.5 : 1, transition: 'all 0.15s' }}
            >
              <span>Next</span>
              <ChevronRight size={13} />
            </button>
            <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 6, padding: '2px 0' }}>
              {events.map((ev, idx) => {
                const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--text-muted)', icon: ({ size }: { size?: number }) => <Clock size={size} /> };
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={`tab_${ev.id}`}
                    onClick={() => setActiveIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px',
                      borderRadius: 999, border: `1px solid ${isActive ? cfg.color : 'var(--border)'}`,
                      background: isActive ? `${cfg.color}18` : 'var(--bg-elevated)',
                      color: isActive ? cfg.color : 'var(--text-secondary)',
                      cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10, fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                    <span>{truncate(cleanMessage(ev.message), 35)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'var(--bg-elevated)' }}>
            {screenshotUrl ? (
              <img
                src={screenshotUrl}
                alt="Step screenshot"
                style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'top', display: 'block' }}
                onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--text-muted)' }}>
                {activeEvent?.type === 'ai_reasoning' ? (
                  <>
                    <Brain size={24} color="var(--accent-purple)" style={{ opacity: 0.5 }} />
                    <div style={{ maxWidth: 480, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, textAlign: 'left', padding: '0 20px', whiteSpace: 'pre-wrap' }}>
                      <strong style={{ color: 'var(--accent-purple)', display: 'block', marginBottom: 6 }}>AI Reasoning Summary</strong>
                      {activeEvent.summary || (activeEvent.metadata?.summary as string) || cleanMessage(activeEvent.message)}
                    </div>
                  </>
                ) : (
                  <>
                    <Play size={20} style={{ opacity: 0.25 }} />
                    <span style={{ fontSize: 11 }}>No screenshot for this event</span>
                  </>
                )}
              </div>
            )}

            {activeEvent && (
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 99, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: (EVENT_CONFIG[activeEvent.type]?.color || 'var(--text-muted)') }}>
                  {activeEvent.type.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  #{activeIdx + 1}/{events.length}
                </span>
              </div>
            )}
          </div>

          <div style={{ height: 140, borderTop: '1px solid var(--border)', display: 'flex', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ flex: 1, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '6px 10px' }}>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>Console at this step ({windowLogs.length})</div>
              {windowLogs.length === 0 ? (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
              ) : windowLogs.map((l, i) => (
                <div key={i} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: l.type === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)', padding: '2px 0', borderBottom: '1px solid var(--border)', lineHeight: 1.5 }}>
                  <span style={{ opacity: 0.5 }}>[{l.type}]</span> {l.text.slice(0, 120)}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>Network at this step ({windowNet.length})</div>
              {windowNet.length === 0 ? (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
              ) : windowNet.map((r, i) => (
                <div key={i} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: r.status >= 400 ? 'var(--accent-red)' : 'var(--text-secondary)', padding: '2px 0', borderBottom: '1px solid var(--border)', lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700 }}>{r.status}</span> {r.method} {r.url.slice(0, 60)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI Tab ───────────────────────────────────────────────────────────────────

function AITab({ execution: e }: { execution: Execution }) {
  const summary = e.ai_summary;
  if (!summary) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--accent-purple)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Sparkles size={16} color="var(--accent-purple)" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Root Cause Analysis</h3>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Confidence: {(summary.confidence * 100).toFixed(0)}%</span>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 16 }}>
          {summary.likely_root_cause}
        </p>

        {summary.suggested_fix && (
          <div style={{ padding: '12px 16px', background: 'rgba(155,114,247,0.08)', borderRadius: 8, border: '1px solid rgba(155,114,247,0.2)' }}>
            <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-purple)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Suggested Fix</h4>
            <p style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {summary.suggested_fix}
            </p>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Evidence Considered</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {summary.evidence.map((ev, i) => (
            <li key={i}>{ev}</li>
          ))}
        </ul>
      </div>
      
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
        Generated by {summary.model}
      </div>
    </div>
  );
}

// ── Exploration Tab ─────────────────────────────────────────────────────────

function ExplorationTab({ execution: e }: { execution: Execution }) {
  const exploration = (e.assertions || []).find(a => a.type === 'exploration_result');
  const log = (exploration?.details as { log?: string[] } | undefined)?.log;

  if (!log || log.length === 0) {
    return <Empty icon={<Brain size={18} />} text="No exploration reasoning captured" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>Exploration Reasoning</div>
        <pre style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: 8, overflow: 'auto', lineHeight: 1.6, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap' }}>
          {log.join('\n')}
        </pre>
      </div>
    </div>
  );
}

// ── Assertions Tab ───────────────────────────────────────────────────────────
//
// Design notes:
// - Flow groups are rendered as distinct cards with a colored top bar and a
//   bold left border, making it easy to scan which flow failed.
// - Each flow is numbered sequentially (flows are ordered in the job), while
//   the top-level "General Checks" group uses a generic icon.
// - Assertion cards use a circular status badge and a colored left border to
//   reinforce pass/fail without relying solely on color.
// - Errors, fix hints, and details are visually tiered so the failure reason
//   is scannable.

function AssertionsTab({ execution: e, apiBase }: { execution: Execution; apiBase: string }) {
  const assertions = e.assertions || [];
  const isLive = e.status === 'running' || e.status === 'queued';

  if (isLive) {
    return <Empty icon={<Clock size={18} />} text="Waiting for assertions to complete..." />;
  }
  if (assertions.length === 0) {
    return <Empty icon={<CheckCircle2 size={18} />} text="No assertions recorded for this execution" />;
  }

  // Build ordered groups of assertions. Flow groups appear first, in the order
  // their first assertion was emitted by the worker; assertions without a
  // flow_name (top-level / default checks) are collected into a final
  // "General Checks" group so they remain visible at the bottom.
  const groupOrder: string[] = [];
  const groups = new Map<string, AssertionResult[]>();
  for (const a of assertions) {
    const key = a.flow_name || '__general__';
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(a);
  }

  const hasFlowGroups = groupOrder.some(k => k !== '__general__');

  // Backward-compatibility: executions produced before flow tagging (or runs
  // with only top-level assertions) have a single ungrouped list. Render the
  // legacy flat layout in that case so existing results are unchanged.
  if (!hasFlowGroups) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {assertions.map((a, i) => <AssertionCard key={i} a={a} apiBase={apiBase} />)}
      </div>
    );
  }

  // Determine the numeric index of each flow group (excluding the trailing
  // general group) so we can render a meaningful sequence marker.
  let flowIndex = 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groupOrder.map((key) => {
        const groupAssertions = groups.get(key)!;
        const passed = groupAssertions.filter(a => a.passed).length;
        const total = groupAssertions.length;
        const failed = total - passed;
        const allPassed = passed === total;
        const isGeneral = key === '__general__';
        const color = allPassed ? 'var(--accent-green)' : 'var(--accent-red)';

        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Flow group header card */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 10,
              border: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Sequence marker or generic icon */}
                <div style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: allPassed ? 'rgba(62,207,142,0.12)' : 'rgba(248,113,113,0.12)',
                  color, border: `1px solid ${color}30`,
                }}>
                  {isGeneral
                    ? <Activity size={12} />
                    : <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' }}>{flowIndex++}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {isGeneral ? 'General Checks' : `Flow “${key}”`}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {total} assertion{total !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Explicit status pill */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 99,
                background: allPassed ? 'rgba(62,207,142,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${color}30`, color,
              }}>
                {allPassed
                  ? <CheckCircle2 size={12} color={color} />
                  : <XCircle size={12} color={color} />}
                <span style={{ fontSize: 11, fontWeight: 700 }}>
                  {allPassed ? `${passed}/${total} passed` : `${passed}/${total} passed (${failed} failed)`}
                </span>
              </div>
            </div>

            {/* Group assertions */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              paddingLeft: 12, borderLeft: `2px solid ${allPassed ? 'rgba(62,207,142,0.2)' : 'rgba(248,113,113,0.2)'}`,
            }}>
              {groupAssertions.map((a, i) => <AssertionCard key={i} a={a} apiBase={apiBase} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Single assertion card. Extracted so both the grouped and legacy flat layouts
// render identical per-assertion markup.
function AssertionCard({ a, apiBase }: { a: AssertionResult; apiBase: string }) {
  const statusColor = a.passed ? 'var(--accent-green)' : 'var(--accent-red)';
  const statusBg = a.passed ? 'rgba(62,207,142,0.1)' : 'rgba(248,113,113,0.1)';
  const statusBorder = a.passed ? 'rgba(62,207,142,0.2)' : 'rgba(248,113,113,0.2)';
  const humanType = a.type.replace(/_/g, ' ');

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: 8, border: `1px solid ${statusBorder}`,
      borderLeft: `3px solid ${statusColor}`, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: statusBg,
        }}>
          {a.passed
            ? <CheckCircle2 size={12} color={statusColor} />
            : <XCircle size={12} color={statusColor} />}
        </div>
        <code style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1,
          textTransform: 'capitalize', letterSpacing: '0.01em',
        }}>{humanType}</code>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{a.duration_ms}ms</span>
        <span style={{
          fontSize: 9, fontWeight: 800, color: statusColor, padding: '3px 9px',
          background: statusBg, borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {a.passed ? 'Pass' : 'Fail'}
        </span>
      </div>
      {(a.error || a.fix_hint || a.details) && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
          {a.error && (
            <div style={{
              marginTop: 8, padding: '8px 11px', borderRadius: 6,
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)',
              fontSize: 11, color: 'var(--accent-red)', lineHeight: 1.5,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {a.error}
            </div>
          )}
          {a.fix_hint && (
            <div style={{
              marginTop: 8, padding: '8px 11px', borderRadius: 6,
              background: 'rgba(92,142,247,0.08)', border: '1px solid rgba(92,142,247,0.15)',
              fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>Fix hint:</span>{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{a.fix_hint}</span>
            </div>
          )}
          {a.details && (
            <pre style={{
              marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-elevated)',
              padding: '9px 11px', borderRadius: 6, overflow: 'auto', lineHeight: 1.6,
              fontFamily: 'JetBrains Mono, monospace', border: '1px solid var(--border)',
            }}>
              {JSON.stringify(a.details, null, 2)}
            </pre>
          )}
        </div>
      )}
      {a.screenshot_on_failure && (
        <div style={{ padding: '0 14px 12px' }}>
          <p style={{
            fontSize: 10, color: 'var(--text-muted)', marginBottom: 6,
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
          }}>Failure Screenshot</p>
          <img
            src={formatArtifactUrl(apiBase, a.screenshot_on_failure) || ''}
            alt="failure"
            style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
          />
        </div>
      )}
    </div>
  );
}

// ── Console Tab ──────────────────────────────────────────────────────────────

function ConsoleTab({ execution: e }: { execution: Execution }) {
  const [filter, setFilter] = useState<'all'|'error'|'warn'|'log'>('all');
  const logs = (e.console_logs || []).filter(l => filter === 'all' || l.type === filter);

  const counts = {
    all: (e.console_logs||[]).length,
    error: (e.console_logs||[]).filter(l=>l.type==='error').length,
    warn: (e.console_logs||[]).filter(l=>l.type==='warn').length,
    log: (e.console_logs||[]).filter(l=>l.type==='log'||l.type==='info').length,
  };

  if ((e.console_logs || []).length === 0) {
    return <Empty icon={<Terminal size={18} />} text="No console output captured" />;
  }

  const typeColor: Record<string, string> = { error: 'var(--accent-red)', warn: 'var(--accent-yellow)', info: 'var(--accent-cyan)', log: 'var(--text-secondary)' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {(['all','error','warn','log'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', borderColor: filter === f ? typeColor[f] || 'var(--accent-blue)' : 'var(--border)', background: filter === f ? `${typeColor[f] || 'var(--accent-blue)'}15` : 'transparent', color: filter === f ? typeColor[f] || 'var(--accent-blue)' : 'var(--text-muted)' }}>
            {f} ({counts[f as keyof typeof counts]})
          </button>
        ))}
      </div>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {logs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 12px', borderBottom: i < logs.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: typeColor[l.type] || 'var(--text-muted)', textTransform: 'uppercase', minWidth: 32, marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>{l.type}</span>
            <span style={{ fontSize: 11, color: typeColor[l.type] || 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', flex: 1, wordBreak: 'break-all', lineHeight: 1.5 }}>{l.text}</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }}>{new Date(l.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Network Tab ──────────────────────────────────────────────────────────────

function NetworkTab({ execution: e }: { execution: Execution }) {
  const [filter, setFilter] = useState<'all'|'error'>('all');
  const reqs = (e.network_requests || []).filter(r => filter === 'all' || r.status >= 400);

  if ((e.network_requests || []).length === 0) {
    return <Empty icon={<Network size={18} />} text="No network requests captured" />;
  }

  const errCount = (e.network_requests||[]).filter(r=>r.status>=400).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button onClick={() => setFilter('all')} style={filterBtn(filter === 'all')}>All ({(e.network_requests||[]).length})</button>
        <button onClick={() => setFilter('error')} style={{ ...filterBtn(filter === 'error'), borderColor: filter === 'error' ? 'var(--accent-red)' : 'var(--border)', color: filter === 'error' ? 'var(--accent-red)' : 'var(--text-muted)', background: filter === 'error' ? 'rgba(248,113,113,0.1)' : 'transparent' }}>Errors ({errCount})</button>
      </div>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '52px 52px 1fr', minWidth: 400 }}>
          {['Status', 'Method', 'URL'].map(h => (
            <div key={h} style={{ padding: '7px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', letterSpacing: '0.06em' }}>{h}</div>
          ))}
          {reqs.map((r, i) => {
            const sc = r.status >= 400 ? 'var(--accent-red)' : r.status >= 300 ? 'var(--accent-yellow)' : 'var(--accent-green)';
            return [
              <div key={`s${i}`} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, color: sc, borderBottom: '1px solid var(--border)', fontFamily: 'JetBrains Mono, monospace' }}>{r.status || '—'}</div>,
              <div key={`m${i}`} style={{ padding: '7px 12px', fontSize: 10, color: 'var(--accent-purple)', borderBottom: '1px solid var(--border)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{r.method}</div>,
              <div key={`u${i}`} style={{ padding: '7px 12px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', lineHeight: 1.4 }}>{r.url}</div>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}

// ── Artifacts Tab ────────────────────────────────────────────────────────────

function ArtifactsTab({ execution: e, apiBase }: { execution: Execution; apiBase: string }) {
  const arts = e.artifacts || {};
  const artEntries = Object.entries(arts).filter(([, v]) => v);

  if (artEntries.length === 0) {
    return <Empty icon={<FileText size={18} />} text="No artifacts collected for this execution" />;
  }

  const screenshot = arts.screenshot || arts.failed_screenshot;
  const screenshotUrl = formatArtifactUrl(apiBase, screenshot);

  return (
    <div>
      {screenshot && screenshotUrl && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Screenshot</p>
            <a href={screenshotUrl} download style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-blue)', textDecoration: 'none' }}>
              <Download size={11} /> Download
            </a>
          </div>
          <img
            src={screenshotUrl}
            alt="screenshot"
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
            onError={ev => { (ev.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {artEntries.map(([key, val]) => (
          <div key={key} style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{key.replace(/_/g, ' ')}</div>
            <div style={{ fontSize: 10, color: 'var(--accent-blue)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatArtifactUrl(apiBase: string, rawPath?: string | null): string | null {
  if (!rawPath) return null;
  const normalized = rawPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/artifacts/');
  const relPath = idx !== -1 ? normalized.substring(idx + 11) : normalized.split('/').pop();
  return `${apiBase}/artifacts/${relPath}`;
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '50px 20px', color: 'var(--text-muted)' }}>
      <span style={{ opacity: 0.35 }}>{icon}</span>
      <p style={{ fontSize: 13 }}>{text}</p>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-elevated)', borderRadius: 7, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function CompactStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'var(--bg-elevated)', borderRadius: 5, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color }}>{value}</div>
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

function filterBtn(active: boolean): React.CSSProperties {
  return { padding: '3px 8px', borderRadius: 4, border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`, fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: active ? 'rgba(92,142,247,0.1)' : 'transparent', color: active ? 'var(--accent-blue)' : 'var(--text-muted)' };
}
