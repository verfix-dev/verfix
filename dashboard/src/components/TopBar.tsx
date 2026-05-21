'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, BarChart2, AlertTriangle, ArrowLeft } from 'lucide-react';

const LINKS = [
  { href: '/', label: 'Executions', icon: null },
  { href: '/metrics', label: 'Metrics', icon: BarChart2 },
  { href: '/flaky', label: 'Flaky', icon: AlertTriangle },
];

export default function TopBar() {
  const path = usePathname();
  return (
    <div style={{ height: 44, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 0, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 20, borderRight: '1px solid var(--border)', marginRight: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--gradient-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={11} color="white" />
        </div>
        <span style={{ fontWeight: 700, fontSize: 13, background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.01em' }}>Verfix</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {LINKS.map(l => {
          const active = path === l.href;
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'var(--text-muted)', textDecoration: 'none', background: active ? 'var(--bg-elevated)' : 'transparent', transition: 'all 0.1s' }}>
              {Icon && <Icon size={11} />}
              {l.label}
            </Link>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>Phase 3</span>
    </div>
  );
}
