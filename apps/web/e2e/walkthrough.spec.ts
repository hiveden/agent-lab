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

test('Full walkthrough: trigger → runs → inbox → chat', async ({ page, request }) => {
  // ── 1. Open radar, see empty inbox ──
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await PAUSE(1500);

  // ── 2. Check Sources — confirm HN source exists ──
  await page.click('button[aria-label="Sources"]');
  await PAUSE(1500);

  // ── 3. Go to Runs and trigger collection ──
  await page.click('button[aria-label="Runs"]');
  await PAUSE(1000);

  const triggerBtn = page.locator('button.trigger-btn:has-text("Trigger")').first();
  await expect(triggerBtn).toBeVisible({ timeout: 5000 });
  await triggerBtn.click();

  // Wait for collection to finish (up to 90s)
  await expect(triggerBtn).not.toHaveText('Running', { timeout: 90_000 });
  await PAUSE(2000);

  // ── 4. Refresh Runs — see execution results ──
  await page.click('button:has-text("Refresh")');
  await PAUSE(2000);

  // Click the first run to see details
  const runEntry = page.locator('.run-entry').first();
  if (await runEntry.isVisible({ timeout: 3000 }).catch(() => false)) {
    await runEntry.click();
    await PAUSE(2000);
  }

  // ── 5. Switch to Inbox — see collected items ──
  await page.click('button[aria-label="Radar"]');
  await PAUSE(2000);

  // Verify items appeared
  const items = page.locator('[data-id]');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const count = await items.count();
  await PAUSE(1500);

  // ── 6. Click an item — open chat ──
  await items.first().click();
  await PAUSE(1500);

  // Verify chat area is visible
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5000 });
  await PAUSE(1000);

  // ── 7. Send a message ──
  const textarea = page.locator('textarea').first();
  await textarea.fill('What is the key insight from this article?');
  await PAUSE(500);
  await textarea.press('Enter');

  // Wait for response
  await PAUSE(8000);

  // ── 8. Final pause to show the result ──
  await PAUSE(2000);

  console.log(`Walkthrough complete: ${count} items in inbox`);
});
