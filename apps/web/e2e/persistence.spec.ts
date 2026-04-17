/**
 * Phase 2 E2E: 对话消息不膨胀，检验 LangGraph checkpointer + metadata-only persist 方案。
 *
 * 验证路径:
 *   1. 新建 thread，发 N 轮对话
 *   2. 刷新页面（触发 CopilotKit 从 AsyncSqliteSaver 恢复消息）
 *   3. 断言 DOM 中 user-bubble / assistant-bubble 数量精确等于 N（不膨胀）
 *   4. 通过 API 查 D1 chat_sessions —— messages 数组应为空（BFF 不再写 chat_messages）
 *
 * 参考 docs/20-LANGGRAPH-PERSISTENCE.md §8.4。
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

const ROUNDS = 3;

async function sendOneTurn(page: Page, presetLabel: string): Promise<void> {
  // Use preset buttons (宽松预设) — they trigger sendPreset which calls
  // agent.addMessage + agent.runAgent directly, avoiding CopilotKit
  // textarea event-binding quirks in tests.
  const userCountBefore = await page.locator('.user-bubble').count();
  await page.locator(`button:has-text("${presetLabel}")`).first().click();

  // Wait for new user bubble (preset content rendered)
  await expect(page.locator('.user-bubble')).toHaveCount(userCountBefore + 1, { timeout: 15_000 });

  // Wait for the send button to go back to 发送 (meaning isRunning=false).
  // When running, it becomes 停止.
  await expect(page.locator('button:has-text("停止")')).toHaveCount(0, { timeout: 90_000 });
  await page.waitForTimeout(500);
}

test('N 轮对话后 DOM 消息数精确无膨胀，D1 chat_messages 无写入', async ({ page, request }) => {
  // 1. Open page + 切到 Agent 视图 + 新建会话
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.locator('[aria-label="Agent"]').click();
  await page.waitForTimeout(500);
  await page.locator('text=+ 新建').click();
  await page.waitForTimeout(300);

  // 2. 发 N 轮对话（3 个 preset 循环）
  // 注意：每轮可能产生 1 条以上 assistant bubble，因为 "执行评判" preset
  // 会触发 evaluate tool call，产生 "thinking → tool → final" 的序列。
  const PRESETS = ['执行评判', '最近推荐质量', '调整偏好'];
  for (let i = 0; i < ROUNDS; i++) {
    await sendOneTurn(page, PRESETS[i % PRESETS.length]);
  }

  // 3. 取当前 threadId + 刷新前消息计数
  const threadId = await page.evaluate(() =>
    localStorage.getItem('agent-lab.radar.threadId'),
  );
  expect(threadId, 'threadId should be in localStorage').toBeTruthy();

  const userBefore = await page.locator('.user-bubble').count();
  const assistantBefore = await page.locator('.assistant-bubble').count();
  console.log(`[E2E] before reload: user=${userBefore}, assistant=${assistantBefore}`);
  expect(userBefore).toBe(ROUNDS); // 用户消息必然 = 轮数

  // 4. 刷新 → CopilotKit 通过 MESSAGES_SNAPSHOT 从 checkpointer 恢复
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // 等 snapshot 渲染

  // 5. 核心断言：刷新前后消息数精确相等（无膨胀、无丢失）
  const userAfter = await page.locator('.user-bubble').count();
  const assistantAfter = await page.locator('.assistant-bubble').count();
  console.log(`[E2E] after reload: user=${userAfter}, assistant=${assistantAfter}`);

  expect(
    userAfter,
    `刷新前后 user 消息数应一致（=${userBefore}），实际 ${userAfter}`,
  ).toBe(userBefore);
  expect(
    assistantAfter,
    `刷新前后 assistant 消息数应一致（=${assistantBefore}），实际 ${assistantAfter}`,
  ).toBe(assistantBefore);

  // 6. 核心断言：D1 chat_messages 无写入 — session.messages 应为空（Phase 2 目标）
  const resp = await request.get(`/api/chat/sessions?thread_id=${threadId}`);
  expect(resp.status()).toBe(200);
  const session = await resp.json();
  expect(
    session.messages ?? [],
    'Phase 2: BFF 不应再写入 chat_messages 表',
  ).toHaveLength(0);
});
