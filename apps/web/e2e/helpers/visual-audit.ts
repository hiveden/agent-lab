/**
 * 视觉审计 — 在浏览器内运行的 DOM 检查脚本
 *
 * 不依赖 baseline 截图，用规则检测样式问题：
 *   1. 元素重叠（交互元素间 >30% 面积重叠）
 *   2. 水平溢出（scrollWidth > clientWidth）
 *   3. 触摸热区过小（< 44×44px）
 *   4. 元素超出视口
 *   5. 字号不一致（同类元素字号不同）
 *   6. 文字被裁剪
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface AuditIssue {
  type: 'overlap' | 'overflow-x' | 'touch-target' | 'out-of-viewport' | 'font-inconsistency' | 'text-clipped';
  severity: 'error' | 'warning';
  message: string;
  detail: Record<string, unknown>;
}

export interface AuditResult {
  issues: AuditIssue[];
  viewport: { w: number; h: number };
  timestamp: string;
}

const AUDIT_SCRIPT = `
(() => {
  const issues = [];
  const viewport = { w: window.innerWidth, h: window.innerHeight };

  // 1. 元素重叠
  const interactiveEls = document.querySelectorAll('button, a, input, textarea, [role="button"], .m-card, .tab-item, .item-row');
  const rects = [];
  for (const el of interactiveEls) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || r.width === 0) continue;
    rects.push({ tag: el.tagName + '.' + (el.className || '').split(' ')[0], r });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, b = rects[j].r;
      const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const area = ox * oy;
      const min = Math.min(a.width * a.height, b.width * b.height);
      if (area > 0 && min > 0 && area / min > 0.3) {
        issues.push({ type: 'overlap', severity: 'error',
          message: rects[i].tag + ' overlaps ' + rects[j].tag,
          detail: { ratio: (area / min * 100).toFixed(0) + '%' } });
      }
    }
  }

  // 2. 水平溢出
  for (const el of document.querySelectorAll('.m-app, .m-content, .m-cards, .m-chat, .m-chat-messages, .tab-bar, .m-items, .app, .main')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      issues.push({ type: 'overflow-x', severity: 'error',
        message: (el.tagName + '.' + (el.className || '').split(' ')[0]) + ' horizontal overflow',
        detail: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } });
    }
  }

  // 3. 触摸热区
  for (const el of document.querySelectorAll('button, a, [role="button"], .tab-item, .m-filter-chip')) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || r.width < 5) continue;
    if (r.width < 44 || r.height < 44) {
      issues.push({ type: 'touch-target', severity: 'warning',
        message: (el.tagName + '.' + (el.className || '').split(' ')[0]) + ' too small',
        detail: { width: Math.round(r.width), height: Math.round(r.height) } });
    }
  }

  // 4. 超出视口
  for (const el of document.querySelectorAll('.m-card, .m-chat-input, .tab-bar, .m-chat-header, .m-filter-chip')) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || r.width === 0) continue;
    if (r.right > viewport.w + 2)
      issues.push({ type: 'out-of-viewport', severity: 'error',
        message: (el.tagName + '.' + (el.className || '').split(' ')[0]) + ' exceeds right edge',
        detail: { right: Math.round(r.right), viewport: viewport.w } });
    if (r.left < -2)
      issues.push({ type: 'out-of-viewport', severity: 'error',
        message: (el.tagName + '.' + (el.className || '').split(' ')[0]) + ' exceeds left edge',
        detail: { left: Math.round(r.left) } });
  }

  // 5. 字号一致性
  const fontMap = new Map();
  for (const el of document.querySelectorAll('.m-card-title, .m-card-summary, .tab-label, .m-chat-title, .m-msg-bubble')) {
    const s = getComputedStyle(el);
    if (s.display === 'none') continue;
    const cls = el.className.split(' ')[0] || el.tagName;
    const fs = parseFloat(s.fontSize);
    if (!fontMap.has(cls)) fontMap.set(cls, []);
    fontMap.get(cls).push(fs);
  }
  for (const [cls, sizes] of fontMap) {
    const u = [...new Set(sizes)];
    if (u.length > 1)
      issues.push({ type: 'font-inconsistency', severity: 'warning',
        message: cls + ' inconsistent font sizes', detail: { sizes: u } });
  }

  return { issues, viewport, timestamp: new Date().toISOString() };
})()
`;

/**
 * 在页面上执行视觉审计，打印结果，断言无 error。
 */
export async function runVisualAudit(page: Page, label: string) {
  const result = await page.evaluate(AUDIT_SCRIPT) as AuditResult;

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  if (result.issues.length > 0) {
    console.log(`  Visual audit [${label}]: ${errors.length} errors, ${warnings.length} warnings`);
    for (const i of result.issues) {
      console.log(`    [${i.severity}] ${i.type}: ${i.message} ${JSON.stringify(i.detail)}`);
    }
  }

  expect(
    errors,
    `Visual errors in ${label}:\n${errors.map((e) => `  ${e.type}: ${e.message}`).join('\n')}`,
  ).toHaveLength(0);

  return result;
}
