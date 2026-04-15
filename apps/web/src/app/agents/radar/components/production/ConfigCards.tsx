'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

// ── Card definitions ─────────────────────────────────────

interface CardDef {
  key: string;
  label: string;
  storageKey: string;
  type: 'text' | 'list';
  default: string[];
}

const CARDS: CardDef[] = [
  {
    key: 'mission',
    label: '核心使命',
    storageKey: 'agent-lab.card-mission',
    type: 'text',
    default: [
      '替代用户刷社交媒体的时间，推荐比短视频更吸引人的内容。',
      '创意 > 准确，意外发现 > 预期内容。',
    ],
  },
  {
    key: 'recommend',
    label: '推荐偏好',
    storageKey: 'agent-lab.card-recommend',
    type: 'list',
    default: [
      '独立开发者创意项目和变现故事',
      'CLI 工具、编辑器插件、开发者工具',
      'AI / Agent / LLM infra 新玩法和实践',
      '"我用 XX 做了 YY" 实战分享',
      '技术社区热门争论和八卦',
    ],
  },
  {
    key: 'filter',
    label: '过滤规则',
    storageKey: 'agent-lab.card-filter',
    type: 'list',
    default: [
      'AI 模型/论文/框架深度评测',
      '大公司产品更新',
      '"AI 零代码做了 XX" 类内容',
      '没有实际内容的炫技',
      '用户已知工具（除非重大更新）',
    ],
  },
  {
    key: 'quality',
    label: '质量门槛',
    storageKey: 'agent-lab.card-quality',
    type: 'text',
    default: [
      '不确定质量时宁可不推，不凑数',
      '每轮 ≤5 条',
      '分级：🔥 必看（fire）· ⚡ 值得看（bolt）· 💡 备选（bulb）',
    ],
  },
  {
    key: 'background',
    label: '用户背景',
    storageKey: 'agent-lab.card-background',
    type: 'text',
    default: [
      '7年全栈开发经验，正在转型 AI Agent 工程师',
      '技术栈：Python + React/TypeScript',
      '日常工具：Claude Code、MCP Server、LangGraph',
    ],
  },
  {
    key: 'interests',
    label: '兴趣标签',
    storageKey: 'agent-lab.card-interests',
    type: 'list',
    default: [
      '独立开发者的创意项目和变现故事',
      'CLI 工具、编辑器插件、终端工作流优化',
      'MCP / Agent 架构的新玩法和实践',
      '本地优先、自部署、隐私友好的工具',
      '技术社区的热门争论和八卦',
    ],
  },
  {
    key: 'dislike',
    label: '反感内容',
    storageKey: 'agent-lab.card-dislike',
    type: 'list',
    default: [
      '"AI 零代码做了 XX"',
      '大而全的工具列表、泛泛的推荐',
      'AI 模型发布/评测/论文',
      '没有实际内容的炫技项目',
      '已经在用的工具（除非重大更新）',
    ],
  },
];

// ── Persistence ──────────────────────────────────────────

function loadCard(def: CardDef): string[] {
  if (typeof window === 'undefined') return def.default;
  try {
    const v = localStorage.getItem(def.storageKey);
    return v ? JSON.parse(v) : def.default;
  } catch {
    return def.default;
  }
}

function saveCard(def: CardDef, items: string[]) {
  localStorage.setItem(def.storageKey, JSON.stringify(items));
}

// ── Build prompt from all cards ──────────────────────────

export function buildPromptFromCards(): string {
  const sections: string[] = [];

  for (const card of CARDS) {
    const items = loadCard(card);
    if (card.type === 'text') {
      sections.push(`## ${card.label}\n${items.join('\n')}`);
    } else {
      sections.push(`## ${card.label}\n${items.map((i) => `- ${i}`).join('\n')}`);
    }
  }

  // Append output format (not editable as cards)
  sections.push(`## 输出格式
严格合法的 JSON 数组，不要 markdown 代码块，每个元素：
{
  "external_id_suffix": "<原始 id>",
  "grade": "fire | bolt | bulb",
  "title": "<简洁中文标题>",
  "summary": "<2-3 句话中文总结>",
  "why": "<为什么推给这位用户>",
  "tags": ["<2-4 个标签>"],
  "url": "<原 url>"
}`);

  return sections.join('\n\n');
}

// ── Reset button with confirmation ───────────────────────

function ResetButton({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startConfirm = useCallback(() => {
    setConfirming(true);
    timerRef.current = setTimeout(() => setConfirming(false), 3000);
  }, []);

  const doReset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setConfirming(false);
    onReset();
  }, [onReset]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px]">
        <button
          className="text-fire hover:underline cursor-pointer"
          onClick={doReset}
        >
          确认重置
        </button>
        <button
          className="text-text-3 hover:text-text cursor-pointer"
          onClick={() => setConfirming(false)}
        >
          取消
        </button>
      </span>
    );
  }

  return (
    <button
      className="text-[10px] text-text-3 hover:text-text cursor-pointer"
      onClick={startConfirm}
    >
      重置
    </button>
  );
}

// ── Single card component ────────────────────────────────

function ConfigCard({ def }: { def: CardDef }) {
  const [items, setItems] = useState(() => loadCard(def));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const update = useCallback(
    (next: string[]) => {
      setItems(next);
      saveCard(def, next);
    },
    [def],
  );

  const removeItem = useCallback(
    (idx: number) => {
      const next = items.filter((_, i) => i !== idx);
      update(next);
    },
    [items, update],
  );

  const addItem = useCallback(() => {
    const v = draft.trim();
    if (!v) return;
    update([...items, v]);
    setDraft('');
    setEditing(false);
  }, [draft, items, update]);

  const resetToDefault = useCallback(() => {
    update(def.default);
  }, [def, update]);

  if (def.type === 'list') {
    return (
      <div className="border border-border rounded-[8px] bg-surface p-3 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-text-2 uppercase tracking-wide">
            {def.label}
          </span>
          <ResetButton onReset={resetToDefault} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 text-[11px] py-[2px] px-2 bg-bg-sunk border border-border rounded-full text-text-2"
            >
              {item}
              <button
                className="text-text-3 hover:text-fire cursor-pointer text-[10px] leading-none"
                onClick={() => removeItem(i)}
              >
                ×
              </button>
            </span>
          ))}
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                if (e.key === 'Escape') { setEditing(false); setDraft(''); }
              }}
              onBlur={() => { if (draft.trim()) addItem(); else setEditing(false); }}
              className="text-[11px] py-[2px] px-2 bg-transparent border border-accent-line rounded-full text-text outline-none w-[140px]"
              placeholder="输入后回车"
            />
          ) : (
            <button
              className="text-[11px] py-[2px] px-2 border border-dashed border-border rounded-full text-text-3 hover:border-accent-line hover:text-accent-brand cursor-pointer"
              onClick={() => setEditing(true)}
            >
              + 添加
            </button>
          )}
        </div>
      </div>
    );
  }

  // Text type card
  return (
    <TextCard def={def} items={items} onUpdate={update} onReset={resetToDefault} />
  );
}

function TextCard({
  def,
  items,
  onUpdate,
  onReset,
}: {
  def: CardDef;
  items: string[];
  onUpdate: (v: string[]) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div className="border border-border rounded-[8px] bg-surface p-3 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-text-2 uppercase tracking-wide">
          {def.label}
        </span>
        <div className="flex items-center gap-2">
          <ResetButton onReset={onReset} />
          <button
            className="text-[10px] text-text-3 hover:text-accent-brand cursor-pointer"
            onClick={() => {
              if (editing) {
                onUpdate(draft.split('\n').filter((l) => l.trim()));
                setEditing(false);
              } else {
                setDraft(items.join('\n'));
                setEditing(true);
              }
            }}
          >
            {editing ? '保存' : '编辑'}
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="w-full min-h-[60px] bg-bg-sunk border border-border rounded-[4px] p-2 text-[11.5px] leading-[1.6] text-text resize-none outline-none focus:border-accent-line"
          rows={items.length + 1}
        />
      ) : (
        <div className="text-[11.5px] leading-[1.6] text-text-2">
          {items.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main export ──────────────────────────────────────────

export default function ConfigCards() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5 p-3">
      {CARDS.map((def) => (
        <ConfigCard key={def.key} def={def} />
      ))}
    </div>
  );
}
