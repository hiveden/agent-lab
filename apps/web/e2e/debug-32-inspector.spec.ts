/**
 * #32 调试脚本 —— 捕获 agent.messages 清空点
 *
 * 前提: BFF :8788 + Radar :8001 已在跑。
 *
 * 输出: /tmp/inspector-debug.log —— 所有 [DBG32] console.log
 * 运行: npx playwright test e2e/debug-32-inspector.spec.ts --project=consumption
 */
import { test, expect } from '@playwright/test';
import { writeFileSync, appendFileSync } from 'fs';

const LOG = '/tmp/inspector-debug.log';

test('trace messages lifecycle', async ({ page }) => {
  writeFileSync(LOG, `=== ${new Date().toISOString()} run start ===\n`);

  // 捕获所有 console 到文件 + stderr
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    // 只记录 [DBG32] 和错误
    if (text.includes('DBG32') || type === 'error' || type === 'warning') {
      const line = `[${type}] ${text}\n`;
      appendFileSync(LOG, line);
      process.stderr.write(line);
    }
  });

  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.message}\n${err.stack}\n`;
    appendFileSync(LOG, line);
    process.stderr.write(line);
  });

  // 0. 注入 Inspector prototype patch（每个新 document 加载前运行）
  await page.addInitScript(() => {
    // 等 customElements 定义完再 patch
    const tryPatch = () => {
      const WebInspectorClass = customElements.get('cpk-web-inspector') as unknown as { prototype: Record<string, unknown> } | undefined;
      if (!WebInspectorClass) {
        setTimeout(tryPatch, 50);
        return;
      }
      const proto = WebInspectorClass.prototype as Record<string, unknown> & { __dbg32Patched?: boolean };
      if (proto.__dbg32Patched) return;
      proto.__dbg32Patched = true;

      const wrap = (name: string, fn: (...args: unknown[]) => unknown) => {
        const orig = proto[name] as (...args: unknown[]) => unknown;
        if (typeof orig !== 'function') return;
        proto[name] = function (this: Record<string, unknown>, ...args: unknown[]) {
          try { fn.call(this, ...args); } catch { /* ignore */ }
          return orig.apply(this, args);
        };
      };

      wrap('subscribeToAgent', (agent: unknown) => {
        const a = agent as { agentId?: string; threadId?: string; messages?: unknown[] };
        // eslint-disable-next-line no-console
        console.log(`[DBG32-inspector-in subscribeToAgent] agentId=${a.agentId} tid=${a.threadId?.slice(0, 8)} msgs=${a.messages?.length}`);
      });
      wrap('unsubscribeFromAgent', (agentId: unknown) => {
        // eslint-disable-next-line no-console
        console.log(`[DBG32-inspector-in unsubscribeFromAgent] agentId=${agentId}`);
      });
      wrap('processAgentsChanged', (agents: unknown) => {
        const ids = Object.keys((agents ?? {}) as Record<string, unknown>);
        // eslint-disable-next-line no-console
        console.log(`[DBG32-inspector-in processAgentsChanged] agentIds=${JSON.stringify(ids)}`);
      });
      wrap('syncAgentMessages', function (this: Record<string, unknown>, agent: unknown) {
        const a = agent as { agentId?: string; threadId?: string; messages?: unknown[] };
        const before = (this.agentMessages as Map<string, unknown[]> | undefined)?.get(a.agentId ?? '');
        // eslint-disable-next-line no-console
        console.log(`[DBG32-inspector-out syncAgentMessages] agentId=${a.agentId} tid=${a.threadId?.slice(0, 8)} in.msgs=${a.messages?.length} before.msgs=${before ? (before as unknown[]).length : 'none'}`);
      });
      // eslint-disable-next-line no-console
      console.log(`[DBG32-inspector-in] prototype patched`);
    };
    tryPatch();
  });

  // 1. 进入 Radar
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  appendFileSync(LOG, `\n=== page loaded ===\n`);

  // 2. 切到 Agent view
  await page.getByRole('button', { name: 'Agent' }).click();
  await page.waitForTimeout(1500);
  appendFileSync(LOG, `\n=== agent view active ===\n`);

  // 3. 找 chat textarea
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  appendFileSync(LOG, `\n=== textarea visible ===\n`);

  // 3. 发消息前启动 background polling 捕捉整个 Inspector messages 生命周期
  const pollStartAbs = Date.now();
  let lastLen = -999;
  const lifecyclePoll = async () => {
    while (Date.now() - pollStartAbs < 60_000) {
      const len = await page.evaluate(() => {
        const el = document.querySelector('cpk-web-inspector') as unknown as { agentMessages?: Map<string, unknown[]> } | null;
        return el?.agentMessages?.get('radar')?.length ?? -1;
      }).catch(() => -2);
      if (len !== lastLen) {
        appendFileSync(LOG, `[LIFE t=${Date.now() - pollStartAbs}ms abs=${Date.now()}] agentMessages["radar"].length=${len}\n`);
        lastLen = len;
      }
      await page.waitForTimeout(150);
    }
  };
  const polling = lifecyclePoll();

  await textarea.fill('hi');
  await textarea.press('Enter');
  appendFileSync(LOG, `[SENT abs=${Date.now()}] message enter pressed\n`);

  // 4. 等待足够长: SSE ≤ 10s + 副作用窗口 10s
  let runFinishedSeen = false;
  page.on('console', (msg) => {
    if (msg.text().includes('RUN_FINISHED')) runFinishedSeen = true;
  });
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    await page.waitForTimeout(500);
    if (runFinishedSeen) break;
  }
  const runFinishedAt = Date.now();
  if (runFinishedSeen) {
    appendFileSync(LOG, `\n=== RUN_FINISHED seen at ${runFinishedAt - start}ms (abs=${runFinishedAt}), polling Inspector messages for clear ===\n`);
  } else {
    appendFileSync(LOG, `\n=== WARN: RUN_FINISHED not seen after ${Date.now() - start}ms, still waiting ===\n`);
  }

  appendFileSync(LOG, `[RUN_FINISHED abs=${runFinishedAt}] run finished\n`);
  // 等 lifecycle polling 继续跑, 至少 15s 覆盖 setTimeout(5000) 后的变化
  await page.waitForTimeout(15_000);
  appendFileSync(LOG, `\n=== 15s after RUN_FINISHED ===\n`);
  await polling.catch(() => {});

  // 6. 直接读 Inspector 内部 state
  const inspectorState = await page.evaluate(() => {
    const el = document.querySelector('cpk-web-inspector') as HTMLElement & {
      agentMessages?: Map<string, unknown[]>;
      agentEvents?: Map<string, unknown[]>;
      agentSubscriptions?: Map<string, unknown>;
      selectedContext?: string;
    } | null;
    if (!el) return { found: false };
    return {
      found: true,
      selectedContext: el.selectedContext,
      agentIds: el.agentMessages ? Array.from(el.agentMessages.keys()) : [],
      messagesSummary: el.agentMessages ? Array.from(el.agentMessages.entries()).map(([k, v]) => ({ agentId: k, count: Array.isArray(v) ? v.length : -1 })) : [],
      eventsSummary: el.agentEvents ? Array.from(el.agentEvents.entries()).map(([k, v]) => ({ agentId: k, count: Array.isArray(v) ? v.length : -1 })) : [],
      subscribedKeys: el.agentSubscriptions ? Array.from(el.agentSubscriptions.keys()) : [],
    };
  });
  appendFileSync(LOG, `\n=== INSPECTOR STATE ===\n${JSON.stringify(inspectorState, null, 2)}\n`);

  appendFileSync(LOG, `\n=== test end ===\n`);
});
