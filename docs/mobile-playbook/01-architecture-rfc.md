# 01 · 架构 RFC

> 本文是移动端架构重设计的权威设计文档。所有实现 PR 的目标以本文为准。
> 术语参见 [`00-glossary.md`](./00-glossary.md)。

---

## 1. 根因诊断

### 1.1 当前架构的分叉位置错了

```
RadarWorkspace.tsx:322
  if (isMobile) { <整棵 Mobile 组件树> }
  else         { <整棵 Desktop 组件树> }
```

分叉点在**顶层 UI 组件**，产生四层连锁问题：

1. **数据通路分叉**：`MobileChatView.tsx:89` 调 `/api/chat`，`AgentView` 走 `/api/agent/chat` → trace_id 断裂、tool call 丢失、Langfuse 覆盖不到 Mobile。
2. **状态心智分叉**：`RadarWorkspace.tsx:335-351` mobile swipe 直接 fetch 提交，桌面走 pending queue → 两套用户心智模型。
3. **组件重复**：`MobileItemsList` / `MobileChatView` 是对 `ItemsList` / `ChatView` 的手抄副本，修改要改两处。
4. **覆盖面不全**：只有 Inbox/Watching 有 Mobile 变体，Agent/Runs/Sources/Attention/Settings 五个 view 在 mobile 下直接复用桌面组件 → `SessionSidebar.tsx:28` 硬编码 `w-[200px]` 在 375px 屏上溢出。

### 1.2 产品定位的非对称

| 场景 | 设备 | 主要动作 | 时长 |
|---|---|---|---|
| Consumption | 📱 | 刷 Inbox、swipe、读摘要、追问 | 10s – 5min |
| Production | 💻 | 调 Source、读 Run trace、改 Attention、改 Settings | 5min – 2h |
| Monitoring | 📱/💻 | 看 Mirror 偏差、瞥一眼 Runs | 10s |

**移动端不是"桌面的缩小版"，是 Consumption + Monitoring 优先、Production 不做的独立产品形态**。这是后续所有设计决策的基石。

---

## 2. 六条设计原则

| # | 原则 | 展开 |
|---|---|---|
| **P1** | **Surface / Domain 分离** | UI 层可按设备分叉；Domain（数据、状态、Agent 通信）全平台唯一 |
| **P2** | **Adaptive Shell, Responsive Content** | Shell 按 breakpoint 整体切换；Content 用 container query 自适应 |
| **P3** | **Single Data Path** | Chat 一律 AG-UI；Mutation 一律 pending queue；不存在"移动端特殊通路" |
| **P4** | **Progressive Disclosure** | Mobile: essential + contextual；Desktop: full advanced |
| **P5** | **Thumb-First, Keyboard-Parity** | Mobile 单手拇指可达；Desktop 所有触控有键盘对等 |
| **P6** | **Observable by Default** | trace_id 跨设备贯穿，Mobile 不能变盲区 |

---

## 3. 五层分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 5 · Shell           ← 按 breakpoint 整体切换            │
│    shells/{Mobile,Tablet,Desktop}Shell.tsx                   │
├──────────────────────────────────────────────────────────────┤
│  Layer 4 · Surface         ← 视图组件（View）                  │
│    views/consumption/InboxView.tsx 等                         │
│    单一实现，内部按 viewport 微调                              │
├──────────────────────────────────────────────────────────────┤
│  Layer 3 · Primitives      ← 通用响应式组件                    │
│    primitives/ItemCard.tsx / MessageBubble.tsx / Sheet.tsx   │
│    用 container query 响应父容器宽度                           │
├──────────────────────────────────────────────────────────────┤
│  Layer 2 · Domain          ← 业务逻辑 / 状态（平台无关）        │
│    hooks/useItems / usePending / useChatSession / useDwell   │
│    Zustand store slices                                      │
├──────────────────────────────────────────────────────────────┤
│  Layer 1 · Protocol        ← 外部通信                         │
│    AG-UI client / SWR / fetch wrapper / OTel SDK             │
└──────────────────────────────────────────────────────────────┘
```

**层间约束**：
- 上层只能依赖下层
- 同层不互相依赖
- 不能跨层（当前 `MobileChatView` 从 Layer 4 跳过 Layer 2 直调 Layer 1 就是违规，重设计后禁止）

---

## 4. Shell 矩阵

| Viewport | Shell | 导航 | 主内容 | 次内容 |
|---|---|---|---|---|
| compact (<768px) | MobileShell | 底部 TabBar (5 项) | 全屏单栏 | Sheet 抽屉（底部滑上） |
| medium (768-1279px) | TabletShell | 左侧 NavRail 窄版 (52px) | 单栏 70% | 右侧 Slide Panel 30%（可收起） |
| expanded (≥1280px) | DesktopShell | NavRail + optional sidebar | Multi-panel resizable | 内嵌侧栏 |

详见 [`02-breakpoints-and-shells.md`](./02-breakpoints-and-shells.md)。

---

## 5. View 的可见性矩阵

| View | compact | medium | expanded | 备注 |
|---|---|---|---|---|
| `inbox` / `watching` | ✅ 主要 | ✅ | ✅ | 移动端主战场 |
| `attention` (Mirror) | ✅ 只读摘要 | ✅ 交互版 | ✅ 完整 | 监控视角，移动端保留 |
| `agent` (sessions) | ⚠ 只读历史 | ✅ 可对话 | ✅ 完整 | Mobile 只看不改 |
| `runs` | ⚠ 状态 Glance | ✅ 可触发 | ✅ 完整 | Mobile 监控 = Glance view |
| `sources` | ❌ 引导 | ✅ 可编辑 | ✅ | **Mobile 不做**，见下 |
| `settings` | ⚠ 核心项 | ✅ | ✅ | Mobile 只给 LLM mock toggle |

**❌ 引导**含义：Mobile 点进 sources 不渲染挤压的桌面组件，而是渲染**友好引导卡片**："此功能需要在电脑上配置" + 可选"扫码发送 URL 到桌面"。见 [`07-scope-decision.md`](./07-scope-decision.md)。

---

## 6. 数据流统一

### 6.1 Chat 通路：废除 `/api/chat`

```
Before（断裂）：
  Desktop: CopilotKit → /api/agent/chat (AG-UI SSE) → Python → LangGraph
  Mobile:  fetch      → /api/chat       (OpenAI-style delta)

After（统一）：
  Desktop + Mobile: useChatSession() → /api/agent/chat (AG-UI SSE) → Python → LangGraph
                        ↑
                    Layer 2 hook，Layer 4 只消费不感知协议
```

- `useChatSession` 封装 AG-UI 事件流，对外暴露 `{ messages, sendMessage, isStreaming, toolCalls }`
- `DesktopChatView` 与 `MobileChatView` 只负责渲染，不碰协议
- 结果：trace_id 贯穿、Langfuse 自动回填、tool call 可视化在 Mobile 全部恢复

### 6.2 Mutation：废除 Mobile 立即提交

```
Before：
  Mobile swipe → fetch PATCH 立即提交 → 绕开 pending
  Desktop W/D/X → markPending → apply 批量提交

After：
  所有设备 swipe / W/D/X → markPending
  Mobile: 底部 PendingChangesSheet 显示"Apply 3 changes"
  Desktop: 顶部 PendingChangesBanner
```

好处：
- 心智模型统一
- 离线可用（无网时照样堆 pending，恢复后 flush）
- 批量 undo

### 6.3 URL 作为状态源

```
/agents/radar/inbox?filter=fire         ← filter 入 URL
/agents/radar/items/abc123              ← 选中入路由
/agents/radar/items/abc123#trace        ← trace 展开入 hash
```

- Zustand 只存 UI 局部偏好（chat 高度、trace 宽度）
- 业务状态走 URL + SWR
- Mobile 浏览器后退键天然生效
- 支持"手机看到感兴趣 → 分享 URL 到桌面继续追"

---

## 7. 可观测性契约

### 7.1 trace_id 贯穿不能变

```
前端 OTel SDK（全设备一致）
  → W3C traceparent header
  → BFF Node OTel auto-propagate
  → Python FastAPIInstrumentor
  → LangGraph + LLM call
  → Langfuse (trace_id 自动绑定)
```

**Mobile 接入 AG-UI 后，Langfuse 会自动拿到 trace_id**（ADR-002c 契约不变）。

### 7.2 新增 Mobile RUM 指标

推向 SigNoz：
- `mobile.swipe.commit_duration` — swipe 触发到 UI 确认的端到端延迟
- `mobile.chat.ttfb` — 发送消息到第一个 token 渲染
- `mobile.inbox.scroll.frame_drops` — 虚拟滚动帧丢失数
- `mobile.viewport.class` — tag：compact/medium/expanded

### 7.3 Sentry 分切片

错误事件增加 `device.form_factor` tag，iOS Safari 特有错误可单独过滤。

---

## 8. 性能预算

| 指标 | Compact (4G) | Expanded (Wi-Fi) |
|---|---|---|
| FCP | ≤ 1.5s | ≤ 0.8s |
| LCP | ≤ 2.5s | ≤ 1.5s |
| INP | ≤ 200ms | ≤ 100ms |
| CLS | ≤ 0.05 | ≤ 0.05 |
| Mobile first paint bundle | ≤ 120KB gzip | — |
| Desktop first paint bundle | — | ≤ 250KB gzip |
| Inbox 1000 items FPS | ≥ 55 | ≥ 58 |

基线数据在 Step 1 完成后通过 `next build --analyze` + 真机 Lighthouse 采集，记入 `09-performance-budget.md`。

---

## 9. 已决策 / 待决策

### 已决策（2026-04-21）

- **D1** breakpoint 采用 compact/medium/expanded 三档（命名来自 Material 3 window size class）
- **D2** Chat 统一 AG-UI
- **D3** Mutation 统一 pending queue
- **D4** item detail 改为独立路由
- **D5** Mobile 不做 Production view（Sources + 完整 Settings）→ [`07-scope-decision.md`](./07-scope-decision.md)
- **D6** 引入设计系统 tokens → [`04-design-tokens.md`](./04-design-tokens.md)
- **D7** 全平台 OpenTelemetry 前端 RUM 必做

### 待决策

- **O1** Tablet 优先级：是否在 Step 6 之前做 → 等用户 iPad 使用频率反馈
- **O2** 原生壳：是否进入 Phase 4（Capacitor + APNs）→ [`05-pwa-strategy.md`](./05-pwa-strategy.md)
- **O3** Production view 在 mobile 的引导交互（扫码？深链？邮件自己？）

---

## 10. 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R1 | iOS 15 不支持 Container Query | polyfill 或降级到 viewport query；单用户场景可要求 iOS 16+ |
| R2 | URL + Zustand persist 双写冲突 | 规则：URL 存"能分享的"，Zustand 存"个人偏好" |
| R3 | AG-UI headless hook 踩 CopilotKit 生命周期坑（issue #32 教训） | Step 3 之前单开 demo 验证 `useChatSession` PoC |
| R4 | Service Worker 在 wrangler dev 干扰 | SW 只在 production build 启用 |
| R5 | iOS Safari dvh / safe-area 小版本漂移 | 真机矩阵：iOS 16.7 / 17.6 / 18.x |
| R6 | 改造体量与"不过度工程化"冲突 | Step 1-5 必做（修架构断裂），Step 6-9 按需 |

---

## 11. 迁移路线图（摘要）

详见 [`06-migration-roadmap.md`](./06-migration-roadmap.md)：

| Step | 目标 | 验收 |
|---|---|---|
| 1 | 断点 + Shell 抽象 | 三档 Shell 可进入，无行为变化 |
| 2 | 路由化 item detail | 浏览器后退键能返回 |
| 3 | Chat 通路统一 AG-UI | Mobile chat 出现在 Langfuse |
| 4 | Pending 统一 | Mobile apply 一批与桌面相同路径 |
| 5 | Primitives 抽取 | `MobileItemsList` / `MobileChatView` 可删 |
| 6 | Tablet 档位 | iPad portrait 不挤桌面 |
| 7 | 性能 | Lighthouse mobile ≥ 90 |
| 8 | PWA-lite | iOS 可添加到主屏 |
| 9 | Offline | 飞行模式 mark 能恢复同步 |
