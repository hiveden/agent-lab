'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'agent-lab.radar.threadId';

export function usePersistedThread() {
  // SSR 安全：初始值空字符串
  const [threadId, setThreadId] = useState('');

  // 客户端初始化：读取或生成 threadId
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setThreadId(stored);
    } else {
      const id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
      setThreadId(id);
    }
  }, []);

  const resetThread = useCallback(() => {
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    setThreadId(id);
  }, []);

  const switchThread = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setThreadId(id);
  }, []);

  return { threadId, resetThread, switchThread };
}
