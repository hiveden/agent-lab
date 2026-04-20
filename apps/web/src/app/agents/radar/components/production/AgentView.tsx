'use client';

import { useCallback, useMemo, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { usePersistedThread } from '@/lib/hooks/use-persisted-thread';
import { useSessionList, type SessionSummary } from '@/lib/hooks/use-session-list';
import { useAgentSession } from '@/lib/hooks/use-agent-session';
import SessionSidebar from './SessionSidebar';
import SessionDetail from './SessionDetail';

// #32 fix: CopilotKitProvider 对 agents__unsafe_dev_only / selfManagedAgents /
// headers / properties 使用 destructure 默认 `= {}`，每次 render 产生新 ref →
// 同步 effect 触发 setAgents__unsafe_dev_only → 无条件 notifyAgentsChanged →
// web-inspector 重订阅 master（clone 订阅被覆盖）→ Dev Console Agent tab 清空。
// 传模块级稳定引用让 effect deps 稳定，effect 只在 mount 跑一次。
const EMPTY_OBJ: Record<string, never> = {};

export default function AgentView() {
  const { threadId, switchThread } = usePersistedThread();
  const { sessions, isLoading: sessionsLoading, reload } = useSessionList('radar');
  const { mutate: sessionMutate } = useAgentSession(threadId || null);

  // "本次打开页面"创建或切换到的最新 thread。用户点击侧边栏历史会话时 threadId
  // 变化但 activeId 不变 → isActiveSession=false → SessionDetail 走只读分支。
  //
  // 用 state 而非 ref：该值直接决定 UI 分支（CopilotChat vs 只读视图），符合
  // React 官方"决定 UI 的值必须用 state"（ref 不触发 re-render → race bug）。
  const [activeId, setActiveId] = useState<string>('');
  if (threadId && !activeId) {
    // 首次 threadId 可用时同步 activeId。React 对"同 render 中 setState 到相同或
    // 一致性值"会 bail out，不会无限循环（官方 useState "Storing previous render info"）。
    setActiveId(threadId);
  }

  const handleNew = useCallback(() => {
    const newId = crypto.randomUUID();
    setActiveId(newId);
    switchThread(newId);
  }, [switchThread]);

  const isActiveSession = threadId === activeId;

  // 注入"新会话"占位到列表顶部：threadId 尚未持久化到 DB 前，
  // 侧边栏能看到它并高亮。发消息后 persist → SWR reload → 真实数据替换占位。
  const sessionsWithNew = useMemo<SessionSummary[]>(() => {
    if (!threadId) return sessions;
    if (sessions.some((s) => s.id === threadId)) return sessions;
    const placeholder: SessionSummary = {
      id: threadId,
      agent_id: 'radar',
      created_at: new Date().toISOString(),
      preview: '新会话',
      config_prompt: null,
      result_summary: null,
    };
    return [placeholder, ...sessions];
  }, [threadId, sessions]);

  // SSR / first frame: threadId not yet available
  if (!threadId) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="w-[200px] shrink-0 border-r border-border" />
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <SessionSidebar
        sessions={sessionsWithNew}
        activeId={threadId}
        loading={sessionsLoading}
        onNew={handleNew}
        onSwitch={switchThread}
      />
      <CopilotKit
        key={threadId}
        runtimeUrl="/api/agent/chat"
        showDevConsole={process.env.NODE_ENV === 'development'}
        agents__unsafe_dev_only={EMPTY_OBJ}
        selfManagedAgents={EMPTY_OBJ}
        headers={EMPTY_OBJ}
        properties={EMPTY_OBJ}
      >
        <SessionDetail
          threadId={threadId}
          isActiveSession={isActiveSession}
          sessionReload={reload}
          sessionMutate={sessionMutate}
        />
      </CopilotKit>
    </div>
  );
}
