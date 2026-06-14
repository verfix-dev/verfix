'use client';

import { useState } from 'react';
import { 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Compass, 
  Play, 
  Plus, 
  Settings2, 
  X, 
  Globe, 
  FileText, 
  Zap, 
  CheckSquare, 
  Activity, 
  Sparkles,
  Trash2
} from 'lucide-react';

type Assertion = { type: string; selector?: string; value?: string };
type FlowStep = { action: string; testId?: string; selector?: string; value?: string };

const ASSERTION_TYPES = [
  'page_loaded',
  'no_console_errors',
  'selector_visible',
  'text_visible',
  'url_contains',
  'title_contains',
  'network_request_success'
];
const NEEDS_SELECTOR = ['selector_visible'];
const NEEDS_VALUE = ['text_visible', 'url_contains', 'title_contains', 'network_request_success'];

const QUICK_PRESETS = [
  { label: 'Smoke Presets', assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }] },
  { label: 'Verify Target URL', assertions: [{ type: 'page_loaded' }, { type: 'url_contains', value: '' }] },
  { label: 'Verify Main Body', assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }, { type: 'selector_visible', selector: 'body' }] },
];

export default function NewJobPanel({ 
  apiBase, 
  onJobSubmitted, 
  onClose 
}: {
  apiBase: string;
  onJobSubmitted: (id: string) => void;
  onClose?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'strict' | 'assisted' | 'smoke' | 'exploratory'>('strict');
  const [assertions, setAssertions] = useState<Assertion[]>([
    { type: 'page_loaded' }, 
    { type: 'no_console_errors' }
  ]);
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFlows, setShowFlows] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    setAssertions(preset.assertions.map(a => ({ ...a })));
  };

  const addAssertion = () => setAssertions(a => [...a, { type: 'page_loaded' }]);
  const removeAssertion = (i: number) => setAssertions(a => a.filter((_, idx) => idx !== i));
  const updateAssertion = (i: number, patch: Partial<Assertion>) =>
    setAssertions(a => a.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const addStep = () => setSteps(s => [...s, { action: 'click', testId: '' }]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, patch: Partial<FlowStep>) =>
    setSteps(s => s.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const submit = async () => {
    if (!url) { 
      setError('Target URL is required'); 
      return; 
    }
    if (mode === 'exploratory' && !task.trim()) {
      setError('Task Description is required for exploratory mode');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const flows = mode !== 'exploratory' && steps.length > 0 ? [{
        name: 'main',
        steps: steps.map(s => ({
          action: s.action,
          target: s.testId ? { testId: s.testId } : s.selector ? { selector: s.selector } : undefined,
          value: s.value,
        }))
      }] : undefined;

      const payload = mode === 'exploratory'
        ? { url: url.trim(), task: task.trim(), mode }
        : { url: url.trim(), task: task.trim() || `Verify ${url.trim()}`, mode, assertions, flows };

      const res = await fetch(`${apiBase}/api/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.executionId) {
        onJobSubmitted(data.executionId);
      } else {
        setError(data.error || 'Failed to submit');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit verification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-verification-container">
      <div className="new-verification-card">
        {/* Card Header */}
        <div style={{ padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, height: 'var(--topbar-height)', minHeight: 'var(--topbar-height)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={13} color="var(--accent-blue)" aria-hidden="true" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>New Verification</span>
          </div>
          {onClose && (
            <button 
              className="icon-button" 
              type="button" 
              onClick={onClose} 
              aria-label="Close" 
              style={{ width: 28, height: 28 }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Card Body */}
        <div className="new-verification-body-container">
          <div className="new-verification-form-wrapper">
            {/* Target URL */}
            <div className="form-group">
              <label className="field-label" htmlFor="verification-url">Target URL *</label>
              <div className="input-with-icon">
                <div className="input-icon-wrapper">
                  <Globe size={14} />
                </div>
                <input
                  id="verification-url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="form-input-premium"
                  aria-invalid={error === 'Target URL is required'}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </div>
            </div>

            {/* Task Description */}
            <div className="form-group">
              <label className="field-label" htmlFor="verification-task">Task / Intent Description</label>
              <div className="input-with-icon">
                <div className="input-icon-wrapper">
                  <FileText size={14} />
                </div>
                <input 
                  id="verification-task" 
                  value={task} 
                  onChange={e => setTask(e.target.value)} 
                  placeholder="Verify the authentication flow works and displays the landing dashboard" 
                  className="form-input-premium" 
                />
              </div>
            </div>

            {/* Mode Selection */}
            <div className="form-group">
              <label className="field-label">Mode</label>
              <div className="mode-tab-row" role="radiogroup" aria-label="Verification mode">
                {([
                  { value: 'smoke',       label: 'Smoke',       icon: <Zap size={11} aria-hidden="true" /> },
                  { value: 'strict',      label: 'Strict',      icon: <CheckSquare size={11} aria-hidden="true" /> },
                  { value: 'assisted',    label: 'AI-Assisted', icon: <Activity size={11} aria-hidden="true" /> },
                  { value: 'exploratory', label: 'Exploratory', icon: <Compass size={11} aria-hidden="true" /> },
                ] as { value: typeof mode; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className="mode-tab-btn"
                    data-active={mode === value}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Dynamic Mode Helper Alert */}
              <div className="mode-helper-alert" data-mode={mode}>
                <div className="mode-helper-icon">
                  {mode === 'smoke' && <Zap size={13} />}
                  {mode === 'strict' && <CheckSquare size={13} />}
                  {mode === 'assisted' && <Activity size={13} />}
                  {mode === 'exploratory' && <Compass size={13} />}
                </div>
                <div className="mode-helper-content">
                  <strong>{mode === 'smoke' ? 'Smoke Test Mode' : mode === 'strict' ? 'Strict Mode' : mode === 'assisted' ? 'AI-Assisted Mode' : 'Exploratory Mode'}</strong> — {
                    mode === 'smoke' ? 'Verifies if target site loads completely, checking for TLS issues, network timeouts, and critical console errors. Best for rapid availability checks.' :
                    mode === 'strict' ? 'Executes assertion checklist and step sequences in exact chronological order. Ideal for regression test cases and formal login/signup scripts.' :
                    mode === 'assisted' ? 'Maintains strict step validations but automatically attempts selectors fallbacks and semantic matching if standard selectors change.' :
                    'Deploys a browser agent to autonomously explore paths to accomplish your specified Intent/Task Description. Useful for discovery testing.'
                  }
                </div>
              </div>
            </div>

            {mode === 'exploratory' ? (
              <div className="panel-section" style={{ marginBottom: 18, padding: '16px', background: 'rgba(155,108,255,0.06)', border: '1px solid rgba(155,108,255,0.2)' }}>
                <p style={{ fontSize: 13, color: 'var(--accent-purple)', fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} aria-hidden="true" /> Autonomous Agent Active
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Custom assertions and step flows are disabled. The AI agent will navigate freely to achieve your specified Task Intent.
                </p>
              </div>
            ) : (
              <>
                {/* Assertions */}
                <div className="form-group" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                    <label className="field-label" style={{ marginBottom: 0 }}>Assertions / Verification Checks</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {QUICK_PRESETS.map(p => (
                        <button 
                          key={p.label} 
                          type="button" 
                          onClick={() => applyPreset(p)} 
                          className="preset-tag"
                        >
                          {p.label}
                        </button>
                      ))}
                      <button 
                        type="button" 
                        onClick={addAssertion} 
                        className="preset-tag" 
                        style={{ color: 'var(--accent-blue)', borderColor: 'rgba(79,140,255,0.3)', background: 'rgba(79,140,255,0.04)' }}
                      >
                        <Plus size={10} style={{ marginRight: 2 }} aria-hidden="true" /> Add Custom
                      </button>
                    </div>
                  </div>

                  <div className="assertions-list-container">
                    {assertions.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                        No checks defined. Click "Add Custom" to create verification assertions.
                      </div>
                    ) : (
                      assertions.map((a, i) => (
                        <div key={i} className="assertion-row-card">
                          <div className="assertion-indicator-dot" />
                          <select 
                            aria-label={`Assertion ${i + 1} type`} 
                            value={a.type} 
                            onChange={e => updateAssertion(i, { type: e.target.value, selector: undefined, value: undefined })} 
                            className="inline-row-select" 
                            style={{ flex: 1.2 }}
                          >
                            {ASSERTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                          </select>
                          {NEEDS_SELECTOR.includes(a.type) && (
                            <input 
                              aria-label={`Assertion ${i + 1} CSS selector`} 
                              value={a.selector || ''} 
                              onChange={e => updateAssertion(i, { selector: e.target.value })} 
                              placeholder="CSS selector (.btn-submit)" 
                              className="inline-row-input" 
                              style={{ flex: 1.5 }} 
                            />
                          )}
                          {NEEDS_VALUE.includes(a.type) && (
                            <input 
                              aria-label={`Assertion ${i + 1} expected value`} 
                              value={a.value || ''} 
                              onChange={e => updateAssertion(i, { value: e.target.value })} 
                              placeholder="Expected content text" 
                              className="inline-row-input" 
                              style={{ flex: 1.5 }} 
                            />
                          )}
                          <button 
                            type="button" 
                            onClick={() => removeAssertion(i)} 
                            className="icon-button" 
                            aria-label={`Remove assertion ${i + 1}`} 
                            style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 6, color: 'var(--accent-red)', borderColor: 'transparent', background: 'transparent' }}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Flow Steps collapsible */}
                <div style={{ marginBottom: 14 }}>
                  <button 
                    type="button" 
                    onClick={() => setShowFlows(v => !v)} 
                    className="collapsible-trigger-button" 
                    aria-expanded={showFlows}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Settings2 size={14} aria-hidden="true" /> 
                      <span>Pre-Execution Actions {steps.length > 0 ? `(${steps.length})` : '(Optional)'}</span>
                    </span>
                    {showFlows ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  </button>

                  {showFlows && (
                    <div className="collapsible-content-panel">
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Define sequence steps (clicks, typing, navigations) to perform before assertions run.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {steps.map((s, i) => (
                          <div key={i} className="step-row-card">
                            <span className="step-index-badge">#{i + 1}</span>
                            <select 
                              aria-label={`Flow step ${i + 1} action`} 
                              value={s.action} 
                              onChange={e => updateStep(i, { action: e.target.value })} 
                              className="inline-row-select" 
                              style={{ width: 140 }}
                            >
                              {['click', 'type', 'navigate', 'wait_for_selector'].map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                            </select>
                            <input 
                              aria-label={`Flow step ${i + 1} target`} 
                              value={s.testId || ''} 
                              onChange={e => updateStep(i, { testId: e.target.value })} 
                              placeholder="Selector or data-testid" 
                              className="inline-row-input" 
                              style={{ flex: 1.2 }} 
                            />
                            {s.action === 'type' && (
                              <input 
                                aria-label={`Flow step ${i + 1} text value`} 
                                value={s.value || ''} 
                                onChange={e => updateStep(i, { value: e.target.value })} 
                                placeholder="Text value" 
                                className="inline-row-input" 
                                style={{ flex: 0.8 }} 
                              />
                            )}
                            <button 
                              type="button" 
                              onClick={() => removeStep(i)} 
                              className="icon-button" 
                              aria-label={`Remove flow step ${i + 1}`} 
                              style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 6, color: 'var(--accent-red)', borderColor: 'transparent', background: 'transparent' }}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button 
                        type="button" 
                        onClick={addStep} 
                        className="add-step-button"
                      >
                        <Plus size={12} style={{ marginRight: 2 }} aria-hidden="true" /> Add Step Action
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {error && (
              <div 
                role="alert" 
                style={{ 
                  marginTop: 16, 
                  padding: '10px 14px', 
                  background: 'rgba(255,107,107,0.06)', 
                  border: '1px solid rgba(255,107,107,0.25)', 
                  borderRadius: 8, 
                  fontSize: 12, 
                  color: 'var(--accent-red)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8 
                }}
              >
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="primary-button"
            style={{ gap: 7, fontSize: 12, minHeight: 34, padding: '0 18px' }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', width: 11, height: 11, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                <span>Submitting…</span>
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" aria-hidden="true" />
                <span>Launch Verification</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
