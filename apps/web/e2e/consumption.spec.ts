/**
 * Consumption E2E -- Inbox / Chat / Status / Attention
 *
 * Self-contained: seeds data via API in beforeAll (no dependency on real
 * ingestion or Python Agent). Only requires Next.js (:8788).
 */

import { test, expect } from '@playwright/test';
import { runVisualAudit } from './helpers/visual-audit';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };
const NOW = new Date().toISOString();

// ─── Seed data ───────────────────────────────────────────────

const SEED_RAW_ITEMS = [
  { source_id: 'src_hn_top', agent_id: 'radar', external_id: 'e2e-raw-1', title: 'E2E Raw Item 1: WebGPU Shader Tricks', url: 'https://example.com/raw-1', raw_payload: {} },
  { source_id: 'src_hn_top', agent_id: 'radar', external_id: 'e2e-raw-2', title: 'E2E Raw Item 2: Rust in Production', url: 'https://example.com/raw-2', raw_payload: {} },
  { source_id: 'src_hn_top', agent_id: 'radar', external_id: 'e2e-raw-3', title: 'E2E Raw Item 3: LLM Evaluation Frameworks', url: 'https://example.com/raw-3', raw_payload: {} },
];

const SEED_ITEMS = [
  { external_id: 'e2e-item-1', agent_id: 'radar', item_type: 'article', grade: 'fire', title: 'WebGPU Shader Tricks for Real-Time Rendering', summary: 'A deep dive into advanced WebGPU shader techniques for building performant real-time 3D applications in the browser.', why: 'Cutting-edge GPU programming for the web platform', url: 'https://example.com/1', source: 'src_hn_top', tags: ['webgpu', 'graphics'], payload: {} },
  { external_id: 'e2e-item-2', agent_id: 'radar', item_type: 'article', grade: 'bolt', title: 'Rust in Production: Lessons from 3 Years at Scale', summary: 'Battle-tested patterns and pitfalls from running Rust microservices serving millions of requests.', why: 'Real-world Rust adoption insights', url: 'https://example.com/2', source: 'src_hn_top', tags: ['rust', 'infrastructure'], payload: {} },
  { external_id: 'e2e-item-3', agent_id: 'radar', item_type: 'article', grade: 'bulb', title: 'LLM Evaluation Frameworks Compared', summary: 'Comprehensive comparison of evaluation frameworks for large language models including accuracy and latency benchmarks.', why: 'Essential for AI engineering workflow', url: 'https://example.com/3', source: 'src_hn_top', tags: ['llm', 'evaluation'], payload: {} },
];

test.beforeAll(async ({ request }) => {
  // Seed raw_items
  const rawRes = await request.post('/api/raw-items/batch', {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ items: SEED_RAW_ITEMS }),
  });
  expect(rawRes.status(), `Failed to seed raw_items: ${rawRes.status()}`).toBe(200);

  // Seed items
  const itemRes = await request.post('/api/items/batch', {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ round_at: NOW, items: SEED_ITEMS }),
  });
  expect(itemRes.status(), `Failed to seed items: ${itemRes.status()}`).toBe(200);

  // Verify seed landed
  const check = await request.get('/api/items?agent_id=radar');
  const body = await check.json();
  expect(body.items.length).toBeGreaterThan(0);
  console.log(`Seeded ${SEED_RAW_ITEMS.length} raw_items + ${SEED_ITEMS.length} items`);
});

// ─── Step 1: Inbox shows items ───────────────────────────────

test('Step 1: inbox shows items, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const rows = page.locator('[data-id]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);

  await page.screenshot({ path: 'e2e/test-results/c-01-inbox-with-items.png' });
  await runVisualAudit(page, 'consumption-inbox');

  console.log(`Inbox: ${count} items rendered`);
});

// ─── Step 2: Select item + Chat ──────────────────────────────

test('Step 2: select item, chat, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('[data-id]').first().click();
  await page.waitForTimeout(500);

  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'e2e/test-results/c-02-chat-view.png' });
  await runVisualAudit(page, 'consumption-chat');

  // Send message
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    await textarea.fill('What is the key insight?');
    await textarea.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e/test-results/c-03-chat-response.png' });
  }
});

// ─── Step 3: Status transitions ──────────────────────────────

test('Step 3: status transitions persist', async ({ request }) => {
  const items = (await (await request.get('/api/items?agent_id=radar&status=unread&limit=1')).json()).items;
  if (!items.length) return;

  const id = items[0].id;
  await request.patch(`/api/items/${id}/state`, { data: { status: 'watching' } });
  let verify = (await (await request.get(`/api/items/${id}`)).json()).item;
  expect(verify.status).toBe('watching');

  await request.patch(`/api/items/${id}/state`, { data: { status: 'dismissed' } });
  verify = (await (await request.get(`/api/items/${id}`)).json()).item;
  expect(verify.status).toBe('dismissed');

  // dwell_ms accumulation
  await request.patch(`/api/items/${id}/state`, { data: { dwell_ms: 3000 } });
  await request.patch(`/api/items/${id}/state`, { data: { dwell_ms: 2000 } });

  console.log(`Status: ${id} unread -> watching -> dismissed + 5s dwell`);
});

// ─── Step 4: Attention snapshot ──────────────────────────────

test('Step 4: attention snapshot works', async ({ page, request }) => {
  // Check snapshot API
  const snap = await (await request.get('/api/attention/snapshot?agent_id=radar')).json();
  expect(snap.sources.length).toBeGreaterThan(0);
  expect(snap.computed_at).toBeTruthy();

  // Each source has correct structure
  for (const src of snap.sources) {
    expect(typeof src.expected_weight).toBe('number');
    expect(typeof src.actual_weight).toBe('number');
    expect(typeof src.deviation).toBe('number');
  }

  // When active, actual_weights sum ~ 1
  if (snap.total_score > 0) {
    const totalActual = snap.sources.reduce((s: number, x: { actual_weight: number }) => s + x.actual_weight, 0);
    expect(totalActual).toBeGreaterThan(0.99);
  }

  console.log('Attention:', snap.sources.map((s: Record<string, unknown>) =>
    `${s.source_name}: exp=${((s.expected_weight as number) * 100).toFixed(0)}% act=${((s.actual_weight as number) * 100).toFixed(0)}%`
  ).join(', '));

  // UI visual
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.click('button[aria-label="Attention"]');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'e2e/test-results/c-04-attention.png' });
  await runVisualAudit(page, 'consumption-attention');
});
