# agent-lab-radar

Radar Agent — 科技资讯策展 + 对话流。

## 目录结构

```
src/radar/
├── __init__.py
├── main.py              # FastAPI app + serve() 入口
├── cron.py              # radar-push CLI 入口
├── collectors/
│   └── hn.py            # Hacker News top stories
└── chains/
    ├── recommend.py     # HN → ItemInput (structured output)
    └── chat.py          # 流式对话链
```

公共库 `agent_lab_shared`(路径 `agents/shared`):
- `config.py` — pydantic-settings 读 `.env`
- `llm.py` — `get_llm(task)` 工厂,支持 `LLM_MOCK=1`
- `db.py` — `PlatformClient` 调 Next.js `/api/items/batch`
- `schema.py` — Pydantic 数据契约(Team A / Team B 共用,不可改)

## 环境准备

```bash
# 在仓库根
uv sync --all-packages

# 复制环境变量
cd agents/radar
cp ../../.env.example .env
# 默认 LLM_MOCK=1,零依赖可跑
```

## 启动对话流服务

```bash
cd agents/radar
uv run radar-serve
# 监听 http://127.0.0.1:8001
```

测试:

```bash
# 健康检查
curl -s http://127.0.0.1:8001/health
# => {"status":"ok"}

# SSE 对话流
curl -N -X POST http://127.0.0.1:8001/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"item":null}'
```

SSE 格式:
```
data: {"delta": "[mock"}

data: {"delta": "] 这是一"}
...
data: [DONE]
```

## 触发推送流

```bash
cd agents/radar
uv run radar-push              # 真跑:拉 HN → 推荐 → POST 到平台
uv run radar-push --dry-run    # 只打印 payload,不 POST
uv run radar-push --limit 10   # 调整 HN 拉取条数
```

`LLM_MOCK=1` 时推荐链路直接用前 3 条 HN story 构造 mock `ItemInput`;
`LLM_MOCK=0` 时走 LangChain `with_structured_output` 让 GLM 挑选并生成中文 `grade/title/summary/why/tags`。

POST 失败(Team A 平台未启动)时会打印错误但不抛异常,方便独立验证。

## 网络 / 代理

- HN (`hacker-news.firebaseio.com`) 国内需走代理。`collectors/hn.py` 会从 `HTTPS_PROXY` / `HTTP_PROXY` 读 http 代理(**避开 `ALL_PROXY=socks5`**,因为 httpx 的 socks 需要额外 `socksio` 包)。
- `PlatformClient` 调 `http://127.0.0.1:8788`,显式 `trust_env=False` 绕过代理。

## Mock vs Real LLM

| 变量 | Mock (默认) | Real |
|---|---|---|
| `LLM_MOCK` | `1` | `0` |
| `GLM_API_KEY` | 不需要 | 必填 |
| 推荐链 | 前 3 条 HN story 构造 | GLM-4-Flash structured output |
| 对话链 | 固定字符串分 chunk 输出 | GLM-4.6 astream |

## 已知注意事项

- venv 使用 Python 3.14(系统可用的最新版),`langchain-core` 会打印一条
  `Core Pydantic V1 functionality isn't compatible with Python 3.14` 的 warning,
  不影响功能。如需严格 3.12 可改 `uv python pin 3.12`。
- `with_structured_output` 依赖 LLM provider 支持;GLM-4/GLM-4-Flash 经 OpenAI 兼容层
  一般走 JSON mode,首次接真 LLM 时需验证。
