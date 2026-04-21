# 05 · PWA 策略与原生壳决策

> 从普通网页到原生 App 壳的四阶段演进路径。
> 术语参见 [`00-glossary.md`](./00-glossary.md)（PWA / Service Worker / 原生壳 / APNs / FCM）。

---

## 1. 当前阻塞决策（2026-04-21）

> **Apple 开发者账号注册存在阻塞点，Phase 4（Capacitor + APNs）整体推迟到下期里程碑。**
>
> 本专题（本期）范围 = **Phase 1 + Phase 2 + Phase 3 Android 侧**。
> iOS Web Push / Apple 开发者账号 / Capacitor 壳 / APNs 全部留到下期评估。

---

## 2. 演进阶段图

```
Phase 0 (当前) ─── Next.js SPA on Cloudflare Pages
           │
           ▼
Phase 1  ───── PWA-lite (本期) ★
           │  · manifest.json + icons + splash
           │  · 可添加到主屏
           │  · iOS / Android 都能用
           │  · 无离线，无推送
           ▼
Phase 2  ───── PWA-full (本期) ★
           │  · Service Worker
           │  · Offline Inbox 缓存
           │  · Background Sync（pending queue flush）
           │  · iOS / Android 都能用
           ▼
Phase 3a ───── Android Web Push (本期) ★
           │  · Chrome + FCM
           │  · 不需要 Apple 账号
           ▼
Phase 3b ───── iOS Web Push (下期，待 Apple 账号)
           │  · iOS 16.4+
           │  · 要求用户"添加到主屏"才能推
           │  · 覆盖率低，但不要求开发者账号
           ▼
Phase 4  ───── Capacitor 壳 + APNs (下期) ⏸
                · iOS 原生推送
                · Haptics 原生 API
                · Face ID / Touch ID
                · 上架 App Store 审核
                · 需要 Apple 开发者账号（阻塞点）
```

---

## 3. Phase 1 · PWA-lite（本期）

### 3.1 产出

- `apps/web/public/manifest.json`
- 完整 icon 套件（72/96/128/144/152/192/384/512）
- Splash 图（iOS 多尺寸）
- `<link rel="manifest">` + iOS-specific meta tags

### 3.2 manifest.json 骨架

```json
{
  "name": "agent-lab",
  "short_name": "agent-lab",
  "description": "Personal AI agent platform with cognitive mirror",
  "start_url": "/agents/radar",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#18181b",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 3.3 iOS 特殊处理

iOS Safari 对 manifest 支持不完整，还要：

```html
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="agent-lab" />
```

### 3.4 验收

- [ ] iOS Safari 分享菜单 "添加到主屏" 显示正确图标 + 名字
- [ ] 添加后点击从主屏启动，全屏无浏览器 chrome
- [ ] Android Chrome 自动弹出 "Install" 横幅
- [ ] Lighthouse PWA 检查 ≥ 90

### 3.5 阻塞 / 风险

- **无**。Phase 1 纯配置文件，无账号依赖，无审核。

---

## 4. Phase 2 · PWA-full（本期）

### 4.1 产出

- `public/sw.js`（Service Worker）
- 离线 Inbox 缓存策略
- IndexedDB 存 pending queue
- Background Sync 注册

### 4.2 缓存策略

| 资源 | 策略 | 原因 |
|---|---|---|
| `/agents/radar/*` HTML | Network First, fallback cache | 保证功能新，断网降级 |
| 静态 JS/CSS（带 hash） | Cache First | hash 变就是新文件 |
| `/api/items` GET | Stale While Revalidate | 离线可读旧数据 |
| `/api/agent/chat` SSE | 不缓存（Network Only） | 实时流 |
| `/api/items/[id]/state` PATCH | Network First + IndexedDB queue | 失败入队，恢复后 flush |

### 4.3 Background Sync

```js
// sw.js
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-pending') {
    event.waitUntil(flushPendingQueue());
  }
});
```

客户端：
```ts
// markPending 时
if ('serviceWorker' in navigator && 'sync' in registration) {
  await registration.sync.register('flush-pending');
}
```

### 4.4 wrangler dev 兼容

**只在 production build 启用 SW**：

```ts
// next.config.mjs
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
});
```

### 4.5 验收

- [ ] 飞行模式下打开主屏 app，Inbox 显示最后同步数据
- [ ] 离线 swipe 一条 item，恢复网络后自动提交到 `/api/items/[id]/state`
- [ ] 主动刷新 app，新版 SW 激活走完 skipWaiting + clients.claim
- [ ] Lighthouse "Works offline" 通过

### 4.6 阻塞 / 风险

- SW 缓存策略错了会让用户卡旧版 → 上线前在 dev 全面测试 `updatefound` 流程
- IndexedDB schema 迁移复杂 → 用 `idb-keyval` 简化，不自己写
- **无账号依赖**

---

## 5. Phase 3a · Android Web Push（本期，可选）

### 5.1 产出

- VAPID key pair
- 服务端 Web Push endpoint（Cloudflare Worker 或 Python 侧）
- 订阅 UI（Settings 里"接收 Radar 推送"开关）

### 5.2 流程

```
用户点订阅 → navigator.serviceWorker.ready
         → registration.pushManager.subscribe({ applicationServerKey: VAPID_PUB })
         → 把返回的 subscription JSON POST 到后端保存
         
新 fire 内容到达 → 后端用 VAPID_PRIV 签名 + web-push library 推
                → FCM → Chrome → SW push 事件
                → showNotification(...)
```

### 5.3 触发条件（Radar 特定）

- 新 `fire` 级 item 入库
- 评判 run 完成（可选）

### 5.4 验收（Android only）

- [ ] Android Chrome 添加到主屏后，Settings 能开启推送
- [ ] 后端推一条测试消息，手机 app 关闭状态下收到
- [ ] 点击通知打开对应 item detail（URL 路由）

### 5.5 风险 / 阻塞

- VAPID key 生成 / 存储需走 Cloudflare env vars
- **iOS 部分无法走此路径**，需 Phase 3b 或 Phase 4

---

## 6. Phase 3b · iOS Web Push（**下期**）

### 6.1 为什么延后

- iOS 16.4+ 才支持
- 要求用户**先手动"添加到主屏"**才能订阅推送 → 覆盖率低
- 即使不需要 Apple 开发者账号，也建议与 Phase 4 一起评估 APNs 路径收益
- **用户 2026-04-21 决定：iOS 相关整体延后到下期**

### 6.2 下期再评估时的决策树

```
iOS 推送需求 = 主屏添加率 × 推送接受率 ≥ 50%？
├─ 是 → iOS Web Push 够用（Phase 3b），不需要原生壳
└─ 否 → 上 APNs（Phase 4），需要 Apple 开发者账号
```

决策依据在 Phase 1 + Phase 2 上线后收集：用户行为日志看多少人点了"添加到主屏"。

---

## 7. Phase 4 · Capacitor 原生壳（**下期**）

### 7.1 阻塞点

- **Apple 开发者账号未就绪**（$99/年 + 注册审核）
- 上架 App Store 审核周期
- 原生壳的 CI/CD 和签名流程

### 7.2 为什么要做（下期评估）

只有满足以下任一条件才启动：

1. **iOS 推送覆盖率 Phase 3b 实测 < 30%**，且推送是高价值功能
2. **需要原生 API**：Haptics、Face ID、后台地理位置、深度通知交互
3. **产品上架需求**：独立 App 品牌 / 付费分发 / 审核场景

agent-lab 当前是单用户工具，第 3 条不适用。第 1-2 条取决于 Phase 1-3 运行后的实际数据。

### 7.3 下期规划占位

```
下期 Milestone: M3 Mobile Native (草案)
├─ 前置: Apple 开发者账号注册完成
├─ Phase 4a: Capacitor 集成（WebView 壳 + JS Bridge）
├─ Phase 4b: APNs 集成 + device token 后端存储
├─ Phase 4c: Haptics / Face ID 原生 API 接入
└─ Phase 4d: TestFlight 内测 → App Store 审核
```

详细方案在下期专题文档。

---

## 8. 本期 PWA 范围总结

| Phase | 本期 | 下期 | 阻塞原因 |
|---|---|---|---|
| 1 PWA-lite | ✅ | — | 无 |
| 2 PWA-full | ✅ | — | 无 |
| 3a Android Web Push | ✅（可选） | — | 无 |
| 3b iOS Web Push | — | ⏸ | 与 Phase 4 一起评估 |
| 4 Capacitor + APNs | — | ⏸ | **Apple 开发者账号注册阻塞** |

本期目标：**让 agent-lab 在 iOS / Android 上可添加到主屏 + 离线 Inbox 可读 + Android 可推送**。iOS 推送延后。

---

## 9. 与观测性的交互

PWA SW 需要：
- 自身错误上报到 GlitchTip（sw.js 里 try/catch + fetch 到错误端点）
- Push 事件计数到 SigNoz（通过 BFF 的 ingress metric）
- Background Sync 成功率追踪

这些在 Phase 2 完成后纳入观测面板。

---

## 10. 验收路径

1. Phase 1 上线 → Lighthouse PWA 审计过 90
2. Phase 2 上线 → 真机飞行模式测试（iOS 17 + Android 14）
3. Phase 3a 上线（可选） → 真机 Android 推送测试
4. 收集运行数据 → 下期决策 Phase 3b vs Phase 4
