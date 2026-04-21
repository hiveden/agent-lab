# Phase D · 人工验证操作手册

> Phase C 已完成整合，本文档是**你操作**的具体步骤。
> 目的：完成 V1-V7 七项验证，填 `VERDICT.md`。

---

## 0 · 前置准备（~10 min）

### 0.1 启动依赖

```bash
# Terminal 1 · Python Agent Server
cd /Users/xuelin/projects/agent-lab
LLM_MOCK=1 uv run --package agent-lab-radar radar-serve
#   → http://localhost:8001
#   → 日志: /tmp/radar-dev*.log
#   LLM_MOCK=1 先走 mock 验证 V1/V2/V3/V5/V7
#   V4（Langfuse 真实 LLM trace）再切掉 LLM_MOCK=1 并修 LiteLLM
```

```bash
# Terminal 2 · 观测栈（已跑可跳过）
cd /Users/xuelin/projects/agent-lab
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'signoz|langfuse|collector|glitchtip'
# 若没跑: bash docker/start-all.sh
```

```bash
# Terminal 3 · PoC dev server
cd /Users/xuelin/projects/agent-lab/poc/copilotkit-v2-useagent
pnpm dev
#   → http://127.0.0.1:3005
```

### 0.2 确认 UI 可访问

浏览器打开 `http://127.0.0.1:3005`：
- 看到标题 "CopilotKit v2 · useAgent PoC" + "idle" 徽章
- 看到输入框和 Send 按钮
- 看到底部的 "live state" debug pane（含 `messages: []` / `isRunning: false` / `toolCalls: []`）

### 0.3 准备 evidence 目录

```bash
mkdir -p /Users/xuelin/projects/agent-lab/poc/copilotkit-v2-useagent/evidence
```

---

## V1 · 流式更新（~15 min）

**目的**：验证 `useAgent().messages` 在 SSE 流式到达时实时更新，而非一次性到齐。

### 步骤

1. 打开 Chrome DevTools → Console
2. 打开 Chrome DevTools → Network → 筛 "chat"
3. 在 PoC UI 输入：`列出 HN 上最火的 3 条内容`，按 Send
4. 观察：
   - **顶部徽章** 应从 `idle` → `running…` → `idle`
   - **消息列表** 应有一条 user 消息 + 一条 assistant 消息
   - **assistant 消息的 content** 应**逐步增长**（不是一次到齐）
   - **debug pane 的 messages 数组** 应同步增长
5. Network tab 看 `/api/agent/chat` 请求的 Response → 选 EventStream 标签，应看到多条 AG-UI event（TEXT_MESSAGE_CONTENT 应有多条）

### 证据
- Chrome DevTools Network 面板截图 → `evidence/v1-network.png`
- 屏幕录像（3-5s 显示文字流式出现）→ `evidence/v1-stream.mp4`（可选）

### PASS 标准
- assistant 消息 content **可见到逐字/逐段增长**
- Network EventStream 看到至少 3 条 `TEXT_MESSAGE_CONTENT` 或等价 event

**填 VERDICT V1**

---

## V2 · `toolCalls` streaming 实时（~15 min）

**目的**：验证 tool call 在 streaming 中实时可见（非仅 END 后）。

### 前置
Radar 的 LangGraph 默认有 tools（如 `search_items`）。若 `LLM_MOCK=1` 不触发 tool，请临时切到真实 LLM：
```bash
# Terminal 1 (改 env 后重启)
unset LLM_MOCK
uv run --package agent-lab-radar radar-serve
```

### 步骤
1. 在 PoC UI 输入一个会触发 tool 的 prompt，例如：`搜索 inbox 里关于 AI 的 item`
2. 观察 debug pane 的 `toolCalls` 字段：
   - 应在 assistant "thinking" 阶段就**出现**（不是等 run 结束才出现）
   - Network EventStream 里应见到 `TOOL_CALL_START` / `TOOL_CALL_ARGS`（多条，args 增量） / `TOOL_CALL_END`

### 证据
- debug pane 截图（显示 toolCalls 在 running 中就非空）→ `evidence/v2-state.png`
- Network EventStream 截图（显示多条 TOOL_CALL_ARGS）→ `evidence/v2-network.png`

### PASS 标准
- `toolCalls` 在 `isRunning: true` 阶段就**已更新**
- SSE 里 `TOOL_CALL_ARGS` ≥ 2 条

**PARTIAL 允许**：若 args 只在 END 后整块出现（不是 delta），记为 ⚠ 并在 VERDICT 注明"args 非增量"。

**填 VERDICT V2**

---

## V3 · `traceparent` 透传（~20 min）

**目的**：浏览器 OTel 生成 traceparent → BFF → Python 同 trace_id。

### 步骤
1. 在 PoC UI 发送一条消息
2. 观察 PoC 顶部出现的 **trace chip**（绿色圆角徽章，显示 `trace xxxxxxxx…`）
3. 点击 chip → trace_id 复制到剪贴板
4. 在 Terminal 执行：
   ```bash
   TRACE_ID="<刚复制的完整 trace_id，32 位 hex>"
   grep -l "$TRACE_ID" /tmp/radar-dev*.log
   grep "$TRACE_ID" /tmp/radar-dev*.log | head -3
   ```
5. 期望能在 Python structlog 输出里命中同一个 trace_id

### 证据
- trace chip 截图 → `evidence/v3-browser-chip.png`
- `grep` 输出重定向 → `evidence/v3-python-grep.txt`

### PASS 标准
- 浏览器 chip 显示的 trace_id 在 Python 日志中**出现** ≥ 1 次

### FAIL 处理
- 若 Python 日志没命中 → 打开 BFF `/tmp/` 下或项目 `apps/web` dev server 日志看 BFF 是否接到 traceparent。可能是 Node OTel auto-propagation 在 PoC Node runtime 缺失（对 PoC 这是**已知**，生产 apps/web 里已配 `instrumentation-node.ts`）。
- 若只 BFF 命中 Python 不命中 → Python 侧 FastAPIInstrumentor 未生效，检查 `agents/radar/src/radar/main.py` 的 `FastAPIInstrumentor.instrument_app` 是否跑到

**填 VERDICT V3**

---

## V4 · Langfuse 三端贯穿（~15 min）

**目的**：同 trace_id 在 Langfuse（LLM trace）和 SigNoz（全链路 span）都能查到。

### 前置
- **必须跑真 LLM**（关闭 `LLM_MOCK`），Langfuse 才有 LLM trace 可看
- 若 LiteLLM unhealthy，先修或临时直连 provider：`LITELLM_PROXY_URL=disabled` + 配置 provider key

### 步骤
1. 确认 LiteLLM 或直连可用（发一条测试消息 UI 能看到回复内容）
2. PoC UI 发送一条消息 → 拿 trace_id（V3 方式）
3. 打开 Langfuse: `http://localhost:3010`
   - 登录（第一次 register）
   - 进 Traces 页，搜索框贴 trace_id → 应找到一条 trace，含 LLM generations
4. 打开 SigNoz: `http://localhost:3301`
   - 进 Traces 页，Trace ID search 贴 trace_id → 应找到一条 trace，含前端 fetch span + BFF span + Python span

### 证据
- Langfuse trace 页截图 → `evidence/v4-langfuse.png`
- SigNoz trace 页截图 → `evidence/v4-signoz.png`

### PASS 标准
- Langfuse 和 SigNoz **都能按同 trace_id 查到**
- SigNoz 的 trace 里能看到**至少 2 个服务**的 span（浏览器 + Python，或 BFF + Python）

**填 VERDICT V4**

---

## V5 · SSE 断线重连（~15 min）

**目的**：网络短暂断开后 UI 能否恢复接收。

### 步骤
1. PoC UI 输入一个**长 prompt**（让回复足够长，> 10s），按 Send
2. 在消息流式过程中，Chrome DevTools → Network → 勾选 **Offline**
3. 等待 3 秒
4. 取消 Offline
5. 观察：
   - 原来的消息流是否**自动恢复**继续接收
   - 或者 UI 显示错误 / 停在断线时的状态

### 备选测试
- 切后台（Cmd+Tab）30s 后回来

### 证据
- 录屏 → `evidence/v5-reconnect.mp4`（或多张截图序列）

### PASS 标准
- 断线 3s 恢复后 UI 继续收到后续 token，最终 run 正常结束

### PARTIAL
- 断线后 run 结束但没 error，用户重发即可 → 记 ⚠ 并在 VERDICT 注明"无自动重连"

**填 VERDICT V5**

---

## V6 · Dev Console #32 回归（~15 min）

**目的**：验证 v2 是否仍需 `EMPTY_OBJ` 稳定引用 hack。

### 步骤

**场景 A**：目前已有稳定引用
1. 打开 PoC UI
2. 打开 Dev Console（CopilotKit 右下角浮窗）→ Agents tab
3. 发送一条消息
4. 观察 Inspector 里 messages 是否持续可见

**场景 B**：移除稳定引用（故意制造 #32 条件）
1. 临时修改 `app/providers.tsx`：
   ```tsx
   <CopilotKit
     runtimeUrl={RUNTIME_URL}
     // headers={EMPTY_HEADERS}       ← 注释
     // properties={EMPTY_PROPERTIES}  ← 注释
   >
   ```
2. 保存，Next.js 热重载
3. 刷新 PoC UI，发送消息
4. 观察 Inspector 行为是否与场景 A 不同（清空 / 消失）
5. **测试完立刻恢复**稳定引用注释（别留坑）

### 证据
- 场景 A 截图 → `evidence/v6a-inspector-stable.png`
- 场景 B 截图 → `evidence/v6b-inspector-unstable.png`

### PASS 标准
- 场景 A 正常：Inspector 显示 messages
- 场景 B 复现 #32 症状（messages 清空）→ 说明 v2 **仍有** destructure 默认值坑，需保留 EMPTY_OBJ workaround
- 场景 B 正常显示 → v2 已修 #32，workaround 可选

**两种结果都是有效产出**。填 VERDICT 说明结论即可。

**填 VERDICT V6**

---

## V7 · `isRunning` 翻转时机（~10 min）

**目的**：`isRunning` 状态与 AG-UI event 的时序对齐。

### 步骤
1. 在 `app/page.tsx` 页面顶部加一个 `useEffect` 打印时序（**仅测试时临时加**）：
   ```tsx
   useEffect(() => {
     console.log(`[${performance.now().toFixed(0)}ms] isRunning=${isRunning}`);
   }, [isRunning]);
   ```
2. Console 清空
3. 发送一条消息，观察 console 输出
4. 对照 Network EventStream 的 RUN_STARTED / RUN_FINISHED 时间戳

### 证据
- Console 输出 → `evidence/v7-timing.log`
- Network SSE 截图对照 → `evidence/v7-sse.png`

### PASS 标准
- `isRunning=true` 在 RUN_STARTED event 后 ≤ 100ms
- `isRunning=false` 在 RUN_FINISHED event 后 ≤ 100ms

**测完去掉 console.log**。

**填 VERDICT V7**

---

## 收尾（~10 min）

1. 填完 `VERDICT.md` 所有字段
2. 若 ≥ 6/7 PASS：
   ```bash
   cd /Users/xuelin/projects/agent-lab
   tar czf docs/checkpoints/poc-copilotkit-v2.tar.gz poc/copilotkit-v2-useagent/
   ```
3. 回报给 Claude Code：让我更新 ADR-1 的勾选项 + `06-migration-roadmap.md` 的 Step 3 前置 → ✅
4. 停掉 PoC dev server（`Ctrl+C` Terminal 3）

---

## 常见坑速查

| 症状 | 原因 | 处理 |
|---|---|---|
| PoC UI 打不开（ERR_EMPTY_RESPONSE） | ClashX 代理拦截 localhost | 浏览器代理设置 bypass `localhost,127.0.0.1` |
| Send 后一直 "Running…" 无响应 | Python radar-serve 没起 | Terminal 1 跑 `radar-serve` |
| trace chip 不出现 | OTel Collector 没跑 | `docker ps` 检查，必要时 `bash docker/observability/start.sh` |
| Collector OPTIONS 403 | CORS 没生效 | 已在 Phase C 加 `:3005`，若变其他端口需再改 `docker/observability/otel-collector-config.yml` 并 `docker compose restart` |
| Langfuse 搜 trace_id 无结果 | LLM 走了 mock 没推 generation | 关 `LLM_MOCK=1`，用真 LLM |
| Inspector 不显示 | CopilotKit DevConsole 未启用 | `app/providers.tsx` 加 `showDevConsole={true}` |

---

## 估时

| 块 | 分钟 |
|---|---|
| 0 前置 | 10 |
| V1 | 15 |
| V2 | 15 |
| V3 | 20 |
| V4 | 15 |
| V5 | 15 |
| V6 | 15 |
| V7 | 10 |
| 收尾 | 10 |
| **合计** | **~2 h** |
