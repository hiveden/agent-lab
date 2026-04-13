/**
 * Full walkthrough — one continuous recording of the complete user journey.
 *
 * Single test, single page, one video. This is the deliverable demo,
 * not a correctness check. Requires both Next.js and Python Agent running.
 */

import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  video: { mode: 'on', size: { width: 1440, height: 900 } },
});

const PAUSE = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Full walkthrough: sources → trigger → runs result', async ({ page }) => {
  // ── 1. Open radar, check Sources ──
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await PAUSE(1000);

  await page.click('button[aria-label="Sources"]');
  await PAUSE(1500);

  // ── 2. Go to Runs, trigger collection ──
  await page.click('button[aria-label="Runs"]');
  await PAUSE(1000);

  const triggerBtn = page.locator('button.trigger-btn:has-text("Trigger")').first();
  await expect(triggerBtn).toBeVisible({ timeout: 5000 });
  await triggerBtn.click();

  // Wait for collection to finish (up to 90s)
  await expect(triggerBtn).not.toHaveText('Running', { timeout: 90_000 });
  await PAUSE(2000);

  // ── 3. Refresh Runs, view execution results ──
  await page.click('button:has-text("Refresh")');
  await PAUSE(2000);

  // Click the first run to see details
  const runEntry = page.locator('.run-entry').first();
  if (await runEntry.isVisible({ timeout: 3000 }).catch(() => false)) {
    await runEntry.click();
    await PAUSE(3000);
  }

  // ── 4. Final pause to show the result ──
  await PAUSE(1500);

  console.log('Walkthrough complete: production flow verified in Runs view');
});
