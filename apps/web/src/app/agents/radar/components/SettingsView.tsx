'use client';

import { useCallback, useEffect, useState } from 'react';

type Provider = 'glm' | 'ollama' | 'anthropic';

interface SettingsForm {
  provider: Provider;
  model_push: string;
  model_chat: string;
  model_tool: string;
  base_url: string;
  api_key: string; // 新输入的 key（空=不修改）
  api_key_masked: string; // 已存的脱敏值
}

const PROVIDER_DEFAULTS: Record<Provider, Omit<SettingsForm, 'api_key' | 'api_key_masked'>> = {
  glm: {
    provider: 'glm',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model_push: 'glm-4-flash',
    model_chat: 'glm-4.6',
    model_tool: 'glm-4.6',
  },
  ollama: {
    provider: 'ollama',
    base_url: 'http://localhost:11434/v1',
    model_push: 'qwen2.5:14b',
    model_chat: 'qwen2.5:32b',
    model_tool: 'qwen2.5:14b',
  },
  anthropic: {
    provider: 'anthropic',
    base_url: 'http://localhost:8317/v1',
    model_push: 'claude-sonnet-4-20250514',
    model_chat: 'claude-sonnet-4-20250514',
    model_tool: 'claude-sonnet-4-20250514',
  },
};

const PROVIDER_LABELS: Record<Provider, string> = {
  glm: 'GLM (智谱)',
  ollama: 'Ollama (本地)',
  anthropic: 'Anthropic (CPA)',
};

export default function SettingsView() {
  const [form, setForm] = useState<SettingsForm>({
    ...PROVIDER_DEFAULTS.glm,
    api_key: '',
    api_key_masked: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      const data = (await res.json()) as { settings: Record<string, string> };
      const s = data.settings;
      setForm({
        provider: (s.provider as Provider) || 'glm',
        model_push: s.model_push || '',
        model_chat: s.model_chat || '',
        model_tool: s.model_tool || '',
        base_url: s.base_url || '',
        api_key: '',
        api_key_masked: s.api_key_masked || '',
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleProviderChange = (provider: Provider) => {
    const defaults = PROVIDER_DEFAULTS[provider];
    setForm((prev) => ({
      ...prev,
      ...defaults,
      api_key: '',
      api_key_masked: provider === prev.provider ? prev.api_key_masked : '',
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        provider: form.provider,
        model_push: form.model_push,
        model_chat: form.model_chat,
        model_tool: form.model_tool,
        base_url: form.base_url,
      };
      if (form.api_key) payload.api_key = form.api_key;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Settings saved');
      setForm((prev) => ({ ...prev, api_key: '' }));
      fetchSettings();
    } catch (e) {
      showToast(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: form.provider,
          base_url: form.base_url,
          api_key: form.api_key || '(use-saved)',
          model: form.model_chat,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; detail?: string };
      if (data.ok) {
        showToast(`Connected: ${data.detail || 'OK'}`);
      } else {
        showToast(`Failed: ${data.error || 'unknown'}`);
      }
    } catch (e) {
      showToast(`Test failed: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="settings-view"><p className="att-empty">Loading settings...</p></div>;
  }

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2>LLM Settings</h2>
      </div>
      <p className="att-subtitle">Configure the LLM provider for Radar agent.</p>

      <div className="settings-form">
        {/* Provider */}
        <div className="s-row">
          <label>Provider</label>
          <select
            value={form.provider}
            onChange={(e) => handleProviderChange(e.target.value as Provider)}
          >
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {/* Base URL */}
        <div className="s-row">
          <label>Base URL</label>
          <input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </div>

        {/* Models */}
        <div className="s-row">
          <label>Model (Push)</label>
          <input
            value={form.model_push}
            onChange={(e) => setForm({ ...form, model_push: e.target.value })}
          />
        </div>
        <div className="s-row">
          <label>Model (Chat)</label>
          <input
            value={form.model_chat}
            onChange={(e) => setForm({ ...form, model_chat: e.target.value })}
          />
        </div>
        <div className="s-row">
          <label>Model (Tool)</label>
          <input
            value={form.model_tool}
            onChange={(e) => setForm({ ...form, model_tool: e.target.value })}
          />
        </div>

        {/* API Key */}
        <div className="s-row">
          <label>API Key</label>
          <div className="s-key-group">
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder={form.api_key_masked || (form.provider === 'ollama' ? 'Not required' : 'Enter API key')}
            />
            {form.api_key_masked && (
              <span className="s-key-hint">Saved: {form.api_key_masked}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="s-actions">
          <button className="sources-btn" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button className="sources-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {toast && <div className="s-toast">{toast}</div>}
    </div>
  );
}
