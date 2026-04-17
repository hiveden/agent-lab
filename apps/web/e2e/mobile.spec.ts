/**
 * Mobile E2E — 完整用户路径 + 视觉审计
 *
 * 在 desktop.spec.ts 之后运行（复用其数据），验证移动端布局和交互。
 */

import { test, expect } from '@playwright/test';
import { runVisualAudit } from './helpers/visual-audit';

test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
test.describe.configure({ mode: 'serial' });

// ─── Step 1: 布局正确性 ───────────────────────────────────

test('Step 1: mobile layout — tab bar, no nav rail', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Tab bar visible (nav element at bottom)
  await expect(page.locator('nav').first()).toBeVisible();
  // Nav rail not visible on mobile
  await expect(page.locator('aside')).not.toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/m-01-layout.png' });
  await runVisualAudit(page, 'mobile-layout');
});

// ─── Step 2: 卡片列表 + 视觉 ──────────────────────────────

test('Step 2: card list renders, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Cards rendered (mobile uses data-id on cards)
  const cards = page.locator('[data-card-id]');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'e2e/test-results/m-02-cards.png' });
  await runVisualAudit(page, 'mobile-cards');
});

// ─── Step 3: 点击 → 全屏对话 + 视觉 ─────────────────────

test('Step 3: tap card → full-screen chat, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('[data-card-id]').first().click();
  await page.waitForTimeout(500);

  // Chat visible (textarea present)
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'e2e/test-results/m-03-chat.png' });
  await runVisualAudit(page, 'mobile-chat');
});

// ─── Step 4: 对话发消息 ───────────────────────────────────

test('Step 4: send message in chat', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('[data-card-id]').first().click();
  await page.waitForTimeout(500);

  const textarea = page.locator('textarea').first();
  await textarea.fill('总结要点');
  await page.screenshot({ path: 'e2e/test-results/m-04-input.png' });

  await textarea.press('Enter');
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'e2e/test-results/m-05-response.png' });
  await runVisualAudit(page, 'mobile-chat-response');
});

// ─── Step 5: 返回列表 ─────────────────────────────────────

test('Step 5: back button returns to list', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const card = page.locator('[data-card-id]').first();
  if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) {
    // Switch to Watch tab
    await page.locator('button[aria-label="Watch"]').click();
    await page.waitForTimeout(500);
  }

  const visibleCard = page.locator('[data-card-id]').first();
  if (await visibleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await visibleCard.click();
    await page.waitForTimeout(500);

    // Click back button
    await page.locator('button', { hasText: /←|Back/ }).first().click();
    await page.waitForTimeout(500);

    // Tab bar visible again
    await expect(page.locator('nav').first()).toBeVisible();
  }
});

// ─── Step 6: Tab 切换 + 各视图视觉 ───────────────────────

test('Step 6: tab switching, each view visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  // Wait for TabBar to render instead of networkidle — CopilotKit / SWR may
  // keep background requests open long enough to starve networkidle.
  await expect(page.locator('nav button[aria-label="Watch"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);

  // Watch tab
  await page.locator('button[aria-label="Watch"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/test-results/m-06-watch.png' });

  // Mirror tab
  await page.locator('button[aria-label="Mirror"]').click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: /注意力镜像|Attention/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'e2e/test-results/m-07-attention.png' });
  await runVisualAudit(page, 'mobile-attention');

  // Runs tab
  await page.locator('button[aria-label="Runs"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.runs-master-detail')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'e2e/test-results/m-08-runs.png' });
  await runVisualAudit(page, 'mobile-runs');

  // Settings tab
  await page.locator('button[aria-label="Settings"]').click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: /LLM (设置|Settings)/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'e2e/test-results/m-09-settings.png' });
  await runVisualAudit(page, 'mobile-settings');
});
