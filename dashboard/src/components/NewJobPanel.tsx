'use client';
import { useState } from 'react';
import { Play, Plus, Trash2, ChevronDown, ChevronUp, X, Settings2 } from 'lucide-react';

type Assertion = { type: string; selector?: string; value?: string };
type FlowStep = { action: string; testId?: string; selector?: string; value?: string };

const ASSERTION_TYPES = ['page_loaded','no_console_errors','selector_visible','text_visible','url_contains','title_contains','network_request_success'];
const NEEDS_SELECTOR = ['selector_visible'];
const NEEDS_VALUE = ['text_visible','url_contains','title_contains','network_request_success'];

const QUICK_PRESETS = [
  { label: 'Smoke Test', assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }] },
  { label: 'URL Check', assertions: [{ type: 'page_loaded' }, { type: 'url_contains', value: '' }] },
  { label: 'Full Check', assertions: [{ type: 'page_loaded' }, { type: 'no_console_errors' }, { type: 'selector_visible', selector: 'body' }] },
];

export default function NewJobPanel({ apiBase, onJobSubmitted, onClose }: {
  apiBase: string;
  onJobSubmitted: (id: string) => void;
  onClose?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'strict'|'assisted'|'smoke'|'exploratory'>('strict');
  const [assertions, setAssertions] = useState<Assertion[]>([{ type: 'page_loaded' }, { type: 'no_console_errors' }]);
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
    if (!url) { setError('Target URL is required'); return; }
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>New Verification</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Configure and run a browser verification job</p>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 4, display: 'flex' }}>
            <X size={14} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* URL */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Target URL *</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://localhost:3000"
            style={inputStyle}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        {/* Task */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Task Description</label>
          <input value={task} onChange={e => setTask(e.target.value)} placeholder="e.g. Verify login flow works" style={inputStyle} />
        </div>

        {/* Mode */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Mode</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['strict','assisted','smoke','exploratory'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid', fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s', borderColor: mode === m ? 'var(--accent-blue)' : 'var(--border)', background: mode === m ? 'rgba(92,142,247,0.12)' : 'var(--bg-elevated)', color: mode === m ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === 'exploratory' ? (
          <div style={{ marginBottom: 14, padding: '12px', background: 'rgba(155,114,247,0.1)', border: '1px solid rgba(155,114,247,0.3)', borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--accent-purple)', fontWeight: 600, marginBottom: 4 }}>🧭 Exploratory Mode</p>
            <p style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              The AI will autonomously navigate the page to achieve the Task Description. Assertions and Flows are disabled.
            </p>
          </div>
        ) : (
          <>
            {/* Assertions */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Assertions</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {QUICK_PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p)} style={{ padding: '2px 7px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {p.label}
                </button>
              ))}
              <button onClick={addAssertion} style={{ padding: '2px 7px', background: 'rgba(92,142,247,0.1)', border: '1px solid rgba(92,142,247,0.3)', borderRadius: 4, fontSize: 10, color: 'var(--accent-blue)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Plus size={9} /> Add
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {assertions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '6px 8px', background: 'var(--bg-elevated)', borderRadius: 7, border: '1px solid var(--border)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', flexShrink: 0 }} />
                <select value={a.type} onChange={e => updateAssertion(i, { type: e.target.value, selector: undefined, value: undefined })} style={{ ...selectStyle, flex: 1 }}>
                  {ASSERTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {NEEDS_SELECTOR.includes(a.type) && (
                  <input value={a.selector || ''} onChange={e => updateAssertion(i, { selector: e.target.value })} placeholder="CSS selector" style={{ ...inputStyle, flex: 1.2, padding: '4px 8px', fontSize: 11, marginBottom: 0 }} />
                )}
                {NEEDS_VALUE.includes(a.type) && (
                  <input value={a.value || ''} onChange={e => updateAssertion(i, { value: e.target.value })} placeholder="expected value" style={{ ...inputStyle, flex: 1.2, padding: '4px 8px', fontSize: 11, marginBottom: 0 }} />
                )}
                <button onClick={() => removeAssertion(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', borderRadius: 3, display: 'flex', flexShrink: 0 }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Flow Steps collapsible */}
        <div style={{ marginBottom: 4 }}>
          <button onClick={() => setShowFlows(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings2 size={12} /> Flow Steps {steps.length > 0 ? `(${steps.length})` : '— optional'}
            </span>
            {showFlows ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showFlows && (
            <div style={{ marginTop: 6, padding: '10px', background: 'var(--bg-elevated)', borderRadius: 7, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Steps execute before assertions. Use data-testid for reliable targeting.</p>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                  <select value={s.action} onChange={e => updateStep(i, { action: e.target.value })} style={{ ...selectStyle, width: 92 }}>
                    {['click','type','navigate','wait_for_selector'].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input value={s.testId || ''} onChange={e => updateStep(i, { testId: e.target.value })} placeholder="data-testid" style={{ ...inputStyle, flex: 1, padding: '4px 7px', fontSize: 11, marginBottom: 0 }} />
                  {s.action === 'type' && (
                    <input value={s.value || ''} onChange={e => updateStep(i, { value: e.target.value })} placeholder="text" style={{ ...inputStyle, flex: 0.8, padding: '4px 7px', fontSize: 11, marginBottom: 0 }} />
                  )}
                  <button onClick={() => removeStep(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
                  <button onClick={addStep} style={{ width: '100%', padding: '5px', background: 'none', border: '1px dashed var(--border)', borderRadius: 5, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', marginTop: 2 }}>
                    + Add step
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--accent-red)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={submit}
          disabled={loading}
          style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: loading ? 'var(--bg-elevated)' : 'var(--gradient-brand)', color: loading ? 'var(--text-muted)' : 'white', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'opacity 0.15s', fontFamily: 'inherit' }}
        >
          {loading
            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--text-muted)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> Submitting...</>
            : <><Play size={13} fill="white" /> Run Verification</>}
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, marginBottom: 0 };
const selectStyle: React.CSSProperties = { padding: '5px 6px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' };
