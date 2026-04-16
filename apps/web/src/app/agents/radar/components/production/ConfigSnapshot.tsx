'use client';

import { useState } from 'react';

interface ConfigSnapshotProps {
  prompt: string | null;
}

export default function ConfigSnapshot({ prompt }: ConfigSnapshotProps) {
  const [expanded, setExpanded] = useState(false);

  if (!prompt) {
    return (
      <div className="px-4 py-3 text-[11px] text-text-3">配置快照不可用</div>
    );
  }

  return (
    <div className="border-b border-border">
      <button
        className="w-full flex items-center justify-between px-4 py-1.5 text-[12px] cursor-pointer hover:bg-surface-hi"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="font-semibold text-text">配置快照</span>
        <span className="text-[11px] text-text-3">{expanded ? '▲ 收起' : '▼ 展开'}</span>
      </button>
      {expanded && (
        <pre className="px-4 py-3 text-[11px] leading-[1.6] text-text-2 whitespace-pre-wrap bg-bg-sunk border-t border-border max-h-[300px] overflow-y-auto">
          {prompt}
        </pre>
      )}
    </div>
  );
}
