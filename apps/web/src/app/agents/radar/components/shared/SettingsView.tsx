'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

type Provider = 'glm' | 'ollama' | 'anthropic' | 'gemini' | 'custom';

interface SettingsForm {
  provider: Provider;
  model_push: string;
  model_chat: string;
  model_tool: string;
  base_url: string;
  api_key: string;
  api_key_masked: string;
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
  gemini: {
    provider: 'gemini',
    base_url: 'http://localhost:8317/v1',
    model_push: 'gemini-2.5-flash-lite',
    model_chat: 'gemini-2.5-flash',
    model_tool: 'gemini-2.5-flash',
  },
  custom: {
    provider: 'custom',
    base_url: '',
    model_push: '',
    model_chat: '',
    model_tool: '',
  },
};

const PROVIDER_LABELS: Record<Provider, string> = {
  glm: 'GLM (智谱)',
  ollama: 'Ollama (本地)',
  anthropic: 'Anthropic (CPA)',
  gemini: 'Gemini (CPA)',
  custom: 'Custom (OpenAI-compatible)',
};

const PROVIDER_MODELS: Record<Provider, string[]> = {
  glm: ['glm-4-flash', 'glm-4.6', 'glm-4-plus', 'glm-4-long', 'glm-4-flashx'],
  ollama: [],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  custom: [],
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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/settings');
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
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (form.provider !== 'ollama' || !form.base_url) return;
    const base = form.base_url.replace(/\/v1\/?$/, '');
    fetch(`${base}/api/tags`)
      .then((r) => r.json())
      .then((data) => {
        const models = ((data as { models?: Array<{ name: string }> }).models ?? []).map((m) => m.name);
        setOllamaModels(models);
      })
      .catch(() => setOllamaModels([]));
  }, [form.provider, form.base_url]);

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
      toast.success('已保存');
      setForm((prev) => ({ ...prev, api_key: '' }));
      fetchSettings();
    } catch (e) {
      toast.error(`保存失败: ${errorMessage(e)}`);
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
        toast.success(`连接成功: ${data.detail || 'OK'}`);
      } else {
        toast.error(`连接失败: ${data.error || 'unknown'}`);
      }
    } catch (e) {
      toast.error(`测试失败: ${errorMessage(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const models = form.provider === 'ollama' ? ollamaModels : PROVIDER_MODELS[form.provider];

  if (loading) {
    return (
      <div className="max-w-[560px] py-8 text-center text-sm text-[var(--text-3)]">
        加载设置中…
      </div>
    );
  }

  return (
    <div className="max-w-[560px]">
      <h2 className="text-base font-semibold mb-1">LLM 设置</h2>
      <p className="text-[13px] text-[var(--text-3)] mb-6">
        配置 Radar Agent 使用的模型和 API。
      </p>

      <div className="space-y-5">
        {/* Provider */}
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={form.provider} onValueChange={(v) => handleProviderChange(v as Provider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Base URL */}
        <div className="space-y-1.5">
          <Label>Base URL</Label>
          <Input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="font-mono text-xs"
          />
        </div>

        <Separator />

        {/* Models */}
        <div className="grid grid-cols-3 gap-3">
          <ModelSelect label="Chat 模型" value={form.model_chat} models={models} onChange={(v) => setForm({ ...form, model_chat: v })} />
          <ModelSelect label="Tool 模型" value={form.model_tool} models={models} onChange={(v) => setForm({ ...form, model_tool: v })} />
          <ModelSelect label="Push 模型" value={form.model_push} models={models} onChange={(v) => setForm({ ...form, model_push: v })} />
        </div>

        <Separator />

        {/* API Key */}
        <div className="space-y-1.5">
          <Label>API Key</Label>
          <Input
            type="password"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            placeholder={form.api_key_masked || (form.provider === 'ollama' ? '本地模型无需 key' : '输入 API key')}
          />
          {form.api_key_masked && (
            <p className="text-[11px] text-[var(--text-3)]">
              已保存: {form.api_key_masked}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModelSelect({ label, value, models, onChange }: {
  label: string;
  value: string;
  models: string[];
  onChange: (v: string) => void;
}) {
  const hasOptions = models.length > 0;

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{label}</Label>
      {hasOptions ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
            ))}
            {value && !models.includes(value) && (
              <SelectItem value={value} className="font-mono text-xs">{value}</SelectItem>
            )}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          placeholder="输入模型名"
        />
      )}
    </div>
  );
}
