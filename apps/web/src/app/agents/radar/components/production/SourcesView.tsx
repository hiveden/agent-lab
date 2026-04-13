'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/fetch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
  'http': 'HTTP API',
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

const emptyForm: EditingSource = {
  name: '',
  source_type: 'hacker-news',
  config: CONFIG_TEMPLATES['hacker-news'],
  attention_weight: 0,
  enabled: true,
};

export default function SourcesView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = adding
  const [form, setForm] = useState<EditingSource>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Test state
  const [testResult, setTestResult] = useState<{ ok: boolean; count?: number; items?: unknown[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/sources?agent_id=radar');
      const data = (await res.json()) as { sources?: Source[] };
      setSources(data.sources ?? []);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const totalWeight = sources.reduce((sum, s) => sum + s.attention_weight, 0);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setTestResult(null);
    setDialogOpen(true);
  };

  const openEdit = (s: Source) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      source_type: s.source_type,
      config: JSON.stringify(s.config, null, 2),
      attention_weight: s.attention_weight,
      enabled: s.enabled,
    });
    setTestResult(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setTestResult(null);
  };

  const handleTypeChange = (type: string) => {
    setForm(prev => ({
      ...prev,
      source_type: type,
      config: CONFIG_TEMPLATES[type] || '{}',
    }));
    setTestResult(null);
  };

  const handleTest = async () => {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(form.config);
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
        body: JSON.stringify({ source_type: form.source_type, config }),
      });
      const data = (await res.json()) as { ok: boolean; count?: number; items?: unknown[]; error?: string };
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(form.config);
    } catch {
      toast.error('Invalid JSON config');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/api/sources/${editingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            config,
            attention_weight: form.attention_weight,
            enabled: form.enabled,
          }),
        });
      } else {
        await apiFetch('/api/sources', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agent_id: 'radar',
            source_type: form.source_type,
            name: form.name,
            config,
            attention_weight: form.attention_weight,
            enabled: form.enabled,
          }),
        });
      }
      toast.success('Source saved');
      closeDialog();
      fetchSources();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/sources/${id}`, { method: 'DELETE' });
      fetchSources();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleToggle = async (s: Source) => {
    try {
      await apiFetch(`/api/sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      fetchSources();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const isAdding = !editingId;

  if (loading) {
    return <div className="max-w-[900px]"><p className="text-[var(--ag-text-2)] text-[13px] py-8 text-center">Loading sources...</p></div>;
  }

  return (
    <div className="max-w-[900px]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold m-0">Sources</h2>
        <Button size="sm" onClick={openAdd}>+ Add Source</Button>
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

      {/* Sources grid */}
      <div className="sources-grid">
        {sources.map((s) => {
          const pct = totalWeight > 0 ? (s.attention_weight / totalWeight) * 100 : 0;
          const absPct = s.attention_weight * 100;
          return (
            <div key={s.id} className={cn('source-card', !s.enabled && 'disabled')}>
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
                  {s.enabled ? '\u2713' : '\u2717'}
                </button>
              </div>
              <div className="source-card-footer">
                <span className="source-card-weight">
                  Weight: {absPct.toFixed(0)}%
                  {totalWeight > 0 && (
                    <span className="text-[10px] text-[var(--ag-text-2)] ml-1">
                      ({pct.toFixed(0)}% of total)
                    </span>
                  )}
                </span>
                <div className="card-weight-bar">
                  <div className="card-weight-fill" style={{ width: `${absPct.toFixed(0)}%` }} />
                </div>
              </div>
              {totalWeight > 1.01 && s.enabled && (
                <div className="text-[10px] text-[#e55] mt-1">Total weight exceeds 100%</div>
              )}
              <div className="source-card-actions">
                <Button variant="outline" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(s.id)}>Delete</Button>
              </div>
            </div>
          );
        })}
      </div>

      {sources.length === 0 && (
        <p className="text-[var(--ag-text-2)] text-[13px] py-8 text-center">No sources configured. Add one to start collecting content.</p>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isAdding ? 'Add Source' : 'Edit Source'}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {isAdding ? 'Configure a new content source for the Radar agent.' : 'Update the source configuration.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Name */}
            <div className="form-row">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Hacker News"
              />
            </div>

            {/* Type (only for add) */}
            <div className="form-row">
              <label>Type</label>
              {isAdding ? (
                <select value={form.source_type} onChange={(e) => handleTypeChange(e.target.value)}>
                  {Object.entries(SOURCE_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[13px] text-[var(--ag-text-2)]">
                  {SOURCE_TYPE_LABELS[form.source_type] ?? form.source_type}
                </span>
              )}
            </div>

            {/* Config JSON */}
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label className="pt-1.5">Config (JSON)</label>
              <textarea
                value={form.config}
                onChange={(e) => setForm(prev => ({ ...prev, config: e.target.value }))}
                rows={5}
                className="font-mono text-xs"
              />
            </div>

            {/* Weight */}
            <div className="form-row">
              <label>Weight: {(form.attention_weight * 100).toFixed(0)}%</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.attention_weight}
                onChange={(e) => setForm(prev => ({ ...prev, attention_weight: Number(e.target.value) }))}
              />
            </div>

            {/* Enabled toggle */}
            <div className="form-row">
              <label>Enabled</label>
              <button
                type="button"
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  form.enabled ? 'bg-primary' : 'bg-muted',
                )}
                onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                    form.enabled ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </div>

            {/* Test result */}
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test'}
            </Button>
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : isAdding ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
