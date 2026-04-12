/**
 * Desktop E2E — 完整用户路径 + 视觉审计
 *
 * 干净数据库起步，每步验证功能 + 样式。
 */

import { test, expect } from '@playwright/test';
import { runVisualAudit } from './helpers/visual-audit';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };
const PYTHON = 'http://127.0.0.1:8001';

// ─── Step 1: 健康检查 ──────────────────────────────────────

test('Step 1: services healthy', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
  const py = await request.get(`${PYTHON}/health`);
  expect((await py.json()).status).toBe('ok');
});

// ─── Step 2: Source 配置 + 空状态视觉 ──────────────────────

test('Step 2: seed sources exist, empty inbox renders clean', async ({ page, request }) => {
  const res = await request.get('/api/sources?agent_id=radar');
  const sources = (await res.json()).sources;
  expect(sources.length).toBeGreaterThanOrEqual(1);

  const types = sources.map((s: Record<string, string>) => s.source_type);
  expect(types).toContain('hacker-news');

  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/test-results/d-01-empty-inbox.png' });
  await runVisualAudit(page, 'desktop-empty-inbox');
});

// ─── Step 2b: Test Collect — 验证各类型 collector 能采集 ────

test('Step 2b: test-collect works for each source type', async ({ request }) => {
  // HN
  const hn = await request.post(`${PYTHON}/test-collect`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ source_type: 'hacker-news', config: { limit: 3 } }),
    timeout: 30_000,
  });
  const hnBody = await hn.json();
  console.log(`  test-collect HN: status=${hn.status()} body=${JSON.stringify(hnBody).slice(0, 200)}`);
  expect(hn.status(), `HN test-collect HTTP ${hn.status()}`).toBe(200);
  expect(hnBody.ok, `HN test-collect failed: ${hnBody.error || hnBody.detail}`).toBe(true);
  expect(hnBody.count).toBeGreaterThan(0);

  // HTTP (GitHub)
  const http = await request.post(`${PYTHON}/test-collect`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      source_type: 'http',
      config: {
        url: 'https://api.github.com/search/repositories?q=created:%3E2026-04-01&sort=stars&order=desc&per_page=3',
        method: 'GET',
        items_path: 'items',
        mapping: { external_id: 'full_name', title: 'full_name', url: 'html_url' },
        limit: 3,
      },
    }),
    timeout: 30_000,
  });
  const httpBody = await http.json();
  expect(httpBody.ok, `HTTP test-collect failed: ${httpBody.error}`).toBe(true);
  expect(httpBody.count).toBeGreaterThan(0);
  console.log(`  test-collect HTTP: ${httpBody.count} items`);

  // RSS
  const rss = await request.post(`${PYTHON}/test-collect`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      source_type: 'rss',
      config: { feed_url: 'https://buttondown.com/ainews/rss', limit: 3 },
    }),
    timeout: 30_000,
  });
  const rssBody = await rss.json();
  expect(rssBody.ok, `RSS test-collect failed: ${rssBody.error}`).toBe(true);
  expect(rssBody.count).toBeGreaterThan(0);
  console.log(`  test-collect RSS: ${rssBody.count} items`);

  // Unknown type should fail gracefully
  const bad = await request.post(`${PYTHON}/test-collect`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ source_type: 'nonexistent', config: {} }),
    timeout: 10_000,
  });
  expect(bad.status()).toBe(400);
});

// ─── Step 3: Ingest ────────────────────────────────────────

test('Step 3: ingest creates raw_items', async ({ request }) => {
  const res = await request.post(`${PYTHON}/ingest`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      sources: [{ id: 'src_hn_top', source_type: 'hacker-news', config: { limit: 5 } }],
    }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);
  await new Promise((r) => setTimeout(r, 1000));

  // raw_items 写入
  const raw = await request.get('/api/raw-items?agent_id=radar');
  const rawItems = (await raw.json()).raw_items;
  expect(rawItems.length).toBeGreaterThan(0);

  // run 记录
  const runs = await request.get('/api/runs?agent_id=radar&phase=ingest');
  expect((await runs.json()).runs.length).toBeGreaterThanOrEqual(1);

  console.log(`Ingest: ${rawItems.length} raw_items`);
});

// ─── Step 4: Evaluate ──────────────────────────────────────

test('Step 4: evaluate promotes items', async ({ request }) => {
  const res = await request.post(`${PYTHON}/evaluate`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ agent_id: 'radar' }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);
  await new Promise((r) => setTimeout(r, 1500));

  // items 存在
  const items = (await (await request.get('/api/items?agent_id=radar')).json()).items;
  expect(items.length).toBeGreaterThan(0);

  // raw_items 状态跃迁
  const promoted = (await (await request.get('/api/raw-items?agent_id=radar&status=promoted')).json()).raw_items;
  const rejected = (await (await request.get('/api/raw-items?agent_id=radar&status=rejected')).json()).raw_items;
  const pending = (await (await request.get('/api/raw-items?agent_id=radar&status=pending')).json()).raw_items;

  expect(promoted.length + rejected.length).toBeGreaterThan(0);
  expect(pending.length).toBe(0);

  console.log(`Evaluate: ${promoted.length} promoted, ${rejected.length} rejected, ${items.length} items`);
});

// ─── Step 5: Inbox 有数据 + 视觉 ──────────────────────────

test('Step 5: inbox shows items, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const rows = page.locator('[data-id]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);

  await page.screenshot({ path: 'e2e/test-results/d-02-inbox-with-items.png' });
  await runVisualAudit(page, 'desktop-inbox');

  console.log(`Inbox: ${count} items rendered`);
});

// ─── Step 6: 选 item + Chat ───────────────────────────────

test('Step 6: select item, chat, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('[data-id]').first().click();
  await page.waitForTimeout(500);

  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'e2e/test-results/d-03-chat-view.png' });
  await runVisualAudit(page, 'desktop-chat');

  // 发消息
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    await textarea.fill('核心观点是什么？');
    await textarea.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e/test-results/d-04-chat-response.png' });
  }
});

// ─── Step 7: 状态跃迁 ─────────────────────────────────────

test('Step 7: status transitions persist', async ({ request }) => {
  const items = (await (await request.get('/api/items?agent_id=radar&status=unread&limit=1')).json()).items;
  if (!items.length) return;

  const id = items[0].id;
  await request.patch(`/api/items/${id}/state`, { data: { status: 'watching' } });
  let verify = (await (await request.get(`/api/items/${id}`)).json()).item;
  expect(verify.status).toBe('watching');

  await request.patch(`/api/items/${id}/state`, { data: { status: 'dismissed' } });
  verify = (await (await request.get(`/api/items/${id}`)).json()).item;
  expect(verify.status).toBe('dismissed');

  // dwell_ms 累加
  await request.patch(`/api/items/${id}/state`, { data: { dwell_ms: 3000 } });
  await request.patch(`/api/items/${id}/state`, { data: { dwell_ms: 2000 } });

  console.log(`Status: ${id} unread → watching → dismissed + 5s dwell`);
});

// ─── Step 8: Attention 偏差 ───────────────────────────────

test('Step 8: attention snapshot works', async ({ page, request }) => {
  // 检查快照 API
  const snap = await (await request.get('/api/attention/snapshot?agent_id=radar')).json();
  expect(snap.sources.length).toBeGreaterThan(0);
  expect(snap.computed_at).toBeTruthy();

  // 每个 source 有正确的结构
  for (const src of snap.sources) {
    expect(typeof src.expected_weight).toBe('number');
    expect(typeof src.actual_weight).toBe('number');
    expect(typeof src.deviation).toBe('number');
  }

  // 有活动时 actual_weights 之和 ≈ 1
  if (snap.total_score > 0) {
    const totalActual = snap.sources.reduce((s: number, x: { actual_weight: number }) => s + x.actual_weight, 0);
    expect(totalActual).toBeGreaterThan(0.99);
  }

  console.log('Attention:', snap.sources.map((s: Record<string, unknown>) =>
    `${s.source_name}: exp=${((s.expected_weight as number) * 100).toFixed(0)}% act=${((s.actual_weight as number) * 100).toFixed(0)}%`
  ).join(', '));

  // UI 视觉
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.click('button[aria-label="Attention"]');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'e2e/test-results/d-05-attention.png' });
  await runVisualAudit(page, 'desktop-attention');
});

// ─── Step 9: Sources/Runs 视图 ────────────────────────────

test('Step 9: management views render clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  // Sources
  await page.click('button[aria-label="Sources"]');
  await page.waitForTimeout(500);
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/d-06-sources.png' });
  await runVisualAudit(page, 'desktop-sources');

  // Runs
  await page.click('button[aria-label="Runs"]');
  await page.waitForTimeout(500);
  await expect(page.locator('.run-entry').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/d-07-runs.png' });
  await runVisualAudit(page, 'desktop-runs');
});

// ─── Step 10: 数据链路汇总 ────────────────────────────────

test('Step 10: data lineage complete', async ({ request }) => {
  const sources = (await (await request.get('/api/sources?agent_id=radar')).json()).sources;
  const rawItems = (await (await request.get('/api/raw-items?agent_id=radar')).json()).raw_items;
  const items = (await (await request.get('/api/items?agent_id=radar')).json()).items;
  const runs = (await (await request.get('/api/runs?agent_id=radar')).json()).runs;
  const att = await (await request.get('/api/attention/snapshot?agent_id=radar')).json();

  expect(sources.length).toBeGreaterThan(0);
  expect(rawItems.length).toBeGreaterThan(0);
  expect(items.length).toBeGreaterThan(0);
  expect(runs.length).toBeGreaterThanOrEqual(2);

  console.log('\n══ DESKTOP DATA LINEAGE ══');
  console.log(`Sources: ${sources.length} | Raw: ${rawItems.length} | Items: ${items.length} | Runs: ${runs.length}`);
  for (const s of att.sources) {
    console.log(`  ${s.source_name}: expected=${(s.expected_weight * 100).toFixed(0)}% actual=${(s.actual_weight * 100).toFixed(0)}% dev=${(s.deviation * 100).toFixed(0)}%`);
  }
  console.log('══════════════════════════\n');
});
