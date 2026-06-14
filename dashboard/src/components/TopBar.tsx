'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, Monitor, Moon, Sun, PanelLeft } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';

type ThemePref = 'system' | 'dark' | 'light';

const THEME_OPTIONS: { value: ThemePref; icon: React.ReactNode; label: string }[] = [
  { value: 'system', icon: <Monitor size={13} aria-hidden="true" />, label: 'System' },
  { value: 'dark',   icon: <Moon size={13} aria-hidden="true" />,    label: 'Dark'   },
  { value: 'light',  icon: <Sun size={13} aria-hidden="true" />,     label: 'Light'  },
];

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

export default function TopBar() {
  const { executions, sidebarCollapsed, setSidebarCollapsed } = useWorkspace();
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    const saved = (localStorage.getItem('verfix-theme') as ThemePref) || 'system';
    setPref(saved);
    document.documentElement.dataset.theme = resolveTheme(saved);
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.dataset.theme = e.matches ? 'light' : 'dark';
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [pref]);

  const setThemePref = useCallback((next: ThemePref) => {
    setPref(next);
    localStorage.setItem('verfix-theme', next);
    document.documentElement.dataset.theme = resolveTheme(next);
  }, []);

  const activeCount = executions.filter(e => e.status === 'running' || e.status === 'queued').length;
  const completedExecs = executions.filter(e => e.status === 'completed' || e.status === 'failed');
  const passRate = completedExecs.length > 0
    ? Math.round(completedExecs.filter(e => e.passed).length / completedExecs.length * 100)
    : undefined;

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button topbar-sidebar-toggle"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <PanelLeft size={15} aria-hidden="true" />
      </button>

      <div className="topbar-spacer" />

      <div className="toolbar-cluster" aria-label="Dashboard status">
        {activeCount > 0 && (
          <span className="status-chip">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', animation: 'pulse-dot 1.5s infinite' }} />
            {activeCount} active
          </span>
        )}
        {typeof passRate === 'number' && (
          <span className="status-chip optional" style={{ color: passRate >= 80 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
            <CheckCircle2 size={12} aria-hidden="true" />
            {passRate}% pass
          </span>
        )}

        <div className="theme-switcher" role="group" aria-label="Theme preference">
          {THEME_OPTIONS.map(({ value, icon, label }) => (
            <button
              key={value}
              type="button"
              className="theme-switcher-btn"
              data-active={pref === value}
              aria-pressed={pref === value}
              onClick={() => setThemePref(value)}
              title={label}
              aria-label={`${label} theme`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
