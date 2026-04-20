'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Agent 会话 thread 管理：
 *
 * - **每次进入页面都新开 thread**（不读 localStorage）。用户习惯是"进入 = 新任务"，
 *   历史会话通过侧边栏切换查看。
 * - `switchThread(id)` 用于侧边栏切到历史会话或手动"新建"。
 *
 * 设计决定见 issue #4/#5（2026-04-20）：旧方案 localStorage 持久化导致每次都继续
 * 上次会话，新 thread 永远不产生，列表也无法新增。
 *
 * StrictMode 保护：initRef 防止 dev 模式下 useEffect 双跑生成两个不同 id（会触发
 * CopilotKit key={threadId} remount → 消息丢失）。
 */
export function usePersistedThread() {
  // SSR 安全：初始值空字符串
  const [threadId, setThreadId] = useState('');
  const initRef = useRef(false);

  // 客户端初始化：首次 mount 生成一次新 threadId（StrictMode 下 effect 双跑，ref 守卫只执行一次）
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setThreadId(crypto.randomUUID());
  }, []);

  const switchThread = useCallback((id: string) => {
    setThreadId(id);
  }, []);

  return { threadId, switchThread };
}
