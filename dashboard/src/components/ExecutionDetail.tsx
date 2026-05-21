'use client';
import { Execution, ExecutionEvent } from '@/app/page';
import { useState } from 'react';
import { Activity, CheckCircle2, XCircle, Clock, Image, FileText, Network, Terminal, AlertTriangle, Download, Copy, Loader2, Sparkles, Play, Brain, Globe } from 'lucide-react';

type Tab = 'assertions' | 'console' | 'network' | 'artifacts' | 'ai' | 'replay' | 'exploration';

export default function ExecutionDetail({ execution: e, apiBase, loadingDetail }: {
  execution: Execution;
  apiBase: string;
  loadingDetail?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('assertions');
  const [copied, setCopied] = useState(false);

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

      {/* ── Execution Header ────────────────────────── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Status + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <StatusIcon status={e.status} passed={e.passed} size={15} />
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.task || 'Untitled'}</h2>
            </div>
            {/* URL */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11 }}>
              <Globe size={10} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.url || '—'}</span>
            </div>
          </div>
          {/* Right badges */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: `${color}18`, color, border: `1px solid ${color}35` }}>
              {isLive ? (e.status === 'running' ? '● Running' : '⏳ Queued') : e.passed ? '✓ Passed' : '✗ Failed'}
            </span>
            {e.duration_ms > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {e.duration_ms}ms · {e.retry_count} retries
              </span>
            )}
          </div>
        </div>

        {/* Execution ID bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>ID</span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.executionId}</span>
          <button onClick={copyId} title="Copy ID" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--accent-green)' : 'var(--text-muted)', padding: 2, display: 'flex', flexShrink: 0 }}>
            <Copy size={10} />
          </button>
        </div>

        {/* Stats row for completed */}
        {!isLive && !loadingDetail && assertCount > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <StatPill label="Assertions" value={`${(e.assertions||[]).filter(a=>a.passed).length}/${assertCount}`} color={(e.assertions||[]).every(a=>a.passed) ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <StatPill label="Console errors" value={errCount} color={errCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'} />
            <StatPill label="Requests" value={netCount} color="var(--accent-cyan)" />
            <StatPill label="Mode" value={e.mode || 'strict'} color="var(--accent-purple)" />
          </div>
        )}

        {/* Live banner */}
        {isLive && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(92,142,247,0.07)', borderRadius: 7, border: '1px solid rgba(92,142,247,0.18)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--accent-blue)' }}>Browser verification in progress — results will appear automatically</span>
          </div>
        )}

        {/* Error banner */}
        {e.error && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.07)', borderRadius: 7, border: '1px solid rgba(248,113,113,0.2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={12} color="var(--accent-red)" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--accent-red)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{e.error}</span>
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
    const rawPath = event?.screenshot || e.artifacts?.screenshot || e.artifacts?.failed_screenshot;
    if (!rawPath) return null;
    return `${apiBase}/artifacts/${rawPath.split('/artifacts/').pop()}`;
  };

  const cleanMessage = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  const truncate = (value: string, max: number) => value.length > max ? `${value.slice(0, max)}…` : value;
  const screenshotUrl = getScreenshotUrl(activeEvent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '16px 18px', background: 'linear-gradient(135deg, rgba(52,145,255,0.12), rgba(24,28,36,0.9))', borderRadius: 12, border: '1px solid rgba(100,116,139,0.35)', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 12px 40px rgba(15,23,42,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(148,163,184,0.9)' }}>Execution Intelligence Timeline</div>
            <div style={{ fontSize: 13, color: e.passed ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>{e.passed ? 'PASS' : 'FAIL'} · {e.duration_ms}ms · {e.retry_count} retries</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <StatPill label="Signals" value={counts.total} color="var(--accent-blue)" />
          <StatPill label="Captures" value={counts.captures} color="var(--accent-cyan)" />
          <StatPill label="Failures" value={counts.failures} color={counts.failures > 0 ? 'var(--accent-red)' : 'var(--accent-green)'} />
          <StatPill label="Retries" value={counts.retries} color={counts.retries > 0 ? 'var(--accent-yellow)' : 'var(--text-muted)'} />
        </div>

      </div>

      <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 500, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-surface)' }}>
          {/* Left: Event Timeline */}
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', paddingRight: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '10px 12px 8px' }}>
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
                    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '9px 12px',
                    background: isActive ? `${cfg.color}18` : 'transparent',
                    border: 'none', borderLeft: `2px solid ${isActive ? cfg.color : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2, flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: `${cfg.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${isActive ? cfg.color : 'transparent'}` }}>
                      <Ico size={9} />
                    </div>
                    {idx < events.length - 1 && (
                      <div style={{ width: 1, height: 14, background: 'var(--border)', marginTop: 2 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isActive ? 600 : 400, lineHeight: 1.3, wordBreak: 'break-word' }}>
                      {truncate(cleanMessage(ev.message), 90)}
                    </div>
                    <div style={{ fontSize: 9, color: cfg.color, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                      +{relTime}ms · {ev.type.replace(/_/g, ' ')}{ev.capture_reason ? ` · capture: ${ev.capture_reason.replace(/_/g, ' ')}` : ''}
                    </div>
                  </div>
                  {ev.screenshot && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-cyan)', flexShrink: 0, marginTop: 6 }} title="Has screenshot" />}
                </button>
              );
            })}
          </div>

          {/* Right: Active Event Detail */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'rgba(15,23,42,0.65)' }}>
              <button
                onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                disabled={activeIdx === 0}
                style={{ padding: '6px 10px', background: 'rgba(13,17,30,0.85)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
              >
                ← Prev
              </button>
              <button
                onClick={() => setActiveIdx(i => Math.min(events.length - 1, i + 1))}
                disabled={activeIdx === events.length - 1}
                style={{ padding: '6px 10px', background: 'rgba(13,17,30,0.85)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
              >
                Next →
              </button>
              <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: 8, padding: '2px 0' }}>
                {events.map((ev, idx) => {
                  const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--text-muted)', icon: ({ size }: { size?: number }) => <Clock size={size} /> };
                  const isActive = idx === activeIdx;
                  return (
                    <button
                      key={`tab_${ev.id}`}
                      onClick={() => setActiveIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                        borderRadius: 999, border: `1px solid ${isActive ? cfg.color : 'rgba(148,163,184,0.2)'}`,
                        background: isActive ? `${cfg.color}20` : 'rgba(15,23,42,0.6)',
                        color: isActive ? cfg.color : 'var(--text-secondary)',
                        cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 10,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                      <span>{truncate(cleanMessage(ev.message), 40)}</span>
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-muted)' }}>
                  {activeEvent?.type === 'ai_reasoning' ? (
                    <>
                      <Brain size={28} color="var(--accent-purple)" style={{ opacity: 0.6 }} />
                      <div style={{ maxWidth: 520, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, textAlign: 'left', padding: '0 24px', whiteSpace: 'pre-wrap' }}>
                        <strong style={{ color: 'var(--accent-purple)', display: 'block', marginBottom: 8 }}>AI Reasoning Summary</strong>
                        {activeEvent.summary || (activeEvent.metadata?.summary as string) || cleanMessage(activeEvent.message)}
                      </div>
                    </>
                  ) : (
                    <>
                      <Play size={24} style={{ opacity: 0.3 }} />
                      <span style={{ fontSize: 12 }}>No screenshot for this event</span>
                    </>
                  )}
                </div>
              )}

              {activeEvent && (
                <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, background: 'rgba(13,17,30,0.85)', backdropFilter: 'blur(6px)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: (EVENT_CONFIG[activeEvent.type]?.color || 'var(--text-muted)') }}>
                    {activeEvent.type.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                    #{activeIdx + 1}/{events.length}
                  </span>
                </div>
              )}

            </div>

            <div style={{ height: 180, borderTop: '1px solid var(--border)', display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '8px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>Console at this step ({windowLogs.length})</div>
                {windowLogs.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                ) : windowLogs.map((l, i) => (
                  <div key={i} style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: l.type === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)', padding: '2px 0', borderBottom: '1px solid var(--border)', lineHeight: 1.5 }}>
                    <span style={{ opacity: 0.5 }}>[{l.type}]</span> {l.text.slice(0, 120)}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>Network at this step ({windowNet.length})</div>
                {windowNet.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                ) : windowNet.map((r, i) => (
                  <div key={i} style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: r.status >= 400 ? 'var(--accent-red)' : 'var(--text-secondary)', padding: '2px 0', borderBottom: '1px solid var(--border)', lineHeight: 1.5 }}>
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
  const log = (exploration?.details as any)?.log as string[] | undefined;

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

function AssertionsTab({ execution: e, apiBase }: { execution: Execution; apiBase: string }) {
  const assertions = e.assertions || [];
  const isLive = e.status === 'running' || e.status === 'queued';

  if (isLive) {
    return <Empty icon={<Clock size={18} />} text="Waiting for assertions to complete..." />;
  }
  if (assertions.length === 0) {
    return <Empty icon={<CheckCircle2 size={18} />} text="No assertions recorded for this execution" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {assertions.map((a, i) => (
        <div key={i} style={{ background: 'var(--bg-surface)', borderRadius: 9, border: `1px solid ${a.passed ? 'rgba(62,207,142,0.2)' : 'rgba(248,113,113,0.2)'}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            {a.passed
              ? <CheckCircle2 size={14} color="var(--accent-green)" style={{ flexShrink: 0 }} />
              : <XCircle size={14} color="var(--accent-red)" style={{ flexShrink: 0 }} />}
            <code style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{a.type}</code>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{a.duration_ms}ms</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: a.passed ? 'var(--accent-green)' : 'var(--accent-red)', padding: '2px 7px', background: a.passed ? 'rgba(62,207,142,0.1)' : 'rgba(248,113,113,0.1)', borderRadius: 4 }}>
              {a.passed ? 'PASS' : 'FAIL'}
            </span>
          </div>
          {(a.error || a.details || a.fix_hint) && (
            <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
              {a.error && (
                <div style={{ marginTop: 8, padding: '7px 10px', background: 'rgba(248,113,113,0.07)', borderRadius: 6, fontSize: 11, color: 'var(--accent-red)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {a.error}
                </div>
              )}
              {a.fix_hint && (
                <div style={{ marginTop: 8, padding: '7px 10px', background: 'rgba(92,142,247,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>Fix hint:</span> {a.fix_hint}
                </div>
              )}
              {a.details && (
                <pre style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '8px 10px', borderRadius: 6, overflow: 'auto', lineHeight: 1.6, fontFamily: 'JetBrains Mono, monospace' }}>
                  {JSON.stringify(a.details, null, 2)}
                </pre>
              )}
            </div>
          )}
          {a.screenshot_on_failure && (
            <div style={{ padding: '0 14px 12px' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Failure Screenshot</p>
              <img
                src={`${apiBase}${a.screenshot_on_failure.replace(/.*\/artifacts/, '/artifacts')}`}
                alt="failure"
                style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
              />
            </div>
          )}
        </div>
      ))}
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

  return (
    <div>
      {screenshot && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Screenshot</p>
            <a href={`${apiBase}${screenshot.replace(/.*\/artifacts/, '/artifacts')}`} download style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-blue)', textDecoration: 'none' }}>
              <Download size={11} /> Download
            </a>
          </div>
          <img
            src={`${apiBase}${screenshot.replace(/.*\/artifacts/, '/artifacts')}`}
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
