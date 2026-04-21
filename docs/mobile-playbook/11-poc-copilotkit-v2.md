# 11 · PoC · CopilotKit v2 useAgent 可行性验证

> **决策前置**：本 PoC 是 [`10-tech-selection-adr.md`](./10-tech-selection-adr.md) ADR-1 的风险消除动作。
> PASS → 进入 Step 0；FAIL → 另议 fallback。
> **不写任何生产代码，验证完即归档。**
>
> ---
>
> **✅ 执行完成（2026-04-21）**
> - **结果**：**6/7 PASS + 2 共识跳过 + 0 FAIL** → ADR-1 决策成立
> - **完整 VERDICT**：`poc/copilotkit-v2-useagent/VERDICT.md`（归档前已合并证据）
> - **PoC 归档**：`docs/checkpoints/poc-copilotkit-v2.tar.gz`（377KB，不含 node_modules/.next）
> - **自动化脚本**：`poc/copilotkit-v2-useagent/poc-auto-verify.mjs`（V5 + V7 可回归）
> - **下一步**：进入 Step 0（数据层迁移 SWR → TanStack Query）→ [`06-migration-roadmap.md`](./06-migration-roadmap.md)

---

## 1. 目标

**在 1-1.5 天内，验证 `@copilotkit/react-core/v2` 的 `useAgent` hook 满足 agent-lab Mobile 统一 chat 通路的 7 个必要条件。**

---

## 2. 范围与隔离

| 层 | 决策 |
|---|---|
| 前端 | **新建 `poc/copilotkit-v2-useagent/`**（独立 Next.js 15，独立 package.json，不在 pnpm workspace 内，不污染 `apps/web`） |
| 后端 | **复用 `agents/radar`**（已跑 `:8001`），通过 BFF `:8788/api/agent/chat` SSE passthrough 访问 → **验证真实契约** |
| 观测 | **启动现有自托管栈**（`docker/start-all.sh`）：SigNoz + Langfuse + Collector |
| OTel SDK | **复用 `apps/web/src/components/OtelClientInit.tsx` 配置**，保证与生产一致 |
| 数据库 | 不需要 |
| 产出 | `poc/copilotkit-v2-useagent/VERDICT.md`：7 项结论 + 证据链 |
| 结束 | PASS → 归档 `docs/checkpoints/poc-copilotkit-v2.tar.gz`；FAIL → 讨论 fallback |

---

## 3. 用户已确认的路径选择

- **Runtime URL** = (b) 走 BFF `:8788/api/agent/chat` SSE passthrough
- **OTel SDK** = (a) 直接从 `apps/web/src/components/OtelClientInit.tsx` 复制配置
- **DB** = 不需要

---

## 4. 七项验证点

| # | 验证点 | 通过标准 | 证据形式 |
|---|---|---|---|
| **V1** | `useAgent().messages` 流式更新 | 发送消息后，UI 每 100-200ms 收到 partial content 递增（非一次到齐） | console.log 时间戳 + 视频录屏 |
| **V2** | `messages[].toolCalls` streaming 中实时可见 | LangGraph 触发 tool 时，Network tab 见 `TOOL_CALL_ARGS` event，UI 在 tool 执行**中**拿到部分 args | Network SSE 帧截图 + state 快照 |
| **V3** | `traceparent` 手动注入透传 | `<CopilotKit headers={{traceparent: ...}}>` 注入已知 trace_id，Python `structlog` 日志可 grep 到同 ID | 前后端日志对照 |
| **V4** | Langfuse 三端贯穿 | Langfuse `:3010` 按 trace_id 查到完整 LLM call；SigNoz `:3301` 查到前端 → BFF → Python span 连续 | 两个 UI 截图 |
| **V5** | SSE 断线重连 | Chrome DevTools Offline 3 秒后恢复，或切后台 30s 回前台，UI 继续接收后续消息 | 视频录屏 |
| **V6** | Dev Console Inspector 行为（#32 回归） | 不传 `agents__unsafe_dev_only` 时 Inspector 是否复现 #32 症状 | Inspector 截图 + console |
| **V7** | `isRunning` 翻转时机 | RUN_STARTED 后立即 true，RUN_FINISHED 后立即 false；与 AG-UI event 时间轴对齐 | console.log 时序 |

---

## 5. 执行阶段（可并行）

### 依赖图

```
Phase 0: 落文档（本文）                     ← 当前
    │
    ├─→ Phase A (并行): Scaffold             ← subagent-A
    │     P1. mkdir poc + create next-app
    │     P2. 最小对话页 + 状态 pretty print
    │
    ├─→ Phase B (并行): 契约审计 + OTel 挖取  ← subagent-B
    │     B1. 读 /api/agent/chat route 确认 SSE passthrough 契约
    │     B2. 读 OtelClientInit.tsx + 依赖 extract
    │     B3. 启动观测栈（docker/start-all.sh）并验证端口
    │
    ↓  合并
Phase C: 整合 PoC（人工/主线）
    C1. 把 B 的 OTel 配置塞进 A 的项目
    C2. pnpm dev 启动 + smoke test
    
    ↓
Phase D: 七项验证（人工）
    V1 → V7 逐一打标，填 VERDICT.md

    ↓
Phase E: 归档 / 决策
```

---

## 6. 每 Phase 产出物

### Phase A（subagent-A）
- `poc/copilotkit-v2-useagent/` 独立 Next.js 项目可启动
- `app/page.tsx`：最小对话页，含 `<CopilotKit>` + `useAgent` + 输入框 + 消息列表 + `<pre>{state}</pre>`
- `package.json`：`@copilotkit/react-core@latest`、`@copilotkit/runtime-client-gql@latest`、Next 15 / React 19
- `README.md`：启动说明
- **不包含 OTel**（等 Phase B 产出）

### Phase B（subagent-B）
- `poc/copilotkit-v2-useagent/contract-notes.md`：BFF `/api/agent/chat` 的 SSE 契约摘要（方法、headers、body shape、SSE event 格式）
- `poc/copilotkit-v2-useagent/otel-snippet.ts`：可直接放到 Phase A 项目的 `app/otel-init.tsx`（来自 `OtelClientInit.tsx`）
- `poc/copilotkit-v2-useagent/observability-check.md`：`docker/start-all.sh` 跑完后的端口 + UI 地址列表确认

### Phase C（人工/主线）
- 合并 A + B，`pnpm dev` 跑通
- 发送一条消息能看到流式回复

### Phase D（人工）
- `VERDICT.md` 填完 7 个结论
- `evidence/` 目录放截图 / 日志

### Phase E
- PASS 归档 + README 标记
- FAIL 写 `FAILURE-ANALYSIS.md`

---

## 7. VERDICT.md 模板

```markdown
# PoC Verdict · CopilotKit v2 useAgent

- 日期: 2026-04-XX
- 耗时: X h
- CopilotKit 版本: X.Y.Z
- Next.js: 15.x
- 前端提交: <ref>

## 快速结论
✅ PASS / ⚠ 部分 PASS / ❌ FAIL

## 逐项结果

### V1 流式更新
- [✅/⚠/❌]
- 观察: ...
- 证据: [./evidence/v1-stream.mp4](./evidence/v1-stream.mp4)

### V2 toolCalls 实时
- [状态]
- ...

### V3 traceparent 透传
- [状态]
- 注入 ID: `00-abc...-def-01`
- BFF 日志 grep 结果: ...
- Python structlog grep: ...

### V4 Langfuse 三端贯穿
- Langfuse trace URL:
- SigNoz trace URL:

### V5 断线重连
### V6 Dev Console (#32 回归)
### V7 isRunning 时机

## 遗留问题
...

## 决策建议
- 若 ≥ 6/7 PASS → 进入 Step 0
- 若 V1/V3/V4 任一 FAIL → ADR-1 要改方案
- 若 V2/V5/V6/V7 FAIL → 可 workaround，记录限制
```

---

## 8. 时间预算

| Phase | 人 | 时长 |
|---|---|---|
| A Scaffold | subagent-A | 30 min（并行） |
| B 契约 + OTel + Docker | subagent-B | 30 min（并行） |
| C 整合 | 人工/主线 | 30 min |
| D 七项验证 | 人工 | 3 h |
| E 归档 | 人工 | 15 min |
| **合计** | | **~5 h 有效工时（今天一天内完成）** |

Buffer 留 0.5 天应对：CopilotKit runtime URL 404、AG-UI event 字段命名漂移、observability 栈启动失败等。

---

## 9. 失败预案

| 失败点 | 应对 |
|---|---|
| V1 流式更新 FAIL | ADR-1 彻底推翻，考虑 fallback：v1 `useCopilotChat` 或自写 AG-UI client |
| V3 traceparent 不透传 | 方案 A：自 patch CopilotKit；方案 B：在 BFF passthrough 层补 W3C 上下文抽取（额外成本） |
| V4 Langfuse trace 断链 | 可能是 Python 侧 FastAPIInstrumentor 配置问题，不必推翻 ADR-1 |
| V6 #32 复现 | 记录为已知限制，加 `agents__unsafe_dev_only={}` 稳定引用 workaround |
| 观测栈启动失败 | 降级：V3/V4 用 `/tmp/radar-dev*.log` 的 structlog 日志 grep 代替 UI 验证 |

---

## 10. 结束清单

- [ ] `VERDICT.md` 填完
- [ ] `evidence/` 有 7 项对应证据
- [ ] PASS → `tar czf docs/checkpoints/poc-copilotkit-v2.tar.gz poc/copilotkit-v2-useagent/`
- [ ] 更新 [`10-tech-selection-adr.md`](./10-tech-selection-adr.md) ADR-1 的"待 PoC 验证项" → 勾选状态
- [ ] 更新 [`06-migration-roadmap.md`](./06-migration-roadmap.md) Step 3 前置条件 → ✅
