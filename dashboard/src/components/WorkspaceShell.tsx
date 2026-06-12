'use client';

import React from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import WorkbenchSidebar from './WorkbenchSidebar';
import TopBar from './TopBar';

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useWorkspace();

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <WorkbenchSidebar />
      <div className="app-main-container">
        <TopBar />
        <main className="dashboard-workspace-content">
          {children}
        </main>
      </div>
    </div>
  );
}
