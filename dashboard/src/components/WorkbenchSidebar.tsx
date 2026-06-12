'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart2, Plus, Zap } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import ExecutionList from './ExecutionList';

export default function WorkbenchSidebar() {
  const pathname = usePathname();
  const {
    executions,
    selected,
    showNewJob,
    setShowNewJob,
    setSelected,
    sidebarCollapsed,
    fetchList,
    selectExecution,
  } = useWorkspace();

  const handleNewVerificationClick = () => {
    setShowNewJob(true);
    setSelected(null);
  };

  const handleBrandClick = () => {
    setShowNewJob(false);
    setSelected(null);
  };

  return (
    <aside 
      className="sidebar-panel workbench-sidebar" 
      data-collapsed={sidebarCollapsed} 
      aria-label="Dashboard sidebar"
    >
      {/* Brand Header */}
      <div className="sidebar-brand-header">
        <Link href="/" className="sidebar-brand-link" onClick={handleBrandClick}>
          <div className="brand-mark">
            <Zap size={14} aria-hidden="true" />
          </div>
          <div className="brand-text-container">
            <div className="brand-name">Verfix</div>
            <div className="brand-subtitle">Verification runtime</div>
          </div>
        </Link>
      </div>

      {/* Primary Action */}
      <div className="sidebar-action-container">
        {sidebarCollapsed ? (
          <Link
            href="/?new=true"
            className="sidebar-action-button-collapsed"
            onClick={handleNewVerificationClick}
            data-active={showNewJob}
            aria-label="New verification"
            title="New verification"
          >
            <Plus size={14} aria-hidden="true" />
          </Link>
        ) : (
          <Link
            href="/?new=true"
            className="sidebar-action-button"
            onClick={handleNewVerificationClick}
            data-active={showNewJob}
          >
            <Plus size={15} aria-hidden="true" />
            <span>New verification</span>
          </Link>
        )}
      </div>

      {/* History Area */}
      <div className="sidebar-history-wrapper" aria-hidden={sidebarCollapsed}>
        {!sidebarCollapsed && (
          <ExecutionList />
        )}
      </div>

      {/* Footer Area */}
      <div className="sidebar-footer">
        {sidebarCollapsed ? (
          <Link
            href="/metrics"
            className="sidebar-footer-link-collapsed"
            data-active={pathname === '/metrics'}
            aria-label="Metrics & Health"
            title="Metrics & Health"
          >
            <BarChart2 size={16} aria-hidden="true" />
          </Link>
        ) : (
          <Link
            href="/metrics"
            className="sidebar-footer-link"
            data-active={pathname === '/metrics'}
          >
            <BarChart2 size={15} aria-hidden="true" />
            <span>Metrics & Health</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
