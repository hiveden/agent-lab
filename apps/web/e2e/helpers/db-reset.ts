/**
 * E2E 测试数据库重置 — 清除业务数据但保留表结构和 seed。
 */

import type { APIRequestContext } from '@playwright/test';

const TABLES_TO_CLEAR = ['chat_messages', 'chat_sessions', 'user_states', 'items', 'raw_items', 'runs'];
// sources 不清，保留 seed

/**
 * 通过 wrangler CLI 清除测试数据（在 run-e2e.sh 中调用）。
 * E2E spec 里不直接调——由 run-e2e.sh 的 Step 1 负责。
 */
export function getResetSQL(): string {
  return TABLES_TO_CLEAR.map((t) => `DELETE FROM ${t};`).join('\n');
}

/**
 * 通过 API 验证数据库是干净的。
 */
export async function assertCleanDB(request: APIRequestContext) {
  const items = await request.get('/api/items?agent_id=radar&limit=1');
  const body = await items.json();
  return body.items.length === 0;
}
