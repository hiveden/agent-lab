# LiteLLM Proxy (agent-lab LLM Gateway)

> **定位**：多 provider 统一 OpenAI-compatible 网关。Python Agent 所有 LLM 调用走这里。
> **职责**：provider 路由 / cost 追踪（经 Langfuse callback）/ 重试 / fallback 预留。
> **文档**：[`docs/22-OBSERVABILITY-ENTERPRISE.md` ADR-012](../../docs/22-OBSERVABILITY-ENTERPRISE.md)（待写）

---

## 启动

```bash
cd docker/litellm
docker compose up -d
# 验证
curl http://localhost:4000/health/liveness
curl -H "Authorization: Bearer sk-litellm-master-dev" http://localhost:4000/v1/models | jq
```

## 端口

| 端口 | 用途 |
|---|---|
| **4000** | OpenAI-compatible API（`/v1/chat/completions` / `/v1/embeddings` / `/v1/models`） |

## 环境变量（`docker-compose.yml` 读取）

| 变量 | 必填 | 说明 |
|---|---|---|
| `LITELLM_MASTER_KEY` | — | 客户端鉴权 key（默认 dev 值，prod 必改） |
| `ANTHROPIC_API_KEY` | 用 Claude 时 | Anthropic 真实 key |
| `OPENAI_API_KEY` | 用 GPT 时 | OpenAI 真实 key |
| `GEMINI_API_KEY` | 用 Gemini 时 | Google AI Studio key |
| `GLM_API_KEY` | 用 GLM 时 | 智谱 key |
| `OLLAMA_API_BASE` | — | 默认 `http://host.docker.internal:11434` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` | — | cost callback 推 Langfuse |

## 客户端用法（Python）

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(
    model="anthropic/claude-sonnet-4-6",  # LiteLLM 路由名
    base_url="http://localhost:4000/v1",
    api_key="sk-litellm-master-dev",
)
```

## 对比直连

| 指标 | 直连各 provider | 走 LiteLLM |
|---|---|---|
| Provider 切换 | 改 `base_url` + `api_key` | 改 `model` name |
| Cost 追踪 | 各 provider 各自方式 | 统一 LiteLLM → Langfuse callback |
| 重试 / fallback | 自己写 | LiteLLM 内置 |
| 本地 Ollama | 直连 | 走 LiteLLM 多一跳（容器 → host） |

## 已知折中

- **本地 Ollama 多一跳延迟** → 单用户容忍（<1ms）
- **LiteLLM 进程挂了全链路中断** → 配 healthcheck，失败自动 restart

## 关联

- `agents/shared/src/agent_lab_shared/llm.py` — 消费端
- `apps/web/src/app/api/settings` — UI 配置（provider / model 下拉 = 上面 `model_name` 列表）
