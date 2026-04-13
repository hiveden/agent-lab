/**
 * Production E2E -- data pipeline (Sources / Ingest / Evaluate / Runs)
 *
 * Exercises the full ingestion + evaluation pipeline against live Python Agent,
 * then verifies management views and data lineage.
 *
 * Requires both Next.js (:8788) and Python Agent (:8001) running.
 */

import { test, expect } from '@playwright/test';
import { runVisualAudit } from './helpers/visual-audit';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };
const PYTHON = 'http://127.0.0.1:8001';

// ─── Step 1: Health check ────────────────────────────────────

test('Step 1: services healthy', async ({ request }) => {
  expect((await request.get('/')).status()).toBe(200);
  const py = await request.get(`${PYTHON}/health`);
  expect((await py.json()).status).toBe('ok');
});

// ─── Step 2: Source config + empty inbox visual ──────────────

test('Step 2: seed sources exist, empty inbox renders clean', async ({ page, request }) => {
  const res = await request.get('/api/sources?agent_id=radar');
  const sources = (await res.json()).sources;
  expect(sources.length).toBeGreaterThanOrEqual(1);

  const types = sources.map((s: Record<string, string>) => s.source_type);
  expect(types).toContain('hacker-news');

  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/test-results/p-01-empty-inbox.png' });
  await runVisualAudit(page, 'production-empty-inbox');
});

// ─── Step 2b: Test Collect ───────────────────────────────────

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

// ─── Step 3: Ingest ──────────────────────────────────────────

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

  // raw_items written
  const raw = await request.get('/api/raw-items?agent_id=radar');
  const rawItems = (await raw.json()).raw_items;
  expect(rawItems.length).toBeGreaterThan(0);

  // run record created
  const runs = await request.get('/api/runs?agent_id=radar&phase=ingest');
  expect((await runs.json()).runs.length).toBeGreaterThanOrEqual(1);

  console.log(`Ingest: ${rawItems.length} raw_items`);
});

// ─── Step 4: Evaluate ────────────────────────────────────────

test('Step 4: evaluate promotes items', async ({ request }) => {
  const res = await request.post(`${PYTHON}/evaluate`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ agent_id: 'radar' }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);
  await new Promise((r) => setTimeout(r, 1500));

  // items exist
  const items = (await (await request.get('/api/items?agent_id=radar')).json()).items;
  expect(items.length).toBeGreaterThan(0);

  // raw_items status transition
  const promoted = (await (await request.get('/api/raw-items?agent_id=radar&status=promoted')).json()).raw_items;
  const rejected = (await (await request.get('/api/raw-items?agent_id=radar&status=rejected')).json()).raw_items;
  const pending = (await (await request.get('/api/raw-items?agent_id=radar&status=pending')).json()).raw_items;

  expect(promoted.length + rejected.length).toBeGreaterThan(0);
  expect(pending.length).toBe(0);

  console.log(`Evaluate: ${promoted.length} promoted, ${rejected.length} rejected, ${items.length} items`);
});

// ─── Step 5: Management views ────────────────────────────────

test('Step 5: management views render clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  // Sources
  await page.click('button[aria-label="Sources"]');
  await page.waitForTimeout(500);
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/p-02-sources.png' });
  await runVisualAudit(page, 'production-sources');

  // Runs
  await page.click('button[aria-label="Runs"]');
  await page.waitForTimeout(500);
  await expect(page.locator('.run-entry').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/p-03-runs.png' });
  await runVisualAudit(page, 'production-runs');
});

// ─── Step 6: Data lineage ────────────────────────────────────

test('Step 6: data lineage complete', async ({ request }) => {
  const sources = (await (await request.get('/api/sources?agent_id=radar')).json()).sources;
  const rawItems = (await (await request.get('/api/raw-items?agent_id=radar')).json()).raw_items;
  const items = (await (await request.get('/api/items?agent_id=radar')).json()).items;
  const runs = (await (await request.get('/api/runs?agent_id=radar')).json()).runs;
  const att = await (await request.get('/api/attention/snapshot?agent_id=radar')).json();

  expect(sources.length).toBeGreaterThan(0);
  expect(rawItems.length).toBeGreaterThan(0);
  expect(items.length).toBeGreaterThan(0);
  expect(runs.length).toBeGreaterThanOrEqual(2);

  console.log('\n== PRODUCTION DATA LINEAGE ==');
  console.log(`Sources: ${sources.length} | Raw: ${rawItems.length} | Items: ${items.length} | Runs: ${runs.length}`);
  for (const s of att.sources) {
    console.log(`  ${s.source_name}: expected=${(s.expected_weight * 100).toFixed(0)}% actual=${(s.actual_weight * 100).toFixed(0)}% dev=${(s.deviation * 100).toFixed(0)}%`);
  }
  console.log('=============================\n');
});
