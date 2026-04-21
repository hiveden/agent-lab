/**
 * PoC 自动化验证脚本（V5 + V7）。
 * 复用 apps/web 已装的 Playwright 1.59.1 (node_modules/@playwright/test)。
 *
 * 运行前置：
 *   - PoC dev 跑在 http://127.0.0.1:3005
 *   - radar-serve 跑在 http://127.0.0.1:8001
 *
 * 运行：
 *   cd poc/copilotkit-v2-useagent
 *   node poc-auto-verify.mjs
 */

import { chromium } from "/Users/xuelin/projects/agent-lab/node_modules/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.POC_URL || "http://127.0.0.1:3005";
const PROMPT_SHORT = "hi"; // V7 用，回复短（中文 pressSequentially 在 Chromium 有 IME 干扰）
const PROMPT_LONG =
  "用 200 字详细介绍一下大语言模型的 Transformer 架构，分要点列出"; // V5 用，回复长

const EVIDENCE_DIR = "./evidence";
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}
function log(...a) {
  console.log(`[${now()}]`, ...a);
}
function banner(title) {
  console.log("\n" + "═".repeat(72));
  console.log("▶ " + title);
  console.log("═".repeat(72));
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ALL_RESULTS = { V5: null, V7: null };

// ───── V7: isRunning 翻转时机 ─────
async function runV7(browser) {
  banner("V7 · isRunning 翻转时机");
  const context = await browser.newContext();
  const page = await context.newPage();

  // 注入窗口变量捕获 isRunning 翻转时间戳（page.tsx 的 pre 里有 isRunning）
  // 改读 aria 徽章: <span> 'running…' 或 'idle'
  const events = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[otel]") || t.includes("chat trace") || t.includes("[poc]")) {
      events.push({ ts: performance.now(), type: "console", text: t });
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[placeholder='Ask the radar agent…']");
  await wait(1500); // 等 React hydration + useAgent init 完成

  // 串行 poller（setTimeout 递归，避免 setInterval 并行 evaluate race）
  let runningStart = null;
  let runningEnd = null;
  let t0 = null;
  let lastText = null;
  let stop = false;
  (async function poll() {
    while (!stop) {
      try {
        const badge = await page.evaluate(() => {
          const el = document.querySelector("[data-testid='status-badge']");
          return el?.textContent?.trim() || null;
        });
        if (badge && badge !== lastText) {
          const ts = performance.now();
          events.push({ ts, type: "badge", text: badge });
          if (badge.includes("running") && runningStart === null) runningStart = ts;
          if (badge === "idle" && runningStart !== null && runningEnd === null) runningEnd = ts;
          lastText = badge;
        }
      } catch {}
      await wait(20);
    }
  })();

  const input = page.locator("input[placeholder='Ask the radar agent…']");
  await input.pressSequentially(PROMPT_SHORT, { delay: 30 });
  await wait(300); // 给 React state 一点时间 flush
  t0 = performance.now();
  events.push({ ts: t0, type: "action", text: "submit via Enter" });
  await input.press("Enter");

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await wait(100);
    if (runningStart && runningEnd) break;
  }
  stop = true;
  await wait(50);

  const startLatency = runningStart !== null ? runningStart - t0 : null;
  const endLatency =
    runningEnd !== null && runningStart !== null ? runningEnd - runningStart : null;

  const verdict =
    startLatency !== null && startLatency < 500 && endLatency !== null
      ? "PASS"
      : "FAIL";

  log(`V7 · click→running=${startLatency?.toFixed(0)}ms  running→idle=${endLatency?.toFixed(0)}ms`);
  log(`V7 verdict: ${verdict}`);

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "v7-timing.json"),
    JSON.stringify(
      { t0, runningStart, runningEnd, startLatency, endLatency, verdict, events },
      null,
      2,
    ),
  );

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "v7-final.png") });
  await context.close();

  ALL_RESULTS.V7 = { verdict, startLatency, endLatency };
}

// ───── V5: SSE 断线重连 ─────
async function runV5(browser) {
  banner("V5 · SSE 断线重连");
  const context = await browser.newContext();
  const page = await context.newPage();

  const sseChunks = [];
  page.on("console", (msg) => {
    sseChunks.push({ ts: Date.now(), text: msg.text() });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[placeholder='Ask the radar agent…']");

  // 注入监听 DOM mutations 计数 assistant 文本变化
  await page.evaluate(() => {
    window.__textLengthSamples = [];
    const sample = () => {
      const texts = [...document.querySelectorAll("[aria-label='messages'] > div")];
      const assistantText =
        texts
          .filter((el) => el.textContent?.startsWith("assistant"))
          .map((el) => el.textContent || "")
          .join("") || "";
      window.__textLengthSamples.push({
        ts: Date.now(),
        len: assistantText.length,
      });
    };
    sample();
    setInterval(sample, 100);
  });

  const inputEl = page.locator("input[placeholder='Ask the radar agent…']");
  await inputEl.pressSequentially(PROMPT_LONG, { delay: 10 });
  await wait(300);
  const tStart = Date.now();
  await inputEl.press("Enter");

  // 等待 1.5 秒让流先启动
  await wait(1500);

  // 断网 3 秒
  log("V5 · setOffline(true) 3s");
  await context.setOffline(true);
  await wait(3000);
  log("V5 · setOffline(false) 恢复");
  await context.setOffline(false);

  // 等待最多 45 秒，让它要么继续流要么结束
  const deadline = Date.now() + 45_000;
  let lastLen = 0;
  let stableCount = 0;
  while (Date.now() < deadline) {
    await wait(500);
    const samples = await page.evaluate(() => window.__textLengthSamples.slice(-3));
    const latest = samples[samples.length - 1]?.len ?? 0;
    const badge = await page
      .evaluate(() => {
        const el = document.querySelector("[data-testid='status-badge']");
        return el?.textContent?.trim() || null;
      })
      .catch(() => null);
    if (latest === lastLen) stableCount++;
    else stableCount = 0;
    lastLen = latest;
    if (badge === "idle" && stableCount > 3) break;
  }

  const allSamples = await page.evaluate(() => window.__textLengthSamples);
  const offlineAt = 1500;
  const beforeOffline = allSamples.filter((s) => s.ts - tStart < offlineAt).pop()?.len ?? 0;
  const atRecover = allSamples.filter((s) => s.ts - tStart < offlineAt + 3000).pop()?.len ?? 0;
  const finalLen = allSamples[allSamples.length - 1]?.len ?? 0;

  // 判定：恢复后 assistant 文本若继续增长 → PASS；若停在 offline 前长度 → FAIL
  const grewAfterRecover = finalLen > atRecover + 5;
  const verdict = grewAfterRecover ? "PASS" : "FAIL";

  log(`V5 · len@before-offline=${beforeOffline}  @recover=${atRecover}  @final=${finalLen}`);
  log(`V5 verdict: ${verdict}`);

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "v5-reconnect.json"),
    JSON.stringify(
      {
        tStart,
        beforeOffline,
        atRecover,
        finalLen,
        grewAfterRecover,
        verdict,
        samples: allSamples,
      },
      null,
      2,
    ),
  );

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "v5-final.png") });
  await context.close();

  ALL_RESULTS.V5 = { verdict, beforeOffline, atRecover, finalLen };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runV7(browser);
    await runV5(browser);
  } finally {
    await browser.close();
  }

  banner("汇总");
  console.log(JSON.stringify(ALL_RESULTS, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "auto-verify-summary.json"),
    JSON.stringify(ALL_RESULTS, null, 2),
  );
})();
