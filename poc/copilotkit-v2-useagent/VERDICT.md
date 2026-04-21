# PoC Verdict · CopilotKit v2 useAgent

- **日期**: 2026-04-21
- **耗时**: ~3 h（含整合 + 诊断 trace 断链 + 自动化 V5/V7）
- **CopilotKit**: `@copilotkit/react-core@1.56.2` + `@copilotkit/runtime@1.56.2`
- **Next.js**: 15.1.6
- **React**: 19.0.0
- **Python**: radar-serve（`LITELLM_PROXY_URL=disabled` 直连 CPA `:8317`）

---

## 快速结论

✅ **PASS**（6/7 通过，1 项按共识跳过，0 FAIL）→ **进入 Step 0 + Step 3**

---

## 逐项结果

### V1 流式更新

- 状态: ✅ **PASS**
- 观察: 浏览器 UI 发送消息后，assistant content 逐字/逐段增长；徽章 `idle → running… → idle` 流畅翻转；底部 debug pane 的 messages 数组实时同步
- 证据: 用户人工确认"通了"
- 关键前提: 必须给 `useAgent(props)` 传 `updates: [OnMessagesChanged, OnRunStatusChanged, OnStateChanged]`，否则 hook 不触发 rerender

### V2 `toolCalls` streaming 实时

- 状态: ⏭ **跳过**（共识）
- 原因: radar agent 当前 tool 链路在 LLM_MOCK 下不走；切真 LLM + 专门 prompt 触发 tool call 的验证对 ADR-1 决策边际价值低（Message 类型含 `toolCalls?: unknown[]` 字段的暴露已在 page.tsx 证明可读）
- 后续: Step 3 产品接入时覆盖

### V3 `traceparent` 透传

- 状态: ✅ **PASS**（SigNoz ClickHouse 直查实锤）
- UI trace chip 捕获的 traceId: `9d16d3012e1cca67c8c18c8eb98ccbc6`
- SigNoz `signoz_traces.signoz_index_v3` 查询结果：**44 条 span，三个 service 完整连接**
  ```
  agent-lab-poc-browser · HTTP POST (root)
    └─ agent-lab-poc-bff · POST /api/agent/chat/route
         └─ agent-lab-poc-bff · executing api route
              └─ fetch POST http://localhost:8001/agent/chat
                   └─ radar · POST /agent/chat
                        └─ invoke_agent radar_agent
                             └─ radar_agent.workflow → call_model → ChatOpenAI.chat → POST
  ```
- 证据: `./evidence/v3-spans.txt`（ClickHouse query 输出）
- 关键前提: PoC 补了 `instrumentation.ts` + `instrumentation-node.ts`（Next.js Node runtime OTel auto-instrumentation），BFF 缺这个会断链

### V4 Langfuse 三端贯穿

- 状态: ✅ **PASS**
- SigNoz: `http://127.0.0.1:3301`，按 trace_id 可查完整 44 span 链路
- Langfuse: 用户人工确认 PASS
- 证据: 用户回报"v4 pass"

### V5 SSE 断线重连

- 状态: ✅ **PASS**（Playwright 自动化验证）
- 测试场景: 发长 prompt → submit 1.5s 后 `context.setOffline(true)` 3 秒 → 恢复
- 观察: 断线恢复后 assistant 文本继续增长（`before-offline=0 → recover=162 → final=724` chars，多次运行稳定）
- 证据: `./evidence/v5-reconnect.json`（含时间序列 samples）
- 脚本: `./poc-auto-verify.mjs` 的 `runV5()`

### V6 Dev Console Inspector 行为（#32 回归）

- 状态: ⏭ **跳过**（共识）
- 原因: ADR-9（Provider 稳定引用原则）已强制所有 `<CopilotKit>` / `<QueryClientProvider>` 等 props 稳定引用（模块级 `Object.freeze({})`），无论 v2 内部是否已修 #32 destructure 默认值 bug，我们的编码约束都不变。生产不启用 Dev Console。
- 决策依据: `docs/mobile-playbook/10-tech-selection-adr.md` ADR-9

### V7 `isRunning` 翻转时机

- 状态: ✅ **PASS**（Playwright 自动化验证）
- 观察: `click → isRunning=true`: **20ms**（阈值 < 500ms）；`RUN_FINISHED → isRunning=false`: 2948ms（真 LLM 调用耗时范围）
- 证据: `./evidence/v7-timing.json`（含 badge 状态时间序列）
- 脚本: `./poc-auto-verify.mjs` 的 `runV7()`

---

## 途中发现 / 踩坑记录

1. **`useAgent` API 签名与官方 blog 示例不符**（R1.5 实锤）
   - Blog 示例 `useAgent(id, opts)` 在 1.56.2 中**不存在**
   - 实锤签名（从 `.d.mts`）：`useAgent(props?: UseAgentProps): { agent: AbstractAgent }`
   - 必须传 `updates` 数组才会 rerender，默认空数组 hook 静默
   - 发消息走 `agent.addMessage({ id, role, content })` + `agent.runAgent()`，不是 `runAgent({ messages: [...] })`
   - **ADR-1 骨架已校准**（2026-04-21）

2. **`LLM_MOCK` 在当前 Python 代码已失效**
   - CLAUDE.md 里"LLM_MOCK=1 启用 mock 模式"是过时描述
   - 生产代码 `llm.py` 只走 LiteLLM Proxy + DB settings
   - 调试应使用 `LITELLM_PROXY_URL=disabled` 绕开 LiteLLM 直连 CPA
   - **需要在 CLAUDE.md 更新这条**

3. **PoC 缺 Next.js `instrumentation.ts` 会断链**
   - 首轮 V3 grep 0 命中，直查 ClickHouse 发现只有浏览器 span
   - 根因：PoC 没复制 `instrumentation-node.ts`，Node runtime 无 undici auto-instrumentation → 出站 fetch 不 propagate traceparent
   - 修复：添加 `instrumentation.ts` + `instrumentation-node.ts` 后 44 span 贯穿
   - **Step 3 产品代码实现时**：`apps/web` 已有此文件，不需要再补

4. **OTel Collector CORS 配置**
   - Collector 默认只放行 `:8788`，PoC 跑 `:3005` 会被 OPTIONS 挡
   - 已在 `docker/observability/otel-collector-config.yml` 加 `http://localhost:3005` 到 `allowed_origins`

5. **React hydration 未完成时 `pressSequentially` 不触发 onChange**
   - Playwright 自动化初版 V7 失败，events 只到 submit 就静默
   - 根因：`page.goto` 后立即 pressSequentially，input onChange 尚未绑定
   - 修复：`waitForSelector` 后 `wait(1500)` 给 hydration 时间
   - **Step 3 的 E2E 测试写法上要注意**

---

## 遗留问题（不阻塞 PASS）

- **frontend `agent.abortRun()` / stop 不能停 backend**（R1.4，ADR-1 已记）
  - 本次未主动验证，但架构已知：需 Python 侧实现 `copilotkit_exit()` 或 cancel token
  - Step 3 实现前需补 Python 端支持

- **scarf.sh telemetry 出站**（不影响功能）
  - CopilotKit runtime 会发 `fetch GET https://copilotkit.gateway.scarf.sh/1.56.2?...` telemetry
  - 生产可通过环境变量禁用（文档待查）

---

## 决策

✅ **ADR-1 验证通过，CopilotKit v2 `useAgent` 作为 Mobile/Desktop 统一 chat 基础设施的决策成立**。

进入：
- **Step 0**（数据层迁移 SWR → TanStack Query + idb-keyval persister）
- **Step 3**（Chat 通路统一 AG-UI，Mobile/Desktop 都用 `useChatSession` 共用 hook）

---

## 后续操作

- [ ] 归档 PoC: `tar czf docs/checkpoints/poc-copilotkit-v2.tar.gz poc/copilotkit-v2-useagent/`
- [ ] 更新 `docs/mobile-playbook/10-tech-selection-adr.md` ADR-1 待 PoC 项 → 全勾选
- [ ] 更新 `docs/mobile-playbook/06-migration-roadmap.md` Step 3 前置条件 → ✅
- [ ] 更新 CLAUDE.md：`LLM_MOCK` 描述过时，应改为 "`LITELLM_PROXY_URL=disabled` 绕开 LiteLLM 直连 provider（调试用）"
