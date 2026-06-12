'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Moon, Sun, PanelLeft, Plus, X } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';

type Theme = 'dark' | 'light';

export default function TopBar() {
  const {
    executions,
    sidebarCollapsed,
    setSidebarCollapsed,
    showNewJob,
    setShowNewJob,
  } = useWorkspace();

  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const syncTheme = setTimeout(() => {
      const saved = window.localStorage.getItem('verfix-theme');
      const next: Theme = saved === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    }, 0);

    return () => clearTimeout(syncTheme);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('verfix-theme', next);
    setTheme(next);
  };

  // Calculate stats directly from workspace context
  const activeCount = executions.filter(e => e.status === 'running' || e.status === 'queued').length;
  const completedExecs = executions.filter(e => e.status === 'completed' || e.status === 'failed');
  const passRate = completedExecs.length > 0
    ? Math.round(completedExecs.filter(e => e.passed).length / completedExecs.length * 100)
    : undefined;

  return (
    <header className="topbar">
      {/* Sidebar Toggle Button */}
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

      {/* Toolbar Status & Cluster */}
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
        <button 
          className="icon-button" 
          type="button" 
          onClick={toggleTheme} 
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} 
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>


      </div>
    </header>
  );
}
