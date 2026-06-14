'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import NewJobPanel from '@/components/NewJobPanel';
import ExecutionDetail from '@/components/ExecutionDetail';
import { Plus, Zap } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';

// Export all types from global types to maintain backward-compatibility with other components
export * from '@/types';

export default function Home() {
  return (
    <Suspense 
      fallback={
        <div 
          className="app-shell" 
          style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}
        >
          Loading...
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const {
    selected,
    setSelected,
    showNewJob,
    setShowNewJob,
    loadingDetail,
    setLoadingDetail,
    fetchDetail,
    setExecutions,
    startPolling,
    onJobSubmitted,
    apiBase,
  } = useWorkspace();

  const searchParams = useSearchParams();

  // Load list on initial mount of the workspace
  const { fetchList } = useWorkspace();
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Deep-link to an execution or new job panel from the query params
  useEffect(() => {
    const newParam = searchParams.get('new');
    const id = searchParams.get('executionId');

    if (newParam === 'true') {
      setShowNewJob(true);
      setSelected(null);
    } else if (id) {
      setShowNewJob(false);
      (async () => {
        setLoadingDetail(true);
        const full = await fetchDetail(id);
        if (full) {
          setSelected(full);
          setExecutions(prev => {
            const exists = prev.find(e => e.executionId === full.executionId);
            if (exists) {
              return prev.map(e => e.executionId === full.executionId ? { ...e, ...full } : e);
            }
            return [full, ...prev];
          });
          if (full.status === 'running' || full.status === 'queued') {
            startPolling(full.executionId);
          }
        }
        setLoadingDetail(false);
      })();
    }
  }, [searchParams, fetchDetail, setSelected, setShowNewJob, setExecutions, startPolling, setLoadingDetail]);

  return (
    <section className="workspace-main" aria-label="Execution workspace">
      {showNewJob ? (
        <div id="new-verification-panel" className="detail-panel new-job-workspace">
          <NewJobPanel apiBase={apiBase} onJobSubmitted={onJobSubmitted} onClose={() => setShowNewJob(false)} />
        </div>
      ) : (
        <div className="detail-panel canvas-grid">
          {selected ? (
            <ExecutionDetail execution={selected} apiBase={apiBase} loadingDetail={loadingDetail} />
          ) : (
            <EmptyState onNew={() => setShowNewJob(true)} />
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark">
        <Zap size={24} aria-hidden="true" />
      </div>
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          No execution selected
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Select a run from history or start a verification.
        </p>
      </div>
      <button type="button" onClick={onNew} className="primary-button">
        <Plus size={14} aria-hidden="true" /> New verification
      </button>
    </div>
  );
}
