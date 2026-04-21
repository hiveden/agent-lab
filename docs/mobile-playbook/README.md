# Mobile Playbook — 移动端交互设计与开发专题

> **定位**：agent-lab 移动端架构从"桌面分叉"演进到"消费优先独立体验"的完整设计档案。
> 包含架构 RFC、交互模型、设计系统、迁移路线与术语表。
>
> 本专题从 2026-04-21 起动，配合 `docs/22-OBSERVABILITY-ENTERPRISE.md` 之后的下一个里程碑推进。

---

## 专题背景

### 问题起点

agent-lab 当前移动端实现（`RadarWorkspace.tsx:322-394`）存在三层架构断裂：

1. **顶层分叉**：`if (isMobile)` 在顶层 UI 组件处分叉为两棵独立组件树，导致 Mobile/Desktop 数据通路、状态心智、交互语义全部双轨。
2. **数据通路分裂**：`MobileChatView` 走 `/api/chat`（OpenAI delta），桌面走 `/api/agent/chat`（AG-UI Protocol），移动端**丢失 trace_id 贯穿、tool call 可视化、Langfuse 观测**。
3. **覆盖面残缺**：仅 Inbox / Watching 有 Mobile 变体，Agent / Runs / Sources / Attention / Settings 五个 view 在 mobile 下直接复用桌面组件导致 200px 侧栏挤压。

### 产品定位的非对称

| 场景 | 设备 | 时长 |
|---|---|---|
| **Consumption**（消费） | 📱 地铁 / 床 / 排队 | 10s – 5min |
| **Production**（生产） | 💻 工位 | 5min – 2h |
| **Monitoring**（监控） | 📱/💻 | 10s 瞥一眼 |

→ 移动端定位：**Consumption + Monitoring 优先，Production 不做**（见 [`07-scope-decision.md`](./07-scope-decision.md)）。

---

## 核心设计原则

| # | 原则 | 一句话 |
|---|---|---|
| P1 | Surface / Domain 分离 | UI 可按设备分叉，数据 / 状态 / 协议全平台唯一 |
| P2 | Adaptive Shell, Responsive Content | Shell 按 breakpoint 切换，Content 用 container query 伸缩 |
| P3 | Single Data Path | 所有 chat 走 AG-UI；所有 mutation 走 pending queue |
| P4 | Progressive Disclosure | Mobile = essential + contextual；Desktop = full advanced |
| P5 | Thumb-First, Keyboard-Parity | Mobile 一手拇指可达；每个触控动作有键盘对等 |
| P6 | Observable by Default | trace_id 跨设备贯穿，Mobile 不能变盲区 |

---

## 文档索引

| 文件 | 内容 | 状态 |
|------|------|------|
| [`00-glossary.md`](./00-glossary.md) | 术语表：breakpoint / PWA / 原生壳 / APNs / container query / viewport 等 | ✅ |
| [`01-architecture-rfc.md`](./01-architecture-rfc.md) | 架构 RFC：五层分层、Shell 矩阵、数据流统一、可观测性契约 | ✅ |
| [`02-breakpoints-and-shells.md`](./02-breakpoints-and-shells.md) | 三档断点定义（compact / medium / expanded）+ 三种 Shell 实现 | ✅ |
| [`03-interaction-model.md`](./03-interaction-model.md) | 手势矩阵、Thumb Reach 分区、触觉反馈、键盘适配 | ✅ |
| [`04-design-tokens.md`](./04-design-tokens.md) | 设计系统代币：space / font / radius / color / motion 规范 | ✅ |
| [`05-pwa-strategy.md`](./05-pwa-strategy.md) | PWA 四阶段演进路径 + 原生壳决策条件 | ✅ |
| [`06-migration-roadmap.md`](./06-migration-roadmap.md) | 从当前代码到目标架构的 9 步迁移 + 验收 E2E | ✅ |
| [`07-scope-decision.md`](./07-scope-decision.md) | 决策记录：mobile 不做 Production view 的原因与边界 | ✅ |
| `08-validation-log.md` | 真机验证日志（iOS Safari / Android Chrome 矩阵踩坑记录） | ⏳ 持续填充 |
| `09-performance-budget.md` | Lighthouse 基线 + bundle 分析 + 性能 SLO 追踪 | ⏳ Step 1 后启动 |
| [`10-tech-selection-adr.md`](./10-tech-selection-adr.md) | **技术选型 ADR**（9 项决策 + 证据链 + 风险矩阵，基于 8 项并行调研） | ✅ 2026-04-21 |
| [`11-poc-copilotkit-v2.md`](./11-poc-copilotkit-v2.md) | PoC 执行计划 + 最终 VERDICT：CopilotKit v2 useAgent 7 项验证（6/7 PASS + 2 跳过） | ✅ 执行完成 2026-04-21 |

---

## 决策速查

### 已决策（2026-04-21）

- **Q1**：断点采用三档（`compact <768` / `medium 768-1279` / `expanded ≥1280`），用 Material 3 window size class 命名。
- **Q2**：Chat 通路统一到 AG-UI Protocol，废除 `/api/chat`。
- **Q3**：**Mobile 不做 Production view**（sources / 完整 settings 引导到桌面）。→ [`07-scope-decision.md`](./07-scope-decision.md)
- **Q4**：**引入正式设计系统 tokens**，结束散落的 magic number。→ [`04-design-tokens.md`](./04-design-tokens.md)
- **Q5**：item detail 改为独立路由（`/items/[id]`），URL 作为状态源。
- **Q6**：Pending queue 统一，Mobile swipe 不再直接提交。
- **Q7**：**Apple 开发者账号注册有阻塞点 → Phase 4（Capacitor + APNs）整体延后到下期**。本期范围 = PWA Phase 1 + 2 + Android Web Push。iOS 推送与原生壳进入下期 M4 里程碑。→ [`05-pwa-strategy.md`](./05-pwa-strategy.md)
- **Q8**：**技术选型 9 项 ADR**（8 项并行调研 + 交叉验证）→ [`10-tech-selection-adr.md`](./10-tech-selection-adr.md)
- **Q9**：**ADR-1 PoC 验证通过**（6/7 PASS + 2 共识跳过 + 0 FAIL）→ CopilotKit v2 `useAgent` 作为 Mobile/Desktop 统一 chat hook 的决策成立。归档：`docs/checkpoints/poc-copilotkit-v2.tar.gz`。详见 [`11-poc-copilotkit-v2.md`](./11-poc-copilotkit-v2.md) + `poc/copilotkit-v2-useagent/VERDICT.md`。

### 本期 / 下期边界

| 里程碑 | 内容 | 阻塞 |
|---|---|---|
| **M3.1** 架构修复 | Step 1-5（Shell / URL / AG-UI / Pending / Primitives） | 无 |
| **M3.2** Tablet 支持 | Step 6 | 依赖用户 iPad 使用反馈 |
| **M3.3** 性能 | Step 7 | 无 |
| **M3.4** PWA 离线 | Step 8-9（PWA-lite + SW + Android Push） | 无 |
| **M4** Mobile Native（**下期**） | Capacitor + APNs + iOS Web Push | ⏸ Apple 开发者账号 |

### 待决策

- **D1**：Tablet 档位优先级 — 依赖用户 iPad 使用频率反馈。
- **D2**：Production view 在 mobile 的"引导卡片"文案与交互（是否提供扫码直达桌面）→ [`07-scope-decision.md`](./07-scope-decision.md) §3.2 O3。
- **D3**（下期）：iOS 推送走 Web Push 还是 APNs — 收集 Phase 1-2 运行数据后定。

---

## 与主文档的关系

- 本专题是**设计档案**，不是技术实现文档。
- 实现进展在 `docs/25-TODO.md` 追踪（GitHub Issues label：`mobile` + milestone：`M2 企业级深化` 下新建 `M3 Mobile First`）。
- 真机踩坑记录在 `08-validation-log.md` 积累。
- 架构决策 ADR 合入 `docs/22-OBSERVABILITY-ENTERPRISE.md` 后续的 ADR 序列（若涉及观测性契约）。

---

## 更新约定

- **P1-P6 是主轴**，后续任何方案调整必须在这六条原则下自洽。
- **决策记录追加不删改**：若 Q3/Q4 等决定后续推翻，新决策追加到 README，保留演化痕迹。
- **真机验证优先**：任何 Lighthouse 分数、CLS 数字、FPS 结论必须来自真机实测（不接受模拟器推断）。
- **不侵染主文档**：本专题范围内的讨论留在 `mobile-playbook/` 下；跨栈契约（如 AG-UI 路由变更）同步更新主文档。
