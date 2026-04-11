/**
 * E2E 全流程闭环测试（带录屏）
 *
 * 覆盖：Sources 配置 → Ingest 采集 → Evaluate 评判 → Items 消费 → Chat 对话
 *
 * 前置条件（手动或用 scripts/run-e2e.sh 自动启动）：
 *   1. pnpm dev:web          (Next.js :8788)
 *   2. uv run radar-serve    (Python :8001)
 *   3. pnpm db:init          (D1 初始化 + seed)
 *
 * 运行：
 *   cd apps/web && npx playwright test e2e/full-loop.spec.ts
 *   或：bash scripts/run-e2e.sh
 *
 * 产出（apps/web/e2e/test-results/）：
 *   - video/*.webm  — 全程录屏
 *   - *.png         — 关键节点截图
 *   - trace/*.zip   — Playwright trace
 */

import { test, expect } from '@playwright/test';

// 测试按顺序执行，后面的 phase 依赖前面的数据
test.describe.configure({ mode: 'serial' });

// ─── Phase 0: 健康检查 ───────────────────────────────────────────

test('Phase 0: Next.js is running', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
});

test('Phase 0: Python Agent is running', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:8001/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

// ─── Phase 1: Sources 配置 ───────────────────────────────────────

test('Phase 1: seed HN source exists', async ({ request }) => {
  const res = await request.get('/api/sources?agent_id=radar');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.sources.length).toBeGreaterThanOrEqual(1);

  const hn = body.sources.find((s: Record<string, unknown>) => s.id === 'src_hn_top');
  expect(hn).toBeTruthy();
  expect(hn.source_type).toBe('hacker-news');
  // Drizzle boolean mode: enabled 可能是 true 或 1
  expect(!!hn.enabled).toBe(true);
});

test('Phase 1: Sources view renders', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  await page.click('button[aria-label="Sources"]');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'e2e/test-results/01-sources-view.png' });

  // 用更精确的 locator：表格里的 cell
  await expect(page.getByRole('cell', { name: 'Hacker News Top Stories' })).toBeVisible();
});

// ─── Phase 2: Ingest 采集 ────────────────────────────────────────

test('Phase 2: ingest creates raw_items', async ({ request }) => {
  // 直接调 Python /ingest（绕过 SSE 透传，更可靠）
  const res = await request.post('http://127.0.0.1:8001/ingest', {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer dev-radar-token-change-me',
    },
    data: JSON.stringify({
      sources: [{ id: 'src_hn_top', source_type: 'hacker-news', config: { limit: 10 } }],
    }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);

  // SSE 流：读取文本确认有 result 事件
  const text = await res.text();
  expect(text).toContain('"phase"');
  expect(text).toContain('ingest');

  // 等一下让数据落库
  await new Promise((r) => setTimeout(r, 1000));

  // 验证 raw_items 写入
  const rawRes = await request.get('/api/raw-items?agent_id=radar&limit=5');
  expect(rawRes.status()).toBe(200);
  const rawBody = await rawRes.json();
  expect(rawBody.raw_items.length).toBeGreaterThan(0);
});

// ─── Phase 3: Evaluate 评判 ──────────────────────────────────────

test('Phase 3: evaluate promotes raw_items to items', async ({ request }) => {
  const res = await request.post('http://127.0.0.1:8001/evaluate', {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer dev-radar-token-change-me',
    },
    data: JSON.stringify({ agent_id: 'radar' }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);

  const text = await res.text();
  expect(text).toContain('"phase"');
  expect(text).toContain('evaluate');

  await new Promise((r) => setTimeout(r, 1000));

  // 验证 items 存在
  const itemsRes = await request.get('/api/items?agent_id=radar&limit=5');
  expect(itemsRes.status()).toBe(200);
  const itemsBody = await itemsRes.json();
  expect(itemsBody.items.length).toBeGreaterThan(0);
});

test('Phase 3: raw_items promoted', async ({ request }) => {
  const rawRes = await request.get('/api/raw-items?agent_id=radar&status=promoted&limit=5');
  expect(rawRes.status()).toBe(200);
  const rawBody = await rawRes.json();
  expect(rawBody.raw_items.length).toBeGreaterThan(0);
});

// ─── Phase 4: Runs 记录 ─────────────────────────────────────────

test('Phase 4: runs exist for ingest and evaluate', async ({ request }) => {
  const res = await request.get('/api/runs?agent_id=radar');
  expect(res.status()).toBe(200);
  const body = await res.json();
  const phases = body.runs.map((r: Record<string, unknown>) => r.phase);
  expect(phases).toContain('ingest');
  expect(phases).toContain('evaluate');
});

test('Phase 4: Runs view renders', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  await page.click('button[aria-label="Runs"]');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'e2e/test-results/02-runs-view.png' });

  await expect(page.locator('.run-card').first()).toBeVisible();
});

// ─── Phase 5: UI 全流程 ─────────────────────────────────────────

test('Phase 5: inbox shows items, select and chat', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  // Inbox
  await page.click('button[aria-label="Inbox"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/test-results/03-inbox.png' });

  // 选择第一个 item
  const firstItem = page.locator('.item-row').first();
  await expect(firstItem).toBeVisible({ timeout: 10_000 });
  await firstItem.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/test-results/04-item-selected.png' });

  // ChatView 出现
  const chatCol = page.locator('.chat-col');
  await expect(chatCol).toBeVisible();

  // 尝试发消息
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    await textarea.fill('这篇文章的核心观点是什么？');
    await page.screenshot({ path: 'e2e/test-results/05-chat-input.png' });

    await textarea.press('Enter');
    // 等 AI 响应
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e/test-results/06-chat-response.png' });
  }
});

// ─── Phase 6: 数据闭环验证 ──────────────────────────────────────

test('Phase 6: full data loop verified', async ({ request }) => {
  // 1. Sources
  const srcRes = await request.get('/api/sources?agent_id=radar');
  const sources = (await srcRes.json()).sources;
  expect(sources.length).toBeGreaterThan(0);

  // 2. raw_items（ingest 产出）
  const rawRes = await request.get('/api/raw-items?agent_id=radar&limit=100');
  const rawItems = (await rawRes.json()).raw_items;
  expect(rawItems.length).toBeGreaterThan(0);

  // 3. items（evaluate 产出）
  const itemsRes = await request.get('/api/items?agent_id=radar&limit=100');
  const itemsBody = await itemsRes.json();
  expect(itemsBody.items.length).toBeGreaterThan(0);

  // 4. runs 记录
  const runsRes = await request.get('/api/runs?agent_id=radar');
  const runs = (await runsRes.json()).runs;
  expect(runs.filter((r: Record<string, unknown>) => r.phase === 'ingest').length).toBeGreaterThan(0);
  expect(runs.filter((r: Record<string, unknown>) => r.phase === 'evaluate').length).toBeGreaterThan(0);

  // 5. 数据链路完整：所有层都有数据
  //    注：多次运行 E2E 会积累历史数据，不做严格数量对比
  console.log(`Funnel: sources=${sources.length} raw_items=${rawItems.length} items=${itemsBody.items.length} runs=${runs.length}`);
});
