'use client';

import { useCallback, useEffect, useState } from 'react';

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
    url: 'https://api.example.com/data',
    method: 'GET',
    items_path: 'data',
    mapping: { external_id: 'id', title: 'title', url: 'url' },
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
    return <div className="sources-view"><p className="sources-empty">Loading sources…</p></div>;
  }

  return (
    <div className="sources-view">
      <div className="sources-header">
        <h2>Sources</h2>
        <button className="sources-btn primary" onClick={() => setAdding(true)}>+ Add Source</button>
      </div>

      {/* Weight bar */}
      {sources.length > 0 && (
        <div className="weight-bar-container">
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
          <div className="weight-total">
            Total: {(totalWeight * 100).toFixed(0)}%
            {Math.abs(totalWeight - 1) > 0.01 && (
              <span className="weight-warn"> (should be 100%)</span>
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

      {/* Sources table */}
      <table className="sources-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Weight</th>
            <th>Enabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className={!s.enabled ? 'disabled-row' : ''}>
              {editing === s.id && editForm ? (
                <>
                  <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td>{s.source_type}</td>
                  <td>
                    <input type="range" min={0} max={1} step={0.05} value={editForm.attention_weight} onChange={(e) => setEditForm({ ...editForm, attention_weight: Number(e.target.value) })} />
                    <span>{(editForm.attention_weight * 100).toFixed(0)}%</span>
                  </td>
                  <td>
                    <button className="toggle-btn" onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}>
                      {editForm.enabled ? '✓' : '✗'}
                    </button>
                  </td>
                  <td>
                    <button className="sources-btn primary" onClick={handleSave}>Save</button>
                    <button className="sources-btn" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{s.name}</td>
                  <td><code>{s.source_type}</code></td>
                  <td>{(s.attention_weight * 100).toFixed(0)}%</td>
                  <td>
                    <button className="toggle-btn" onClick={() => handleToggle(s)}>
                      {s.enabled ? '✓' : '✗'}
                    </button>
                  </td>
                  <td>
                    <button className="sources-btn" onClick={() => handleEdit(s)}>Edit</button>
                    <button className="sources-btn danger" onClick={() => handleDelete(s.id)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {sources.length === 0 && (
        <p className="sources-empty">No sources configured. Add one to start collecting content.</p>
      )}
    </div>
  );
}
