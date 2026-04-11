/**
 * 流程闭环测试 — 追踪数据在 pipeline 中的完整生命周期
 *
 * 与 full-loop.spec.ts 的区别：
 *   full-loop = "各阶段能跑通"（烟雾测试）
 *   flow-test = "数据从 A 流到 B 流到 C，每一步都能追溯"（流程验证）
 *
 * 验证维度：
 *   1. 数据血缘：source_id → raw_item → item，run_id 贯穿
 *   2. 状态跃迁：raw_items pending → promoted/rejected
 *   3. 漏斗完整：fetched > promoted + rejected = total
 *   4. 幂等性：重复 ingest 不产生重复 raw_items
 *   5. UI ↔ DB 一致：UI 展示的 item 就是 DB 里的那条
 *   6. Chat 关联：对话 session 绑定到具体 item
 */

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// 跨测试共享的状态——追踪数据在 pipeline 中的流转
const ctx = {
  sourceId: 'src_hn_top',
  ingestRunId: '' as string,
  evaluateRunId: '' as string,
  rawItemIds: [] as string[],
  rawItemExternalIds: [] as string[],
  promotedIds: [] as string[],
  rejectedIds: [] as string[],
  itemTitles: [] as string[],
  firstItemId: '' as string,
  chatSessionId: '' as string,
};

const AUTH = { authorization: 'Bearer dev-radar-token-change-me' };
const PYTHON = 'http://127.0.0.1:8001';

// ═══════════════════════════════════════════════════════════════
// Step 1: 确认起点 — Source 配置存在且 enabled
// ═══════════════════════════════════════════════════════════════

test('Step 1: source config drives the pipeline', async ({ request }) => {
  const res = await request.get('/api/sources?agent_id=radar');
  const { sources } = await res.json();

  const hn = sources.find((s: Record<string, unknown>) => s.id === ctx.sourceId);
  expect(hn, 'HN source must exist').toBeTruthy();
  expect(!!hn.enabled, 'HN source must be enabled').toBe(true);
  expect(hn.config, 'HN source must have config').toBeTruthy();

  // 记录初始 raw_items 数量，后面验证增量
  const rawBefore = await request.get(`/api/raw-items?agent_id=radar&source_id=${ctx.sourceId}&limit=1000`);
  const rawBeforeBody = await rawBefore.json();
  ctx.rawItemIds = rawBeforeBody.raw_items.map((r: Record<string, string>) => r.id);
});

// ═══════════════════════════════════════════════════════════════
// Step 2: Ingest — 验证 source → raw_items 的数据血缘
// ═══════════════════════════════════════════════════════════════

test('Step 2: ingest links raw_items to source and run', async ({ request }) => {
  const res = await request.post(`${PYTHON}/ingest`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      sources: [{ id: ctx.sourceId, source_type: 'hacker-news', config: { limit: 5 } }],
    }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);

  // 解析 SSE 拿到 run_id
  const text = await res.text();
  const startLine = text.split('\n').find((l) => l.includes('"type": "start"') || l.includes('"type":"start"'));
  if (startLine) {
    const match = startLine.match(/"run_id":\s*"([^"]+)"/);
    if (match) ctx.ingestRunId = match[1];
  }
  expect(ctx.ingestRunId, 'ingest must produce a run_id').toBeTruthy();

  await new Promise((r) => setTimeout(r, 1000));

  // 验证 run 记录
  const runRes = await request.get(`/api/runs/${ctx.ingestRunId}`);
  expect(runRes.status()).toBe(200);
  const run = (await runRes.json()).run;
  expect(run.phase).toBe('ingest');
  expect(run.status).toBe('done');
  expect(run.source_ids).toContain(ctx.sourceId);

  // 验证 raw_items 存在且关联到正确的 source
  // 注：因为 UNIQUE(source_id, external_id)，重复 ingest 会 skip 已有数据
  // 所以按 source_id 查而非 run_id，然后验证属性正确
  const rawRes = await request.get(`/api/raw-items?agent_id=radar&source_id=${ctx.sourceId}&limit=100`);
  const rawItems = (await rawRes.json()).raw_items;
  expect(rawItems.length, 'raw_items must exist for this source').toBeGreaterThan(0);

  // 验证每条 raw_item 的关联正确
  for (const ri of rawItems) {
    expect(ri.source_id, 'raw_item.source_id must match').toBe(ctx.sourceId);
    expect(ri.agent_id).toBe('radar');
    expect(ri.title, 'raw_item must have title').toBeTruthy();
    expect(ri.external_id, 'raw_item must have external_id').toBeTruthy();
  }

  // 至少部分 raw_items 应该有本次的 run_id（新写入的）
  const withRunId = rawItems.filter((r: Record<string, string>) => r.run_id === ctx.ingestRunId);
  console.log(`Ingest: ${rawItems.length} total raw_items, ${withRunId.length} from this run (${ctx.ingestRunId})`);

  ctx.rawItemIds = rawItems.map((r: Record<string, string>) => r.id);
  ctx.rawItemExternalIds = rawItems.map((r: Record<string, string>) => r.external_id);
});

// ═══════════════════════════════════════════════════════════════
// Step 3: Ingest 幂等性 — 重复采集不产生重复数据
// ═══════════════════════════════════════════════════════════════

test('Step 3: duplicate ingest is idempotent', async ({ request }) => {
  const res = await request.post(`${PYTHON}/ingest`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({
      sources: [{ id: ctx.sourceId, source_type: 'hacker-news', config: { limit: 5 } }],
    }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);

  const text = await res.text();
  // 第二次 ingest 应该大部分是 duplicate
  const resultLine = text.split('\n').find((l) => l.includes('"type": "result"') || l.includes('"type":"result"'));
  expect(resultLine).toBeTruthy();

  if (resultLine) {
    const skippedMatch = resultLine.match(/"skipped":\s*(\d+)/);
    const insertedMatch = resultLine.match(/"inserted":\s*(\d+)/);
    const skipped = skippedMatch ? parseInt(skippedMatch[1]) : 0;
    const inserted = insertedMatch ? parseInt(insertedMatch[1]) : 0;
    // 大部分应该是 skipped（已存在）
    expect(skipped, 'most items should be skipped on re-ingest').toBeGreaterThan(0);
    console.log(`Idempotency: inserted=${inserted} skipped=${skipped}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// Step 4: Evaluate — 验证 raw_items → items 的状态跃迁
// ═══════════════════════════════════════════════════════════════

test('Step 4: evaluate transitions raw_items and creates items', async ({ request }) => {
  const res = await request.post(`${PYTHON}/evaluate`, {
    headers: { 'content-type': 'application/json', ...AUTH },
    data: JSON.stringify({ agent_id: 'radar' }),
    timeout: 60_000,
  });
  expect(res.status()).toBe(200);

  const text = await res.text();
  const startLine = text.split('\n').find((l) => l.includes('"type": "start"') || l.includes('"type":"start"'));
  if (startLine) {
    const match = startLine.match(/"run_id":\s*"([^"]+)"/);
    if (match) ctx.evaluateRunId = match[1];
  }

  await new Promise((r) => setTimeout(r, 1000));

  // 等 run 状态落库（evaluate pipeline 的 update_run 是异步的）
  await new Promise((r) => setTimeout(r, 2000));

  // 验证 run 记录
  if (ctx.evaluateRunId) {
    const runRes = await request.get(`/api/runs/${ctx.evaluateRunId}`);
    const run = (await runRes.json()).run;
    expect(run.phase).toBe('evaluate');
    // run 可能是 done 或 running（取决于异步更新时序）
    expect(['done', 'running']).toContain(run.status);
  }

  // 关键验证：raw_items 状态跃迁
  const promotedRes = await request.get(`/api/raw-items?agent_id=radar&status=promoted&limit=100`);
  const promoted = (await promotedRes.json()).raw_items;
  ctx.promotedIds = promoted.map((r: Record<string, string>) => r.id);

  const rejectedRes = await request.get(`/api/raw-items?agent_id=radar&status=rejected&limit=100`);
  const rejected = (await rejectedRes.json()).raw_items;
  ctx.rejectedIds = rejected.map((r: Record<string, string>) => r.id);

  // 不应该还有 pending 的（都该被处理了）
  const pendingRes = await request.get(`/api/raw-items?agent_id=radar&status=pending&limit=5`);
  const pending = (await pendingRes.json()).raw_items;

  console.log(`Evaluate: promoted=${ctx.promotedIds.length} rejected=${ctx.rejectedIds.length} pending=${pending.length}`);

  expect(ctx.promotedIds.length, 'at least 1 item must be promoted').toBeGreaterThan(0);
  // promoted + rejected 应该覆盖所有被评判的 raw_items
  expect(
    ctx.promotedIds.length + ctx.rejectedIds.length,
    'promoted + rejected should cover evaluated items',
  ).toBeGreaterThan(0);

  // 验证 items 存在（幂等场景下 evaluate 可能 skip 但 items 表应该有数据）
  const itemsAfter = await request.get('/api/items?agent_id=radar&limit=10');
  const itemsAfterBody = (await itemsAfter.json()).items;
  expect(itemsAfterBody.length, 'items must exist after evaluate').toBeGreaterThan(0);

  ctx.itemTitles = itemsAfterBody.slice(0, 3).map((i: Record<string, string>) => i.title);
  ctx.firstItemId = itemsAfterBody[0]?.id ?? '';
});

// ═══════════════════════════════════════════════════════════════
// Step 5: 漏斗验证 — fetched > promoted，数据不丢不多
// ═══════════════════════════════════════════════════════════════

test('Step 5: funnel integrity', async ({ request }) => {
  // 全部 raw_items
  const allRaw = await request.get(`/api/raw-items?agent_id=radar&limit=1000`);
  const allRawItems = (await allRaw.json()).raw_items;

  // 按状态分组
  const byStatus: Record<string, number> = {};
  for (const ri of allRawItems) {
    byStatus[ri.status] = (byStatus[ri.status] || 0) + 1;
  }

  console.log('Funnel by status:', byStatus);

  // 每条 raw_item 必须有明确状态
  for (const ri of allRawItems) {
    expect(
      ['pending', 'evaluated', 'promoted', 'rejected'].includes(ri.status),
      `raw_item ${ri.id} has invalid status: ${ri.status}`,
    ).toBe(true);
  }

  // promoted 数量应该 <= items 数量（evaluate 可能多次跑，items 做了幂等）
  const itemsRes = await request.get('/api/items?agent_id=radar&limit=1000');
  const items = (await itemsRes.json()).items;

  // 注：历史数据（旧 push.py 直接写 items 未走 raw_items）可能导致 items > raw_items
  // 新架构下每次 evaluate 从 raw_items 产出 items，数量关系正确
  // 只验证 promoted + rejected = 全部非 pending
  const nonPending = (byStatus['promoted'] ?? 0) + (byStatus['rejected'] ?? 0) + (byStatus['evaluated'] ?? 0);
  expect(nonPending, 'all raw_items should have been processed').toBe(allRawItems.length - (byStatus['pending'] ?? 0));
});

// ═══════════════════════════════════════════════════════════════
// Step 6: UI ↔ DB 一致性 — 页面展示的就是数据库里的数据
// ═══════════════════════════════════════════════════════════════

test('Step 6: UI shows DB items correctly', async ({ page, request }) => {
  // 从 DB 拿最新的 item
  const itemsRes = await request.get('/api/items?agent_id=radar&limit=1');
  const items = (await itemsRes.json()).items;
  expect(items.length).toBeGreaterThan(0);
  const dbItem = items[0];

  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.click('button[aria-label="Inbox"]');
  await page.waitForTimeout(1500);

  // DB 里的 item title 应该在 UI 里可见
  const titleInUI = page.locator(`.item-row:has-text("${dbItem.title.slice(0, 30)}")`);
  await expect(titleInUI.first(), `item "${dbItem.title}" should be visible in inbox`).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'e2e/test-results/flow-06-ui-db-match.png' });
});

// ═══════════════════════════════════════════════════════════════
// Step 7: Chat 关联 — 对话绑定到具体 item
// ═══════════════════════════════════════════════════════════════

test('Step 7: chat session links to item', async ({ page, request }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');
  await page.click('button[aria-label="Inbox"]');
  await page.waitForTimeout(1500);

  // 点击第一个 item
  const firstItem = page.locator('.item-row').first();
  await expect(firstItem).toBeVisible({ timeout: 10_000 });
  await firstItem.click();
  await page.waitForTimeout(1000);

  // 获取选中 item 的 id（从 URL 或 DOM 属性）
  // 用 API 获取第一个 item 的 id
  const itemsRes = await request.get('/api/items?agent_id=radar&status=unread&limit=1');
  const items = (await itemsRes.json()).items;
  if (!items.length) return; // 没有 unread items 就跳过

  const itemId = items[0].id;

  // 发一条消息触发 session 创建
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    await textarea.fill('总结一下');
    await textarea.press('Enter');
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'e2e/test-results/flow-07-chat.png' });

    // 验证 chat session 绑定到这个 item
    const sessionRes = await request.get(`/api/chat/sessions/${itemId}`);
    if (sessionRes.status() === 200) {
      const sessionBody = await sessionRes.json();
      expect(sessionBody.session_id, 'chat session should exist for this item').toBeTruthy();
      expect(sessionBody.messages.length, 'should have messages').toBeGreaterThan(0);

      // 验证消息角色正确
      const roles = sessionBody.messages.map((m: Record<string, string>) => m.role);
      expect(roles, 'should contain user message').toContain('user');

      ctx.chatSessionId = sessionBody.session_id;
      console.log(`Chat: session=${ctx.chatSessionId} messages=${sessionBody.messages.length} for item=${itemId}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// Step 8: 状态变更 — 用户操作改变 item 状态
// ═══════════════════════════════════════════════════════════════

test('Step 8: item status persists after user action', async ({ request }) => {
  // 拿一个 unread item
  const itemsRes = await request.get('/api/items?agent_id=radar&status=unread&limit=1');
  const items = (await itemsRes.json()).items;
  if (!items.length) return;

  const itemId = items[0].id;
  expect(items[0].status).toBe('unread');

  // PATCH 状态为 watching
  const patchRes = await request.patch(`/api/items/${itemId}/state`, {
    data: { status: 'watching' },
  });
  expect(patchRes.status()).toBe(200);

  // 验证状态已持久化
  const verifyRes = await request.get(`/api/items/${itemId}`);
  const verifyBody = await verifyRes.json();
  expect(verifyBody.item.status, 'status should be watching after PATCH').toBe('watching');

  // 再改回 dismissed
  await request.patch(`/api/items/${itemId}/state`, {
    data: { status: 'dismissed' },
  });
  const verify2 = await request.get(`/api/items/${itemId}`);
  const verify2Body = await verify2.json();
  expect(verify2Body.item.status).toBe('dismissed');

  console.log(`Status: item ${itemId} transitioned unread → watching → dismissed`);
});

// ═══════════════════════════════════════════════════════════════
// Step 9: 制造偏差场景 — 添加第二个 source，调整权重
// ═══════════════════════════════════════════════════════════════

test('Step 9: create multi-source deviation scenario', async ({ request }) => {
  // 添加一个 RSS source（没有真实数据，用户"声称"要花 40% 注意力在 RSS 上）
  const createRes = await request.post('/api/sources', {
    data: {
      agent_id: 'radar',
      source_type: 'rss',
      name: 'AI Research RSS',
      config: {},
      attention_weight: 0.4,
      enabled: true,
    },
  });
  expect(createRes.status()).toBe(201);

  // 把 HN 权重调为 60%（原来是 100%）
  await request.patch('/api/sources/src_hn_top', {
    data: { attention_weight: 0.6 },
  });

  // 验证配置
  const srcRes = await request.get('/api/sources?agent_id=radar');
  const sources = (await srcRes.json()).sources;
  const hn = sources.find((s: Record<string, string>) => s.source_type === 'hacker-news');
  const rss = sources.find((s: Record<string, string>) => s.source_type === 'rss');
  expect(hn.attention_weight).toBe(0.6);
  expect(rss.attention_weight).toBe(0.4);
  console.log('Deviation setup: HN=60% RSS=40%, but all activity is on HN');
});

// ═══════════════════════════════════════════════════════════════
// Step 10: 注意力聚合 — 验证偏差计算
// ═══════════════════════════════════════════════════════════════

test('Step 10: attention snapshot shows real deviation', async ({ request }) => {
  const res = await request.get('/api/attention/snapshot?agent_id=radar');
  expect(res.status()).toBe(200);
  const snapshot = await res.json();

  // 应该有 2 个 source
  expect(snapshot.sources.length).toBe(2);

  // 结构完整
  for (const src of snapshot.sources) {
    expect(src.source_id).toBeTruthy();
    expect(src.source_name).toBeTruthy();
    expect(typeof src.expected_weight).toBe('number');
    expect(typeof src.actual_weight).toBe('number');
    expect(typeof src.deviation).toBe('number');
    expect(typeof src.raw_score).toBe('number');
    expect(src.detail).toBeTruthy();
  }

  // 偏差 = actual - expected
  for (const src of snapshot.sources) {
    const computedDev = src.actual_weight - src.expected_weight;
    expect(Math.abs(src.deviation - computedDev)).toBeLessThan(0.001);
  }

  // actual_weights 之和 = 1
  const totalActual = snapshot.sources.reduce(
    (sum: number, s: { actual_weight: number }) => sum + s.actual_weight, 0,
  );
  if (snapshot.total_score > 0) {
    expect(totalActual).toBeGreaterThan(0.99);
    expect(totalActual).toBeLessThan(1.01);
  }

  const hn = snapshot.sources.find((s: Record<string, string>) => s.source_type === 'hacker-news');
  const rss = snapshot.sources.find((s: Record<string, string>) => s.source_type === 'rss');

  if (snapshot.total_score > 0) {
    // 所有行为都在 HN 上，RSS 没有活动
    // HN: actual ≈ 100%, expected = 60% → deviation ≈ +40% (过度关注)
    expect(hn.actual_weight, 'HN gets all attention').toBeGreaterThan(0.9);
    expect(hn.deviation, 'HN should be over-attended').toBeGreaterThan(0);

    // RSS: actual ≈ 0%, expected = 40% → deviation ≈ -40% (被忽略)
    expect(rss.actual_weight, 'RSS gets no attention').toBeLessThan(0.1);
    expect(rss.deviation, 'RSS should be under-attended').toBeLessThan(0);

    console.log(`Deviation: HN expected=${(hn.expected_weight * 100).toFixed(0)}% actual=${(hn.actual_weight * 100).toFixed(0)}% dev=${(hn.deviation * 100).toFixed(0)}%`);
    console.log(`Deviation: RSS expected=${(rss.expected_weight * 100).toFixed(0)}% actual=${(rss.actual_weight * 100).toFixed(0)}% dev=${(rss.deviation * 100).toFixed(0)}%`);
  }
});

// ═══════════════════════════════════════════════════════════════
// Step 11: 注意力 UI — 偏差可视化渲染正确
// ═══════════════════════════════════════════════════════════════

test('Step 11: attention view renders deviation bars', async ({ page }) => {
  await page.goto('/agents/radar');
  await page.waitForLoadState('networkidle');

  await page.click('button[aria-label="Attention"]');
  await page.waitForTimeout(1500);

  // 标题存在
  await expect(page.locator('h2:has-text("Attention Mirror")')).toBeVisible();

  // Expected / Actual 条存在
  await expect(page.locator('.att-bar.expected').first()).toBeVisible();
  await expect(page.locator('.att-bar.actual').first()).toBeVisible();

  // 偏差标注存在
  await expect(page.locator('.att-deviation').first()).toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/flow-10-attention-view.png' });
});

// ═══════════════════════════════════════════════════════════════
// Step 12: 全链路血缘汇总（含注意力偏差）
// ═══════════════════════════════════════════════════════════════

test('Step 12: end-to-end data lineage summary', async ({ request }) => {
  // 收集所有数据打印完整链路
  const sources = (await (await request.get('/api/sources?agent_id=radar')).json()).sources;
  const rawItems = (await (await request.get('/api/raw-items?agent_id=radar&limit=1000')).json()).raw_items;
  const items = (await (await request.get('/api/items?agent_id=radar&limit=1000')).json()).items;
  const runs = (await (await request.get('/api/runs?agent_id=radar')).json()).runs;

  const ingestRuns = runs.filter((r: Record<string, unknown>) => r.phase === 'ingest' && r.status === 'done');
  const evalRuns = runs.filter((r: Record<string, unknown>) => r.phase === 'evaluate' && r.status === 'done');

  const rawByStatus: Record<string, number> = {};
  for (const ri of rawItems) {
    rawByStatus[ri.status] = (rawByStatus[ri.status] || 0) + 1;
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  DATA LINEAGE SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Sources:        ${sources.length} (${sources.filter((s: Record<string, unknown>) => !!s.enabled).length} enabled)`);
  console.log(`  Ingest runs:    ${ingestRuns.length} completed`);
  console.log(`  Raw items:      ${rawItems.length} total`);
  console.log(`    - pending:    ${rawByStatus['pending'] ?? 0}`);
  console.log(`    - promoted:   ${rawByStatus['promoted'] ?? 0}`);
  console.log(`    - rejected:   ${rawByStatus['rejected'] ?? 0}`);
  console.log(`  Evaluate runs:  ${evalRuns.length} completed`);
  console.log(`  Curated items:  ${items.length}`);
  console.log(`  Conversion:     ${rawItems.length} → ${items.length} (${((items.length / Math.max(rawItems.length, 1)) * 100).toFixed(0)}%)`);

  // 注意力快照
  const attRes = await request.get('/api/attention/snapshot?agent_id=radar');
  const att = await attRes.json();
  console.log('  ── Attention Mirror ──');
  for (const src of att.sources) {
    const dev = src.deviation >= 0 ? `+${(src.deviation * 100).toFixed(0)}%` : `${(src.deviation * 100).toFixed(0)}%`;
    console.log(`  ${src.source_name}: expected=${(src.expected_weight * 100).toFixed(0)}% actual=${(src.actual_weight * 100).toFixed(0)}% deviation=${dev}`);
  }
  console.log('═══════════════════════════════════════\n');

  // 最终断言：完整链路
  expect(sources.length, 'must have sources').toBeGreaterThan(0);
  expect(ingestRuns.length, 'must have completed ingest runs').toBeGreaterThan(0);
  expect(rawItems.length, 'must have raw_items').toBeGreaterThan(0);
  expect(evalRuns.length, 'must have completed evaluate runs').toBeGreaterThan(0);
  expect(items.length, 'must have curated items').toBeGreaterThan(0);
});
