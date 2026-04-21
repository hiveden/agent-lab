# 术语表（Glossary）

> 移动端专题里会反复出现的概念，一次性讲清楚。每条包含**定义 / 为什么重要 / 对 agent-lab 的含义**。

---

## Breakpoint（断点）

**定义**：响应式 CSS 里，窗口宽度跨过某个阈值时切换布局的分界线。**不是调试断点**。

**示例**：
```css
@media (min-width: 768px)  { /* ≥ 768px 生效 */ }
@media (min-width: 1280px) { /* ≥ 1280px 生效 */ }
```

**为什么重要**：同一用户的 iPad 竖屏 (768px)、MacBook 分屏 (960px)、外接大屏 (1920px) 需要不同布局，只有一个 breakpoint 表达力不够。

**agent-lab 当前**：单一 breakpoint = 640px，`isMobile` 非黑即白。
**重设计后**：两个 breakpoint，三档 `compact / medium / expanded`。见 [`02-breakpoints-and-shells.md`](./02-breakpoints-and-shells.md)。

---

## Viewport（视口）

**定义**：浏览器中网页实际可见的像素区域。

**三种 viewport**：
- **Layout Viewport**：CSS 排版用的尺寸（桌面 = 窗口宽；移动端 = `meta name="viewport"` 声明的 `width=device-width`）
- **Visual Viewport**：当前实际可见部分（移动端软键盘弹出时，visual viewport 变小，layout viewport 不变）
- **Window Size Class**：Material 3 / Apple HIG 的抽象概念——按 **layout viewport 宽度** 分成 compact / medium / expanded

**为什么重要**：
- `100vh` 在 iOS Safari 会把地址栏高度也算进去 → 内容被遮 → 改用 `100dvh`（dynamic viewport height）
- 键盘弹起要用 `visualViewport` API 监听，调整 input 位置避免被遮

**agent-lab**：`MobileChatView.tsx:64` 已用 `visualViewport` 处理键盘弹起，但只在 chat view 生效。重设计后提升到根 layout。

---

## Container Query（容器查询）

**定义**：CSS 新特性，让**组件按自己所在容器的宽度**而不是**窗口宽度**响应。

**对比**：
```css
/* Media query：看窗口宽度 */
@media (max-width: 400px) { .card { font-size: 13px; } }

/* Container query：看父容器宽度 */
.card-wrapper { container-type: inline-size; }
@container (max-width: 400px) { .card { font-size: 13px; } }
```

**为什么重要**：`ItemCard` 在桌面右侧 300px 面板里和在手机 375px 全屏下**看起来应该一样**，但 viewport 完全不同。Media query 做不到，Container query 可以。

**浏览器支持**：Chrome 105+ / Safari 16+ / Firefox 110+。iOS 15 不支持 → 需要 polyfill 或降级。

---

## PWA（Progressive Web App）

**定义**：通过一组浏览器 API 让普通网页"伪装成 App"的技术集合。

**三要素**：

| 能力 | 依赖 | 效果 |
|---|---|---|
| 可安装到主屏 | `manifest.json` + icons | 长按分享 → "添加到主屏"，生成带图标启动器 |
| 离线可用 | Service Worker | 飞行模式下能打开、读缓存 |
| 后台推送 | Push API + Background Sync | 关掉 app 也能收通知 |

**vs 普通网页**：PWA 能装、能离线、能推送。
**vs 原生 App**：不走应用商店、改代码立刻部署、但部分硬件 API 不可用。

**对 agent-lab 的意义**：单用户多设备场景天然适合——地铁 Safari 里 mark 的内容，回家桌面 Chrome 立刻同步；不用装两个 App。见 [`05-pwa-strategy.md`](./05-pwa-strategy.md)。

---

## Service Worker（SW）

**定义**：浏览器后台运行的 JS 脚本，能拦截网络请求、缓存资源、处理推送。PWA 的核心。

**关键能力**：
- `fetch` 事件拦截 → 离线时从 cache 返回
- `push` 事件 → 收到服务端推送（即使 app 关闭）
- `sync` 事件 → 网络恢复时触发（做 pending 队列的 flush）

**调试陷阱**：SW 有激进的缓存策略，dev 模式容易拿到旧版本。agent-lab 约定：**只在 production build 启用 SW**，wrangler dev 关闭。

---

## 原生壳（Native Shell / Wrapper）

**定义**：把网页塞进 iOS/Android App 外壳里，上架应用商店发布。

**主流方案**：

| 方案 | 本质 | 优缺点 |
|---|---|---|
| **Capacitor**（Ionic 出品） | WKWebView / Android WebView + JS↔原生桥 | 网页代码一份不改，能调原生 API；性能依赖 WebView |
| **Expo / React Native** | JS → 原生组件编译，非 WebView | 性能好但要重写 UI，不是"壳" |
| **Tauri Mobile** | Rust 写的壳，类似 Capacitor | 新，生态不如 Capacitor |

**PWA vs 原生壳 一句话**：
- PWA = 网页 + 装饰（便宜、迭代快、iOS 功能受限）
- 原生壳 = 网页 + 原生 API（贵、要审核、能用 APNs / Face ID / 后台服务）

---

## APNs（Apple Push Notification service）

**定义**：iPhone 收推送的**唯一合法通道**。Apple 不允许第三方 app 自己保持长连接（系统会杀），必须经过 Apple 的服务器。

**流程**：
```
你的后端 → Apple APNs 服务器 → (系统级长连接) → 用户 iPhone
         发送 payload + device token
```

**要求**：
- Apple 开发者账号（$99/年）
- 真正的 iOS App（有 Bundle ID）→ **PWA 拿不到 APNs，必须原生壳**
- 每个设备唯一 device token，后端要存

**iOS Web Push（PWA 推送）vs APNs**：
- iOS 16.4+ 支持 Web Push，但要求用户**必须先"添加到主屏"**才能授权
- 比 APNs 限制多（格式、频率、可见性都弱）
- 大多数用户不会主动添加到主屏 → 覆盖率低

**对 agent-lab 的决策意义**：Android PWA 推送够用；iOS 想高覆盖率推送 → Capacitor + APNs。这是**要不要做原生壳的核心决策变量**。

---

## FCM（Firebase Cloud Messaging）

**定义**：Android 的 Google 侧推送通道，类似 APNs。PWA 的 Web Push 在 Android Chrome 下实际走 FCM。

**对 agent-lab**：PWA 在 Android 上推送覆盖率 ≫ iOS，部分原因是 FCM 比 iOS Web Push 限制少。

---

## Safe Area Inset（安全区）

**定义**：iPhone X 及之后刘海/灵动岛、底部手势条占据的物理区域。CSS 提供 `env(safe-area-inset-*)` 读取真实值。

**用法**：
```css
.bottom-bar { padding-bottom: env(safe-area-inset-bottom, 0); }
```

**agent-lab**：`TabBar.tsx:21` + `MobileChatView.tsx:201` 已用。重设计后在 Shell 级统一。

---

## Window Size Class（窗口尺寸类）

**定义**：Google Material 3 / Apple HIG 都采用的响应式分类。用**容器宽度**而不是"手机/平板/桌面"命名，避免设备形态固化。

**分档**（Material 3）：
| Class | 宽度 | 典型设备姿态 |
|---|---|---|
| compact | < 600dp | 手机竖屏、折叠屏折叠 |
| medium | 600-839dp | 手机横屏、平板竖屏、折叠屏展开 |
| expanded | ≥ 840dp | 平板横屏、桌面 |

**agent-lab 采用**：compact <768 / medium 768-1279 / expanded ≥1280（宽度略调以匹配 Tailwind 默认 breakpoint）。见 [`02-breakpoints-and-shells.md`](./02-breakpoints-and-shells.md)。

---

## Thumb Reach / Thumb Zone（拇指区）

**定义**：iOS HIG / Material 触控设计概念。单手持握手机时拇指能舒适触达的屏幕区域。

**分区**（iPhone 竖屏，右手持握）：
```
┌─────────┐
│  HARD   │  ← 顶部 25%（拇指要换手才能到）→ 放被动信息
├─────────┤
│  OK     │  ← 中段 50% → 主内容
├─────────┤
│  EASY   │  ← 底部 25% → 主动作（TabBar、Input、Apply）
└─────────┘
```

**对 agent-lab**：`PendingChangesBanner` 在桌面是顶部 banner，mobile 必须落在**底部 EASY 区**。见 [`03-interaction-model.md`](./03-interaction-model.md)。

---

## AG-UI Protocol

**定义**：CopilotKit 推的 Agent 与前端通信协议，基于 SSE 传输结构化事件（TEXT_MESSAGE_START / TOOL_CALL / STATE_DELTA / ...）。

**agent-lab 中的位置**：
```
CopilotKit 前端 → BFF SSE passthrough → Python FastAPI → LangGraph
                       /api/agent/chat       /agent/chat
```

**为什么重要**：带 trace_id 贯穿（ADR-002c）、带 tool call 可视化、带 Langfuse 自动回填。移动端走 `/api/chat` OpenAI delta 会**丢失所有这些能力**。

重设计后 Mobile 统一接入 AG-UI，见 [`01-architecture-rfc.md`](./01-architecture-rfc.md) Step 3。

---

## Hydration（水合）

**定义**：Next.js SSR 场景，服务端先渲染静态 HTML，客户端 JS 加载后"接管"交互的过程。

**陷阱**：服务端不知道 `window.matchMedia` → 不知道设备宽度 → SSR 默认渲染会闪烁。

**agent-lab 当前**：`useIsMobile()` 初始返回 `undefined` → 渲染空骨架。
**重设计**：用 User-Agent Hint (`Sec-CH-UA-Mobile`) 在 Edge 侧**提前猜 Shell**，减少闪烁。见 [`02-breakpoints-and-shells.md`](./02-breakpoints-and-shells.md)。

---

## CLS / LCP / INP / FCP

Core Web Vitals 性能指标：

| 缩写 | 全称 | 含义 | 好 / 差阈值 |
|---|---|---|---|
| FCP | First Contentful Paint | 首次渲染任何内容的时间 | <1.8s / >3s |
| LCP | Largest Contentful Paint | 最大内容渲染时间 | <2.5s / >4s |
| CLS | Cumulative Layout Shift | 布局累计偏移 | <0.1 / >0.25 |
| INP | Interaction to Next Paint | 交互到下一帧的延迟 | <200ms / >500ms |

**agent-lab 的 CLS 风险**：`isMobile === undefined` 返回空骨架，hydrate 后 swap 整棵树 → CLS 爆炸。重设计后用骨架屏 + UA Hint 预判。

---

## Optimistic UI（乐观更新）

**定义**：用户点按后立即本地改 UI，不等服务端确认。失败时回滚 + toast 提示。

**agent-lab**：移动 swipe 立即改 pending map 是 optimistic；apply 按钮才真提交 mutation。这个模式重设计后全平台统一。
