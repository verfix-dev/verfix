'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import TopBar from '@/components/TopBar';


const API = 'http://localhost:3001';

type FlakyURL = {
  url: string;
  total_runs: number;
  pass_count: number;
  fail_count: number;
  flake_rate: number;
  avg_duration_ms: number;
  last_run: string;
};

export default function FlakyPage() {
  const [flaky, setFlaky] = useState<FlakyURL[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`${API}/api/v1/flaky`).then(r => r.json()).catch(() => ({ flaky: [] }));
    setFlaky(res.flaky || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar />
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={20} color="var(--accent-yellow)" /> Flaky Detection
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            URLs that have produced both passing and failing results — indicating non-deterministic behavior.
          </p>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</p>}

      {!loading && flaky.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No flaky URLs detected</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>All URLs that have been tested multiple times are producing consistent results.</p>
        </div>
      )}

      {flaky.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ padding: '8px 16px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--accent-yellow)' }}>
            ⚠ {flaky.length} URL{flaky.length !== 1 ? 's' : ''} detected with inconsistent results. These require investigation.
          </div>
          {flaky.map((f, i) => (
            <FlakyCard key={i} f={f} />
          ))}
        </div>
      )}
    </div>
    </div>
    </div>
  );
}

function FlakyCard({ f }: { f: FlakyURL }) {
  const flakeColor = f.flake_rate > 50 ? 'var(--accent-red)' : 'var(--accent-yellow)';
  return (
    <div style={{ padding: '14px 18px', background: 'var(--bg-surface)', border: `1px solid ${flakeColor}30`, borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} color={flakeColor} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            Last run: {new Date(f.last_run).toLocaleString()}
          </p>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: flakeColor, flexShrink: 0 }}>
          {f.flake_rate.toFixed(0)}% <span style={{ fontSize: 11, fontWeight: 500 }}>flake</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <Stat label="Total Runs" value={f.total_runs} color="var(--accent-blue)" />
        <Stat label="Passed" value={f.pass_count} color="var(--accent-green)" />
        <Stat label="Failed" value={f.fail_count} color="var(--accent-red)" />
        <Stat label="Avg Duration" value={`${Math.round(f.avg_duration_ms)}ms`} color="var(--accent-cyan)" />
      </div>
      {/* Sparkline */}
      <div style={{ marginTop: 10, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${100 - f.flake_rate}%`, background: 'var(--accent-green)', borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--accent-green)' }}>{f.pass_count} pass</span>
        <span style={{ fontSize: 10, color: 'var(--accent-red)' }}>{f.fail_count} fail</span>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ padding: '7px 10px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
