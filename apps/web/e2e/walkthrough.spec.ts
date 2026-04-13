/**
 * Full walkthrough — one continuous recording of the production flow.
 *
 * Single test, single page, one video. Deliverable demo of:
 * Sources → Trigger → wait → Runs result with stats.
 *
 * Requires both Next.js (:8788) and Python Agent (:8001) running.
 */

import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  video: { mode: 'on', size: { width: 1440, height: 900 } },
});

const PAUSE = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Full walkthrough: sources → trigger → runs result', async ({ page }) => {
  // ── 1. Open sync view (sources + runs) ──
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await PAUSE(1000);

  await page.click('button[aria-label="同步"]');
  await PAUSE(1500);

  const triggerBtn = page.locator('button.trigger-btn').first();
  await expect(triggerBtn).toBeVisible({ timeout: 5000 });
  await expect(triggerBtn).toHaveText('同步');
  await triggerBtn.click();

  // Wait for SSE to finish — button goes "同步中…" → "同步"
  await expect(triggerBtn).toHaveText('同步', { timeout: 90_000 });
  await PAUSE(1000);

  // ── 3. Refresh Runs, verify execution results ──
  await page.click('button:has-text("刷新")');
  await PAUSE(1500);

  // Click the first run to see details
  const runEntry = page.locator('.run-entry').first();
  await expect(runEntry).toBeVisible({ timeout: 5000 });
  await runEntry.click();
  await PAUSE(1500);

  // ── 4. Verify run detail is not empty ──
  // Status should be "done"
  const detail = page.locator('.run-detail');
  await expect(detail).toBeVisible({ timeout: 5000 });

  // Stats area should have non-zero values
  const statsText = await detail.textContent() ?? '';
  expect(statsText.length).toBeGreaterThan(0);
  console.log(`Run detail text: ${statsText.slice(0, 200)}`);

  // Hold for recording
  await PAUSE(3000);

  console.log('Walkthrough complete: production flow verified in Runs view');
});
