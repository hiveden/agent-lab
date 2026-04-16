# AgentView 会话历史

## 当前状态（有 bug）

v2 迁移时，会话历史功能被覆盖：

| 功能 | 之前实现（已丢失） | 当前状态 |
|------|-------------------|---------|
| threadId 持久化 | localStorage `agent-lab.radar.threadId` | `useMemo(() => crypto.randomUUID(), [])` — 每次 mount 新 ID |
| 历史加载 | mount 时 fetch → `agent.setMessages()` | 无 |
| 会话列表 | `GET /api/chat/sessions?agent_id=radar` + 侧栏渲染 | 侧栏写死 placeholder |
| 新会话按钮 | 生成新 threadId + 清空 | 无 |
| 切换会话 | 点击列表项 → 切换 threadId → remount | 无 |

## 后端（已完成，可复用）

| 组件 | 状态 | 路径 |
|------|------|------|
| 持久化写入端点 | ✅ | `apps/web/src/app/api/chat/persist/route.ts` |
| 会话列表端点 | ✅ | `apps/web/src/app/api/chat/sessions/route.ts` (`?agent_id=radar`) |
| 单会话读取端点 | ✅ | `apps/web/src/app/api/chat/sessions/route.ts` (`?thread_id=xxx`) |
| PlatformClient.persist_chat | ✅ | `agents/shared/src/agent_lab_shared/db.py` |
| Agent 自动持久化 hook | ✅ | `agents/radar/src/radar/agui_tracing.py` (`_persist_chat`) |
| listAgentSessions | ✅ | `apps/web/src/lib/chat.ts` |
| getSessionByThreadId | ✅ | `apps/web/src/lib/chat.ts` |
| ensureSession (支持指定 ID) | ✅ | `apps/web/src/lib/chat.ts` |

E2E 测试已验证（8/8 通过）：写入、读取、多轮追加、线程隔离、认证、agent 自动持久化。

## 前端设计（需重新实现）

### 1. threadId 持久化

```tsx
const THREAD_STORAGE_KEY = 'agent-lab.radar.threadId';

function usePersistedThreadId() {
  const [threadId, setThreadId] = useState<string>(() => {
    if (typeof window === 'undefined') return crypto.randomUUID();
    const stored = localStorage.getItem(THREAD_STORAGE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(THREAD_STORAGE_KEY, id);
    return id;
  });

  const resetThread = useCallback(() => {
    const id = crypto.randomUUID();
    localStorage.setItem(THREAD_STORAGE_KEY, id);
    setThreadId(id);
  }, []);

  const switchThread = useCallback((id: string) => {
    localStorage.setItem(THREAD_STORAGE_KEY, id);
    setThreadId(id);
  }, []);

  return { threadId, resetThread, switchThread };
}
```

替代当前的 `useMemo(() => crypto.randomUUID(), [])`。threadId 传给 `useAgent` 和 `CopilotChat`。

### 2. 历史消息加载

mount 时按 threadId 从 D1 读取历史，通过 `agent.setMessages()` 恢复：

```tsx
useEffect(() => {
  if (historyLoaded.current) return;
  historyLoaded.current = true;
  const tid = localStorage.getItem(THREAD_STORAGE_KEY);
  if (!tid) return;
  fetch(`/api/chat/sessions?thread_id=${encodeURIComponent(tid)}`)
    .then(res => res.json())
    .then(data => {
      const msgs = (data.messages ?? [])
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map(m => ({ id: m.id, role: m.role, content: m.content }));
      if (msgs.length > 0) agent.setMessages(msgs);
    })
    .catch(() => {});
}, []);
```

### 3. 会话列表

```tsx
function useSessionList() {
  const [sessions, setSessions] = useState([]);
  const reload = useCallback(async () => {
    const res = await fetch('/api/chat/sessions?agent_id=radar');
    const data = await res.json();
    setSessions(data.sessions ?? []);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { sessions, reload };
}
```

侧栏渲染列表，点击切换 `switchThread(id)`，CopilotKit `key={threadId}` 触发 remount。

### 4. Inspector workaround 兼容

当前有 Inspector thread clone workaround（DOM bridge 订阅）。threadId 持久化后需要确认 Inspector 仍然能正确订阅。关键：`useAgent({ agentId: 'radar', threadId })` 的 threadId 必须和 `CopilotChat threadId={threadId}` 一致。

## 注意事项

- `CopilotKit key={threadId}` — 切换 threadId 时整个 Provider tree remount，清空内存状态
- 历史恢复只还原 user + assistant 文本消息，tool 消息不恢复（无法重建 toolCallId 映射）
- 持久化是 best-effort（fire-and-forget），失败不阻塞对话
- 会话列表过滤掉 0 消息的空 session
