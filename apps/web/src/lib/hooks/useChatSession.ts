'use client';

/**
 * CopilotKit v2 useAgent 的薄包装（ADR-1 落地；PoC VERDICT 签名校准）。
 *
 * 背景：
 * - CopilotKit v2 真实签名是 useAgent(props?) 单参数，官方 blog 示例有误
 * - updates 必须显式传才会 rerender（默认空数组 hook 静默）
 * - 发消息走 agent.addMessage + agent.runAgent（不是 runAgent({messages:[]}))
 * - Provider props 必须稳定引用（#32 教训，ADR-9）
 *
 * 范围（Step 3）：
 * - 当前只有 Mobile item chat 用，Desktop ChatView 保持 `/api/chat`（Step 3.5 统一）
 * - agentId 默认 'radar'——未来拆出 item-explainer agent 时改 'item' 一行搞定
 */

import { useCallback, useMemo } from 'react';
import { useAgent, UseAgentUpdate } from '@copilotkit/react-core/v2';

// 模块级稳定引用 — 见 ADR-9。不要 inline 进 hook 参数。
const AGENT_UPDATES = Object.freeze([
  UseAgentUpdate.OnMessagesChanged,
  UseAgentUpdate.OnRunStatusChanged,
  UseAgentUpdate.OnStateChanged,
]) as unknown as UseAgentUpdate[];

function genMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

export interface UseChatSessionOptions {
  /** CopilotKit agent 选择，默认 'radar'。Step 3.5 后切 'item'。 */
  agentId?: string;
  /** LangGraph thread_id，决定 checkpointer 落点。传 item.id 可让同一 item 续聊。 */
  threadId?: string;
}

export function useChatSession(options: UseChatSessionOptions = {}) {
  const { agentId = 'radar', threadId } = options;

  // useMemo deps 稳定 — 见 ADR-9
  const agentProps = useMemo(
    () => ({ agentId, threadId, updates: AGENT_UPDATES }),
    [agentId, threadId],
  );

  const { agent } = useAgent(agentProps);

  const sendMessage = useCallback(
    async (text: string) => {
      agent.addMessage({ id: genMessageId(), role: 'user', content: text });
      await agent.runAgent();
    },
    [agent],
  );

  // 扁平化提取所有 tool calls，给 UI 做统一展示
  const toolCalls = useMemo(() => {
    const all: unknown[] = [];
    for (const m of agent.messages ?? []) {
      const tc = (m as { toolCalls?: unknown[] }).toolCalls;
      if (Array.isArray(tc)) all.push(...tc);
    }
    return all;
  }, [agent.messages]);

  return {
    messages: agent.messages,
    sendMessage,
    isStreaming: agent.isRunning,
    toolCalls,
    state: agent.state,
    /** 兜底：需要 agent 实例做高阶操作时（stop / setState / setMessages） */
    agent,
  };
}
