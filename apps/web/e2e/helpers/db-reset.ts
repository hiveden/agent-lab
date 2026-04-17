/**
 * E2E 测试数据库重置 — 清除业务数据但保留表结构和 seed。
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * 清除 chat_sessions + chat_messages（保留 sources / items / raw_items 等业务数据）。
 *
 * 用于 persistence / session-list 等测试隔离——全量顺序跑时前面 spec 留下的
 * session 会拖慢 Agent 启动与列表查询。通过 wrangler CLI 直接执行 SQL。
 *
 * 仅清 chat_* 两张表，避免污染 consumption 依赖的 items/raw_items seed。
 */
export function cleanChatTables(): void {
  const webDir = resolve(__dirname, '..', '..');
  try {
    execSync(
      `pnpm exec wrangler d1 execute agent-lab-dev --local --command "DELETE FROM chat_messages; DELETE FROM chat_sessions;"`,
      { cwd: webDir, stdio: 'pipe' },
    );
  } catch (err) {
    console.warn(`[db-reset] cleanChatTables failed: ${String(err)}`);
  }
}

/**
 * 删除 Python Agent 的 SQLite checkpointer 文件。
 *
 * 注意：如果 Agent 进程持有文件句柄，unlink 后新写入仍会落在 inode 上
 * （macOS/Linux 行为），查询也继续工作。仅清盘占用，不影响运行中 agent。
 * 对于纯 E2E 环境（Agent 重启），下次启动会创建全新的 checkpoints.db。
 */
export function cleanCheckpointsDb(): void {
  const checkpointsPath = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'agents',
    'radar',
    'data',
    'checkpoints.db',
  );
  if (existsSync(checkpointsPath)) {
    try {
      rmSync(checkpointsPath);
    } catch (err) {
      console.warn(`[db-reset] cleanCheckpointsDb failed: ${String(err)}`);
    }
  }
}
