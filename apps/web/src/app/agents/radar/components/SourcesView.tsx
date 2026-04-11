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

export default function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditingSource | null>(null);
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState<EditingSource>({
    name: '',
    source_type: 'hacker-news',
    config: '{}',
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
            <select value={newForm.source_type} onChange={(e) => setNewForm({ ...newForm, source_type: e.target.value })}>
              <option value="hacker-news">Hacker News</option>
              <option value="rss">RSS</option>
              <option value="twitter">Twitter</option>
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
            <button className="sources-btn primary" onClick={handleAdd}>Create</button>
            <button className="sources-btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
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
