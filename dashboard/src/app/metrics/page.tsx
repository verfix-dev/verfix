'use client';
import { useEffect, useState } from 'react';
import { Activity, Clock, Zap, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import TopBar from '@/components/TopBar';


const API = 'http://localhost:3001';

type Metrics = {
  total_executions: number;
  pass_rate: number;
  fail_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  total_passed: number;
  total_failed: number;
  total_running: number;
  total_queued: number;
  executions_last_24h: number;
  avg_retries_per_run: number;
  flaky_url_count: number;
};

type DayTrend = { day: string; total: number; passed: number; avg_ms: number };
type TopFail = { url: string; failures: number };
type Health = { status: string; redis: string; database: string; queue_depth: number; active_workers: number };

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trend, setTrend] = useState<DayTrend[]>([]);
  const [topFailing, setTopFailing] = useState<TopFail[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [mRes, hRes] = await Promise.all([
      fetch(`${API}/api/v1/metrics`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/v1/health`).then(r => r.json()).catch(() => null),
    ]);
    if (mRes) { setMetrics(mRes.metrics); setTrend(mRes.daily_trend || []); setTopFailing(mRes.top_failing || []); }
    setHealth(hRes);
    setLoading(false);
  };

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (loading && !metrics) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TopBar />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', fontSize: 14 }}>Loading metrics...</div>
      </div>
    );
  }

  const maxTotal = Math.max(...trend.map(d => d.total), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar />
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Observability</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Real-time metrics and reliability tracking</p>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Health bar */}
      {health && (
        <div style={{ marginBottom: 20, padding: '10px 16px', background: health.status === 'healthy' ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${health.status === 'healthy' ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: health.status === 'healthy' ? 'var(--accent-green)' : 'var(--accent-yellow)', textTransform: 'uppercase' }}>● {health.status}</span>
          <HealthPill label="Redis" status={health.redis} />
          <HealthPill label="Database" status={health.database} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Queue depth: <b style={{ color: 'var(--text-primary)' }}>{health.queue_depth}</b></span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active workers: <b style={{ color: 'var(--text-primary)' }}>{health.active_workers}</b></span>
        </div>
      )}

      {/* Metric cards */}
      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <MetricCard label="Total Runs" value={metrics.total_executions} icon={<Activity size={16} />} color="var(--accent-blue)" />
          <MetricCard label="Pass Rate" value={`${metrics.pass_rate.toFixed(1)}%`} icon={<CheckCircle2 size={16} />} color="var(--accent-green)" sub={`${metrics.total_passed} passed`} />
          <MetricCard label="Fail Rate" value={`${metrics.fail_rate.toFixed(1)}%`} icon={<XCircle size={16} />} color="var(--accent-red)" sub={`${metrics.total_failed} failed`} />
          <MetricCard label="Avg Duration" value={`${Math.round(metrics.avg_duration_ms)}ms`} icon={<Clock size={16} />} color="var(--accent-cyan)" sub={`p95: ${Math.round(metrics.p95_duration_ms)}ms`} />
          <MetricCard label="Last 24h" value={metrics.executions_last_24h} icon={<Zap size={16} />} color="var(--accent-purple)" />
          <MetricCard label="Flaky URLs" value={metrics.flaky_url_count} icon={<AlertTriangle size={16} />} color="var(--accent-yellow)" sub="inconsistent results" />
          <MetricCard label="Avg Retries" value={metrics.avg_retries_per_run.toFixed(2)} icon={<RefreshCw size={16} />} color="var(--accent-blue)" />
          <MetricCard label="Running" value={metrics.total_running} icon={<Activity size={16} />} color={metrics.total_running > 0 ? 'var(--accent-blue)' : 'var(--text-muted)'} sub={`${metrics.total_queued} queued`} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 7-day bar chart */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>7-Day Trend</h2>
          {trend.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>No data yet. Run some verifications!</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
              {trend.map(d => {
                const passHeight = (d.passed / maxTotal) * 100;
                const totalHeight = (d.total / maxTotal) * 100;
                return (
                  <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', position: 'relative', height: 96, display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${totalHeight}%`, background: 'var(--bg-elevated)', borderRadius: '4px 4px 0 0', border: '1px solid var(--border)' }} />
                      <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${passHeight}%`, background: 'var(--accent-green)', borderRadius: '4px 4px 0 0', opacity: 0.8 }} />
                    </div>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>{d.day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <LegendDot color="var(--accent-green)" label="Passed" />
            <LegendDot color="var(--bg-elevated)" label="Total" border />
          </div>
        </div>

        {/* Top failing URLs */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>Top Failing URLs</h2>
          {topFailing.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>🎉 No failures yet!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topFailing.map((f, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 7, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{f.url}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-red)', flexShrink: 0 }}>{f.failures}✗</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, color, sub }: { label: string; value: string | number; icon: React.ReactNode; color: string; sub?: string }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function HealthPill({ label, status }: { label: string; status: string }) {
  const ok = status === 'ok';
  return (
    <span style={{ fontSize: 12, color: ok ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

function LegendDot({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, border: border ? '1px solid var(--border)' : 'none' }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}
