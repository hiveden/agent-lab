/**
 * Phase 2 后回归：侧栏会话列表不应过滤掉空 chat_messages 的 session。
 *
 * 背景：Phase 2 后 BFF 不再写 chat_messages 表，所有 session 的 message_count=0。
 *   listAgentSessions 之前用 message_count > 0 过滤，导致侧栏永远为空。
 *   修复：去掉过滤 + preview 降级到 config_prompt / result_summary。
 *
 * 纯 API 测试，不依赖 UI 或 agent 运行。
 */

import { test, expect } from '@playwright/test';

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };

test('GET /api/chat/sessions?agent_id=radar 包含只有 metadata 的 session', async ({ request }) => {
  const threadId = `test-sidebar-${Date.now()}`;

  // 1. 通过 persist API 创建一个只有元数据的 session（模拟 Phase 2 的持久化）
  const persistResp = await request.post('/api/chat/persist', {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      agent_id: 'radar',
      thread_id: threadId,
      config_prompt: '这是一个测试配置 prompt',
      result_summary: { evaluated: 5, promoted: 2, rejected: 3 },
    }),
  });
  expect(persistResp.status(), 'persist 应成功').toBe(200);

  // 2. GET 会话列表，应包含刚创建的 session
  const listResp = await request.get('/api/chat/sessions?agent_id=radar');
  expect(listResp.status()).toBe(200);
  const { sessions } = await listResp.json();
  const ids = sessions.map((s: { id: string }) => s.id);
  expect(
    ids,
    '侧栏应显示只有 metadata 的 session（Phase 2 bug fix）',
  ).toContain(threadId);

  // 3. preview 应降级到 config_prompt
  const found = sessions.find((s: { id: string }) => s.id === threadId);
  expect(found.preview).toBe('这是一个测试配置 prompt');
  expect(found.result_summary).toEqual({ evaluated: 5, promoted: 2, rejected: 3 });
});

test('preview 降级顺序：chat_messages > config_prompt > result_summary', async ({ request }) => {
  // 只有 result_summary 的 session（无 config_prompt）
  const threadId = `test-result-only-${Date.now()}`;
  const persistResp = await request.post('/api/chat/persist', {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      agent_id: 'radar',
      thread_id: threadId,
      result_summary: { evaluated: 10, promoted: 4, rejected: 6 },
    }),
  });
  expect(persistResp.status()).toBe(200);

  const listResp = await request.get('/api/chat/sessions?agent_id=radar');
  const { sessions } = await listResp.json();
  const found = sessions.find((s: { id: string }) => s.id === threadId);
  expect(found).toBeTruthy();
  expect(found.preview).toBe('推 4 / 滤 6');
});
