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

  await expect(page.locator('.tab-bar')).toBeVisible();
  await expect(page.locator('.nav-rail')).not.toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/m-01-layout.png' });
  await runVisualAudit(page, 'mobile-layout');
});

// ─── Step 2: 卡片列表 + 视觉 ──────────────────────────────

test('Step 2: card list renders, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const cards = page.locator('.m-card');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });

  // 滑动结构存在
  await expect(page.locator('.m-swipe-wrapper').first()).toBeVisible();

  // filter chips
  await expect(page.locator('.m-filter-chip').first()).toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/m-02-cards.png' });
  await runVisualAudit(page, 'mobile-cards');
});

// ─── Step 3: 点击 → 全屏对话 + 视觉 ─────────────────────

test('Step 3: tap card → full-screen chat, visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('.m-card').first().click();
  await page.waitForTimeout(500);

  // 对话全屏
  await expect(page.locator('.m-chat')).toBeVisible();
  await expect(page.locator('.m-chat-header')).toBeVisible();
  await expect(page.locator('.m-chat-input')).toBeVisible();
  // Tab Bar 应该不可见
  await expect(page.locator('.tab-bar')).not.toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/m-03-chat.png' });
  await runVisualAudit(page, 'mobile-chat');
});

// ─── Step 4: 对话发消息 ───────────────────────────────────

test('Step 4: send message in chat', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.locator('.m-card').first().click();
  await page.waitForTimeout(500);

  const textarea = page.locator('.m-chat-input textarea');
  await textarea.fill('总结要点');
  await page.screenshot({ path: 'e2e/test-results/m-04-input.png' });

  await textarea.press('Enter');
  await page.waitForTimeout(5000);

  // 用户消息出现
  await expect(page.locator('.m-msg.user').first()).toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/m-05-response.png' });
  await runVisualAudit(page, 'mobile-chat-response');
});

// ─── Step 5: 返回列表 ─────────────────────────────────────

test('Step 5: back button returns to list', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 可能没有 unread 卡片了（Step 4 的 chat 触发了 viewing 跃迁）
  // 切到 watching tab 找卡片
  const card = page.locator('.m-card').first();
  if (!(await card.isVisible({ timeout: 3000 }).catch(() => false))) {
    await page.locator('.tab-item', { hasText: 'Watch' }).click();
    await page.waitForTimeout(500);
  }

  const visibleCard = page.locator('.m-card').first();
  if (await visibleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await visibleCard.click();
    await page.waitForTimeout(500);

    await page.locator('.m-back-btn').click();
    await page.waitForTimeout(500);

    await expect(page.locator('.m-cards')).toBeVisible();
    await expect(page.locator('.tab-bar')).toBeVisible();
  }
});

// ─── Step 6: Tab 切换 + 各视图视觉 ───────────────────────

test('Step 6: tab switching, each view visual clean', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Watch tab
  await page.locator('.tab-item', { hasText: 'Watch' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/test-results/m-06-watch.png' });

  // Mirror tab
  await page.locator('.tab-item', { hasText: 'Mirror' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.attention-view')).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/m-07-attention.png' });
  await runVisualAudit(page, 'mobile-attention');

  // Runs tab
  await page.locator('.tab-item', { hasText: 'Runs' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.runs-view')).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/m-08-runs.png' });
  await runVisualAudit(page, 'mobile-runs');

  // Settings tab
  await page.locator('.tab-item', { hasText: 'Settings' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.settings-view')).toBeVisible();
  await page.screenshot({ path: 'e2e/test-results/m-09-settings.png' });
  await runVisualAudit(page, 'mobile-settings');
});
