/**
 * Radar 子路由 layout — 业务数据层 Provider 挂载点。
 *
 * 关注点分离（见 docs/mobile-playbook/01-architecture-rfc.md §2 P1 原则）：
 * - 根 layout（app/layout.tsx）：全站基础设施（字体 / OTel / 暗色主题 / SEO）
 * - 本层（agents/radar/layout.tsx）：radar 业务数据层 Provider
 *
 * Provider 作用域与消费者（useItems / useRuns / useSessionList / useAgentSession）
 * 的使用范围对齐 — 只在 /agents/radar/** 子树生效。
 * 其他路由（未来的 /blog / /login 等）不会无谓初始化 QueryClient。
 *
 * 未来若扩展到多 agent（/agents/[agentId]），可将本 Provider 上提到
 * app/agents/layout.tsx，消费者路径不变。
 */
import type { ReactNode } from 'react';
import { QueryProvider } from '@/lib/providers/query-provider';

export default function RadarLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
