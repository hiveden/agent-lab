/**
 * 样式正确性测试 — 断言 computed styles 符合 design tokens 规范
 *
 * TDD: 先定义"正确"是什么，再让实现通过测试。
 * 不依赖 baseline 截图，直接断言 CSS 属性的绝对值。
 */

import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };
const NOW = new Date().toISOString();

// Seed one item so Inbox has a card to inspect
const SEED_ITEMS = [
  {
    external_id: 'style-test-1', agent_id: 'radar', item_type: 'article',
    grade: 'fire', title: 'Style Test Item',
    summary: 'A test item for verifying CSS styles.',
    why: 'Style verification', url: 'https://example.com/style',
    source: 'test', tags: ['test'], payload: {},
  },
];

test.beforeAll(async ({ request }) => {
  await request.post('/api/items/batch', {
    headers: AUTH,
    data: { round_at: NOW, items: SEED_ITEMS },
  });
});

// ── Design Token Expected Values (from globals.css :root) ──

const TOKENS = {
  bg: 'rgb(251, 250, 248)',           // #fbfaf8
  surface: 'rgb(255, 255, 255)',       // #ffffff
  surfaceHi: 'rgb(252, 251, 249)',     // #fcfbf9
  border: 'rgb(235, 232, 226)',        // #ebe8e2
  borderHi: 'rgb(221, 217, 208)',      // #ddd9d0
  text: 'rgb(29, 30, 34)',             // #1d1e22
  text2: 'rgb(81, 83, 92)',            // #51535c
  text3: 'rgb(133, 135, 146)',         // #858792
  accent: 'rgb(79, 70, 229)',          // #4f46e5
  fire: 'rgb(233, 107, 40)',           // #e96b28
  bolt: 'rgb(50, 103, 214)',           // #3267d6
};

// ── Tests ──

test.describe('Design Tokens', () => {
  test('body: font, size, color, background', async ({ page }) => {
    await page.goto('/agents/radar');
    await page.waitForSelector('[class*="flex"]', { timeout: 10000 });

    const styles = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        color: s.color,
        backgroundColor: s.backgroundColor,
      };
    });

    expect(styles.fontFamily).toContain('IBM Plex Sans');
    expect(styles.fontSize).toBe('13px');
    expect(styles.color).toBe(TOKENS.text);
    expect(styles.backgroundColor).toBe(TOKENS.bg);
  });

  test('inbox card: border, background, radius', async ({ page }) => {
    await page.goto('/agents/radar');
    // Wait for items to load
    await page.waitForSelector('[data-id]', { timeout: 10000 });

    const styles = await page.evaluate(() => {
      const card = document.querySelector('[data-id]');
      if (!card) return null;
      const s = getComputedStyle(card);
      return {
        borderColor: s.borderColor,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
      };
    });

    expect(styles).not.toBeNull();
    expect(styles!.borderColor).toBe(TOKENS.border);
    expect(styles!.backgroundColor).toBe(TOKENS.surface);
    expect(styles!.borderRadius).toBe('6px');
  });

  test('card text colors: title, summary, meta', async ({ page }) => {
    await page.goto('/agents/radar');
    await page.waitForSelector('[data-id]', { timeout: 10000 });

    const styles = await page.evaluate(() => {
      const card = document.querySelector('[data-id]');
      if (!card) return null;

      // Title is the div with font-semibold and text-[15px]
      const allDivs = card.querySelectorAll('div');
      let title: Element | null = null;
      let summary: Element | null = null;
      for (const el of allDivs) {
        const s = getComputedStyle(el);
        if (s.fontWeight === '600' && s.fontSize === '15px') {
          title = el;
        }
        if (s.fontSize === '13px' && el.textContent?.includes('test item')) {
          summary = el;
        }
      }

      return {
        titleColor: title ? getComputedStyle(title).color : null,
        summaryColor: summary ? getComputedStyle(summary).color : null,
      };
    });

    expect(styles).not.toBeNull();
    // Title inherits --text
    if (styles!.titleColor) {
      expect(styles!.titleColor).toBe(TOKENS.text);
    }
    // Summary uses --text-2
    if (styles!.summaryColor) {
      expect(styles!.summaryColor).toBe(TOKENS.text2);
    }
  });

  test('nav rail: background and border', async ({ page }) => {
    await page.goto('/agents/radar');
    await page.waitForSelector('nav, aside', { timeout: 10000 });

    const styles = await page.evaluate(() => {
      // NavRail is the leftmost narrow aside/nav
      const nav = document.querySelector('nav') || document.querySelector('aside');
      if (!nav) return null;
      const s = getComputedStyle(nav);
      return {
        borderColor: s.borderRightColor || s.borderColor,
      };
    });

    if (styles) {
      expect(styles.borderColor).toBe(TOKENS.border);
    }
  });
});
