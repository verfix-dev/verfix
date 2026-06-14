'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Execution, FlakyURL } from '@/types';
import { getApiBase } from '@/lib/api';

const API = getApiBase();

interface WorkspaceContextProps {
  executions: Execution[];
  setExecutions: React.Dispatch<React.SetStateAction<Execution[]>>;
  selected: Execution | null;
  setSelected: (e: Execution | null) => void;
  showNewJob: boolean;
  setShowNewJob: (b: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (b: boolean) => void;
  loadingDetail: boolean;
  setLoadingDetail: (b: boolean) => void;
  flakyUrls: FlakyURL[];
  flakyExecutionIds: Set<string>;
  fetchList: () => Promise<void>;
  fetchDetail: (id: string) => Promise<Execution | null>;
  startPolling: (id: string) => void;
  onJobSubmitted: (id: string) => void;
  selectExecution: (e: Execution) => Promise<void>;
  apiBase: string;
}

const WorkspaceContext = createContext<WorkspaceContextProps | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelectedState] = useState<Execution | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [flakyUrls, setFlakyUrls] = useState<FlakyURL[]>([]);
  const [flakyExecutionIds, setFlakyExecutionIds] = useState<Set<string>>(new Set());

  const pollingRef = useRef<Set<string>>(new Set());
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Load sidebar collapse preference
  useEffect(() => {
    const saved = localStorage.getItem('verfix-sidebar-collapsed');
    if (saved === 'true') {
      setSidebarCollapsed(true);
    }
  }, []);

  const handleSetSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem('verfix-sidebar-collapsed', collapsed ? 'true' : 'false');
  };

  const setSelected = useCallback((e: Execution | null) => {
    setSelectedState(e);
    if (e) {
      setShowNewJob(false);
    }
  }, []);

  // Fetch full execution details (with assertions, logs, etc.)
  const fetchDetail = useCallback(async (id: string): Promise<Execution | null> => {
    try {
      const res = await fetch(`${API}/api/v1/executions/${id}`);
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Fetch executions list and flaky URLs
  const fetchList = useCallback(async () => {
    try {
      const [listRes, flakyRes] = await Promise.all([
        fetch(`${API}/api/v1/executions?limit=100`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/v1/flaky`).then(r => r.json()).catch(() => null),
      ]);

      if (flakyRes && flakyRes.flaky) {
        setFlakyUrls(flakyRes.flaky);
      }
      if (flakyRes && Array.isArray(flakyRes.failed_execution_ids)) {
        setFlakyExecutionIds(new Set(flakyRes.failed_execution_ids));
      }

      if (listRes && listRes.executions) {
        setExecutions(prev => {
          // Merge logic: preserve full details for already loaded ones, update status for the rest
          const map = new Map(prev.map(e => [e.executionId, e]));
          listRes.executions.forEach((e: Execution) => {
            const existing = map.get(e.executionId);
            if (!existing || existing.status === 'queued') {
              map.set(e.executionId, e);
            } else {
              map.set(e.executionId, { 
                ...existing, 
                status: e.status, 
                passed: e.passed, 
                duration_ms: e.duration_ms 
              });
            }
          });
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        });
      }
    } catch {}
  }, []);

  // Polling for live executions
  const startPolling = useCallback((id: string) => {
    if (pollingRef.current.has(id)) return;
    pollingRef.current.add(id);

    const interval = setInterval(async () => {
      const data = await fetchDetail(id);
      if (!data) return;

      setExecutions(prev => prev.map(e => e.executionId === id ? { ...e, ...data } : e));
      setSelectedState(prev => prev?.executionId === id ? data : prev);

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
        intervalsRef.current.delete(id);
        pollingRef.current.delete(id);
        // Refresh full list to update parent metrics/telemetry
        fetchList();
      }
    }, 2000);

    intervalsRef.current.set(id, interval);
  }, [fetchDetail, fetchList]);

  // Clean up polling intervals on unmount
  useEffect(() => {
    return () => {
      intervalsRef.current.forEach(clearInterval);
    };
  }, []);

  const onJobSubmitted = useCallback((id: string) => {
    const placeholder: Execution = {
      executionId: id,
      task: 'Initializing...',
      url: '',
      mode: 'strict',
      status: 'queued',
      passed: false,
      duration_ms: 0,
      retry_count: 0,
      assertions: [],
      artifacts: {},
      console_logs: [],
      network_requests: [],
      created_at: new Date().toISOString(),
    };
    setExecutions(prev => [placeholder, ...prev]);
    setSelectedState(placeholder);
    setShowNewJob(false);
    startPolling(id);
  }, [startPolling]);

  const selectExecution = useCallback(async (e: Execution) => {
    setSelected(e);
    router.push(`/?executionId=${e.executionId}`);

    if (e.status === 'completed' || e.status === 'failed') {
      if (!e.assertions || e.assertions.length === 0) {
        setLoadingDetail(true);
        const full = await fetchDetail(e.executionId);
        if (full) {
          setSelectedState(full);
          setExecutions(prev => prev.map(ex => ex.executionId === full.executionId ? { ...ex, ...full } : ex));
        }
        setLoadingDetail(false);
      }
    } else {
      startPolling(e.executionId);
    }
  }, [fetchDetail, startPolling, router, setSelected]);

  return (
    <WorkspaceContext.Provider
      value={{
        executions,
        setExecutions,
        selected,
        setSelected,
        showNewJob,
        setShowNewJob,
        sidebarCollapsed,
        setSidebarCollapsed: handleSetSidebarCollapsed,
        loadingDetail,
        setLoadingDetail,
        flakyUrls,
        flakyExecutionIds,
        fetchList,
        fetchDetail,
        startPolling,
        onJobSubmitted,
        selectExecution,
        apiBase: API,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
