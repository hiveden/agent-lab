#!/usr/bin/env node
/**
 * Phase 3 trace 串通自动验证 — 不需要人介入。
 * 用 playwright 起 headless chromium, 访问 chat 页, 发条消息, 抓 console + chip。
 *
 * 运行: node scripts/verify-phase3-trace.mjs
 * 前置: web (8788) + agent (8001) + collector (4318) 已起。
 */

import { chromium } from '@playwright/test';

const URL = process.env.WEB_URL || 'http://127.0.0.1:8788/agents/radar';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMsgs.push(text);
    if (text.includes('[otel') || text.includes('[agui]')) {
      console.log('  CONSOLE>', text);
    }
  });
  page.on('pageerror', (err) => console.log('  PAGEERROR>', err.message));

  console.log('1. goto', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 切到 Agent view (默认是 inbox)
  console.log('1b. click NavRail Agent button...');
  await page.locator('[aria-label="Agent"]').click();
  await page.waitForTimeout(2500);

  // 1. Browser OTel SDK 启动?
  const otelStarted = consoleMsgs.some((m) => m.includes('[otel] browser sdk started'));
  console.log(`2. browser OTel started: ${otelStarted ? 'YES ✓' : 'NO ✗'}`);

  // 2. 找 chat 输入. 等 CopilotChat hydrate, 列所有可能 input
  console.log('3. find chat input...');
  await page.waitForTimeout(3000);
  const inputs = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('input,textarea,[contenteditable="true"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      list.push({
        tag: el.tagName,
        type: el.getAttribute('type'),
        placeholder: el.getAttribute('placeholder'),
        contenteditable: el.getAttribute('contenteditable'),
        rect: `${r.width.toFixed(0)}x${r.height.toFixed(0)}@${r.left.toFixed(0)},${r.top.toFixed(0)}`,
        visible: r.width > 0 && r.height > 0,
      });
    });
    return list;
  });
  console.log('   DOM inputs found:', inputs.length);
  inputs.forEach((i) => console.log('     ', i));
  if (inputs.length === 0) {
    // CopilotChat 可能在 shadow DOM (Lit web component) 或 iframe, dump 探查
    const shadowHosts = await page.evaluate(() => {
      const list = [];
      document.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) list.push({ tag: el.tagName, id: el.id, class: el.className });
      });
      return list;
    });
    console.log('   shadow hosts:', shadowHosts.length, shadowHosts.slice(0, 5));
    const tags = await page.evaluate(() =>
      Array.from(new Set(Array.from(document.querySelectorAll('*')).map((e) => e.tagName))).sort(),
    );
    console.log('   all tag names:', tags.filter((t) => t.includes('-') || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(t)));
    await page.screenshot({ path: 'e2e/test-results/phase3-debug.png', fullPage: true });
    console.log('   dumped screenshot to e2e/test-results/phase3-debug.png');
  }

  const target = inputs.find((i) => i.contenteditable === 'true' && i.visible)
    || inputs.find((i) => i.tag === 'TEXTAREA' && i.visible);
  if (!target) {
    console.log('   ERR: no chat input found, abort');
    await browser.close();
    process.exit(1);
  }
  const selector = target.contenteditable === 'true' ? '[contenteditable="true"]' : 'textarea';
  console.log('   typing into', selector);
  await page.locator(selector).first().fill('phase3 trace test');
  await page.keyboard.press('Enter');

  // 3. 等 RUN_STARTED
  await page
    .waitForFunction(
      () => document.body.innerText.match(/trace:\s*([0-9a-f]{8})/) !== null,
      { timeout: 30000 },
    )
    .catch(() => console.log('   WARN: chip 短码未出现, OTel 可能没派发 chat-trace'));

  const chipShort = await page.evaluate(() => {
    const m = document.body.innerText.match(/trace:\s*([0-9a-f]{8})/);
    return m ? m[1] : null;
  });
  const aguiRunId = consoleMsgs
    .filter((m) => m.includes('[agui] RUN_STARTED'))
    .map((m) => m.match(/runId=\s*([0-9a-f-]+)/)?.[1])
    .filter(Boolean)[0];

  console.log(`4. chip 短码 (OTel trace_id 32-hex prefix): ${chipShort || '<null>'}`);
  console.log(`5. agui runId (UUID, ag-ui input.runId): ${aguiRunId || '<null>'}`);

  console.log('6. 等 BatchSpanProcessor flush 5s...');
  await page.waitForTimeout(5000);

  await browser.close();

  console.log('\n=== 结果摘要 ===');
  console.log(`  browser OTel started:  ${otelStarted ? 'YES' : 'NO'}`);
  console.log(`  chip 短码 (8-hex):     ${chipShort || 'MISSING'}`);
  console.log(`  agui runId (UUID):     ${aguiRunId || 'MISSING'}`);
  if (chipShort) {
    console.log('\n下一步: grep collector log 这个 trace_id 看四端是否串通:');
    console.log(`  docker compose -f docker/observability/docker-compose.yml logs --tail=300 | grep ${chipShort}`);
  }
})();
