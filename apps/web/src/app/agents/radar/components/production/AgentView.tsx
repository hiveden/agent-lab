'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CopilotKit } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { usePersistedThread } from '@/lib/hooks/use-persisted-thread';
import { useSessionList } from '@/lib/hooks/use-session-list';
import { useAgentSession } from '@/lib/hooks/use-agent-session';
import SessionSidebar from './SessionSidebar';
import SessionDetail from './SessionDetail';

export default function AgentView() {
  const { threadId, switchThread } = usePersistedThread();
  const { sessions, isLoading: sessionsLoading, reload } = useSessionList('radar');
  const { mutate: sessionMutate } = useAgentSession(threadId || null);

  // Track the "active" (latest) thread ID — the one created by New or initial load
  const activeIdRef = useRef<string>('');

  useEffect(() => {
    if (threadId && !activeIdRef.current) {
      activeIdRef.current = threadId;
    }
  }, [threadId]);

  const handleNew = useCallback(() => {
    const newId = crypto.randomUUID();
    activeIdRef.current = newId;
    switchThread(newId);
  }, [switchThread]);

  const isActiveSession = threadId === activeIdRef.current;

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
        sessions={sessions}
        activeId={threadId}
        loading={sessionsLoading}
        onNew={handleNew}
        onSwitch={switchThread}
      />
      <CopilotKit key={threadId} runtimeUrl="/api/agent/chat" showDevConsole={process.env.NODE_ENV === 'development'}>
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
