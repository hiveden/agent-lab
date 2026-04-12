'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Source {
  id: string;
  agent_id: string;
  source_type: string;
  name: string;
  config: Record<string, unknown>;
  attention_weight: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface EditingSource {
  name: string;
  source_type: string;
  config: string; // JSON string for editing
  attention_weight: number;
  enabled: boolean;
}

const CONFIG_TEMPLATES: Record<string, string> = {
  'hacker-news': JSON.stringify({ limit: 30 }, null, 2),
  'http': JSON.stringify({
    url: 'https://api.github.com/search/repositories?q=created:%3E2026-04-01&sort=stars&order=desc&per_page=10',
    method: 'GET',
    items_path: 'items',
    mapping: { external_id: 'full_name', title: 'full_name', url: 'html_url' },
  }, null, 2),
  'rss': JSON.stringify({ feed_url: 'https://example.com/feed', limit: 20 }, null, 2),
  'grok': JSON.stringify({
    accounts: ['karpathy', 'swyx'],
    batch_size: 10,
    api_url: 'https://api.apiyi.com/v1/responses',
    model: 'grok-4-fast-non-reasoning',
  }, null, 2),
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  'hacker-news': 'Hacker News',
  'http': 'HTTP API (通用)',
  'rss': 'RSS / Atom',
  'grok': 'Grok (Twitter/X)',
};

function SourceTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'hacker-news':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2" y="2" width="20" height="20" rx="3" />
          <text x="12" y="17" textAnchor="middle" fill="currentColor" stroke="none" fontSize="14" fontWeight="bold">Y</text>
        </svg>
      );
    case 'http':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      );
    case 'rss':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 11a9 9 0 0118 0" />
          <path d="M4 4a16 16 0 0118 0" />
          <circle cx="5" cy="19" r="2" />
        </svg>
      );
    case 'grok':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4m0 4h.01" />
        </svg>
      );
  }
}

function getConfigSummary(source: Source): string {
  const c = source.config;
  switch (source.source_type) {
    case 'hacker-news':
      return `limit: ${c.limit ?? '?'}`;
    case 'http': {
      try {
        const url = new URL(String(c.url ?? ''));
        return url.hostname;
      } catch {
        return String(c.url ?? 'HTTP');
      }
    }
    case 'rss': {
      try {
        const url = new URL(String(c.feed_url ?? ''));
        return url.hostname;
      } catch {
        return String(c.feed_url ?? 'RSS');
      }
    }
    case 'grok': {
      const accounts = c.accounts as string[] | undefined;
      return accounts ? `${accounts.length} accounts` : 'Grok';
    }
    default:
      return source.source_type;
  }
}

export default function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditingSource | null>(null);
  const [adding, setAdding] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; count?: number; items?: unknown[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [newForm, setNewForm] = useState<EditingSource>({
    name: '',
    source_type: 'hacker-news',
    config: CONFIG_TEMPLATES['hacker-news'],
    attention_weight: 0,
    enabled: true,
  });

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sources?agent_id=radar');
      const data = (await res.json()) as { sources?: Source[] };
      setSources(data.sources ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const totalWeight = sources.reduce((sum, s) => sum + s.attention_weight, 0);

  const handleEdit = (s: Source) => {
    setEditing(s.id);
    setEditForm({
      name: s.name,
      source_type: s.source_type,
      config: JSON.stringify(s.config, null, 2),
      attention_weight: s.attention_weight,
      enabled: s.enabled,
    });
  };

  const handleSave = async () => {
    if (!editing || !editForm) return;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(editForm.config);
    } catch {
      return;
    }
    await fetch(`/api/sources/${editing}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name,
        config,
        attention_weight: editForm.attention_weight,
        enabled: editForm.enabled,
      }),
    });
    setEditing(null);
    setEditForm(null);
    fetchSources();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    fetchSources();
  };

  const handleTypeChange = (type: string) => {
    setNewForm({
      ...newForm,
      source_type: type,
      config: CONFIG_TEMPLATES[type] || '{}',
    });
    setTestResult(null);
  };

  const handleTest = async () => {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(newForm.config);
    } catch {
      setTestResult({ ok: false, error: 'Invalid JSON config' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/sources/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source_type: newForm.source_type, config }),
      });
      const data = (await res.json()) as { ok: boolean; count?: number; items?: unknown[]; error?: string };
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = async () => {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(newForm.config);
    } catch {
      return;
    }
    await fetch('/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'radar',
        source_type: newForm.source_type,
        name: newForm.name,
        config,
        attention_weight: newForm.attention_weight,
        enabled: newForm.enabled,
      }),
    });
    setAdding(false);
    setNewForm({ name: '', source_type: 'hacker-news', config: '{}', attention_weight: 0, enabled: true });
    fetchSources();
  };

  const handleToggle = async (s: Source) => {
    await fetch(`/api/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    fetchSources();
  };

  if (loading) {
    return <div className="max-w-[900px]"><p className="text-[var(--ag-text-2)] text-[13px] py-8 text-center">Loading sources…</p></div>;
  }

  return (
    <div className="max-w-[900px]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold m-0">Sources</h2>
        <button className="sources-btn primary" onClick={() => setAdding(true)}>+ Add Source</button>
      </div>

      {/* Weight bar */}
      {sources.length > 0 && (
        <div className="mb-5">
          <div className="weight-bar">
            {sources.filter(s => s.enabled).map((s) => (
              <div
                key={s.id}
                className="weight-segment"
                style={{ flex: s.attention_weight || 0.01 }}
                title={`${s.name}: ${(s.attention_weight * 100).toFixed(0)}%`}
              >
                <span className="weight-label">{s.name}</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-[var(--ag-text-2)] mt-1">
            Total: {(totalWeight * 100).toFixed(0)}%
            {Math.abs(totalWeight - 1) > 0.01 && (
              <span className="text-[#e55]"> (should be 100%)</span>
            )}
          </div>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="source-form">
          <div className="form-row">
            <label>Name</label>
            <input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="e.g. Hacker News" />
          </div>
          <div className="form-row">
            <label>Type</label>
            <select value={newForm.source_type} onChange={(e) => handleTypeChange(e.target.value)}>
              {Object.entries(SOURCE_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Config (JSON)</label>
            <textarea value={newForm.config} onChange={(e) => setNewForm({ ...newForm, config: e.target.value })} rows={3} />
          </div>
          <div className="form-row">
            <label>Weight: {(newForm.attention_weight * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={1} step={0.05} value={newForm.attention_weight} onChange={(e) => setNewForm({ ...newForm, attention_weight: Number(e.target.value) })} />
          </div>
          <div className="form-actions">
            <button className="sources-btn" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button className="sources-btn primary" onClick={handleAdd}>Create</button>
            <button className="sources-btn" onClick={() => { setAdding(false); setTestResult(null); }}>Cancel</button>
          </div>
          {testResult && (
            <div className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
              {testResult.ok ? (
                <>
                  <div className="test-ok">Fetched {testResult.count} items</div>
                  {(testResult.items as Array<Record<string, unknown>> | undefined)?.map((item, i) => (
                    <div key={i} className="test-item">{String((item as Record<string, unknown>).title ?? '')}</div>
                  ))}
                </>
              ) : (
                <div className="test-fail">{testResult.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sources grid */}
      <div className="sources-grid">
        {sources.map((s) => (
          <div key={s.id} className={cn('source-card', !s.enabled && 'disabled')}>
            {editing === s.id && editForm ? (
              <div className="source-card-edit">
                <div className="form-row">
                  <label>Name</label>
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Config (JSON)</label>
                  <textarea value={editForm.config} onChange={(e) => setEditForm({ ...editForm, config: e.target.value })} rows={3} />
                </div>
                <div className="form-row">
                  <label>Weight: {(editForm.attention_weight * 100).toFixed(0)}%</label>
                  <input type="range" min={0} max={1} step={0.05} value={editForm.attention_weight} onChange={(e) => setEditForm({ ...editForm, attention_weight: Number(e.target.value) })} />
                </div>
                <div className="form-row">
                  <label>Enabled</label>
                  <button className="toggle-btn" onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}>
                    {editForm.enabled ? '✓' : '✗'}
                  </button>
                </div>
                <div className="form-actions">
                  <button className="sources-btn primary" onClick={handleSave}>Save</button>
                  <button className="sources-btn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="source-card-header">
                  <div className="source-card-icon">
                    <SourceTypeIcon type={s.source_type} />
                  </div>
                  <div>
                    <div className="source-card-name">{s.name}</div>
                    <div className="source-card-type">{s.source_type} · {getConfigSummary(s)}</div>
                  </div>
                </div>
                <div className="source-card-status">
                  <span className={`status-dot ${s.enabled ? 'ok' : 'off'}`} />
                  {s.enabled ? 'Active' : 'Disabled'}
                  <button className="toggle-btn compact" onClick={() => handleToggle(s)} title={s.enabled ? 'Disable' : 'Enable'}>
                    {s.enabled ? '✓' : '✗'}
                  </button>
                </div>
                <div className="source-card-footer">
                  <span className="source-card-weight">Weight: {(s.attention_weight * 100).toFixed(0)}%</span>
                  <div className="card-weight-bar">
                    <div className="card-weight-fill" style={{ width: `${(s.attention_weight * 100).toFixed(0)}%` }} />
                  </div>
                </div>
                <div className="source-card-actions">
                  <button className="sources-btn" onClick={() => handleEdit(s)}>Edit</button>
                  <button className="sources-btn danger" onClick={() => handleDelete(s.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {sources.length === 0 && (
        <p className="text-[var(--ag-text-2)] text-[13px] py-8 text-center">No sources configured. Add one to start collecting content.</p>
      )}
    </div>
  );
}
