# Checkpoint · PoC CopilotKit v2 useAgent

- **日期**: 2026-04-21
- **源码位置**: `poc/copilotkit-v2-useagent/`（已入 git，可作后续参考）
- **本地归档**: `docs/checkpoints/poc-copilotkit-v2.tar.gz`（377KB，未入 git；源码已在 repo 中，tar 为额外快照，可选择删除）
- **关联 ADR**: `docs/mobile-playbook/10-tech-selection-adr.md` ADR-1
- **关联 Plan**: `docs/mobile-playbook/11-poc-copilotkit-v2.md`

## 结论

✅ **PASS 6/7 + 2 共识跳过 + 0 FAIL** → ADR-1 决策成立。

| # | 验收点 | 状态 |
|---|---|---|
| V1 | 流式更新 | ✅ PASS（人工） |
| V2 | toolCalls streaming | ⏭ 跳过（共识） |
| V3 | traceparent 透传 | ✅ PASS（SigNoz ClickHouse 44 span 三端贯穿） |
| V4 | Langfuse + SigNoz 贯穿 | ✅ PASS |
| V5 | SSE 断线重连 | ✅ PASS（Playwright 自动化） |
| V6 | Dev Console #32 回归 | ⏭ 跳过（共识，ADR-9 覆盖） |
| V7 | isRunning 时机 | ✅ PASS（click→running=20ms） |

## 实锤发现（已回写生产文档）

1. `useAgent(props?)` 单参数签名（非 blog 示例的 `useAgent(id, opts)`）→ ADR-1 骨架校准
2. `LLM_MOCK` 在 Python `llm.py` 已失效 → CLAUDE.md 已更新
3. PoC 自带 BFF runtime 必须加 `instrumentation.ts` + `instrumentation-node.ts` → Step 3 注意点
4. OTel Collector CORS 需要为非 :8788 源显式放行 → `docker/observability/otel-collector-config.yml` 已加 :3005
5. Playwright 自动化 `pressSequentially` 前需等 React hydration（~1500ms）

## 恢复 PoC

```bash
cd /Users/xuelin/projects/agent-lab
tar xzf docs/checkpoints/poc-copilotkit-v2.tar.gz
cd poc/copilotkit-v2-useagent
pnpm install --ignore-workspace
# 启动 Python: LITELLM_PROXY_URL=disabled uv run --package agent-lab-radar radar-serve
# 启动 PoC: OTEL_SERVICE_NAME=agent-lab-poc-bff pnpm dev
# 访问: http://127.0.0.1:3005
```
