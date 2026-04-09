# agent-lab

Personal AI agent platform — learning LangChain + self-built agent architecture.

## Stack

- **Frontend**: Next.js on Cloudflare Pages + D1
- **Agents**: Python 3.12 + uv + LangChain on Fly.io
- **LLM**: GLM (主力), 预留反代切换能力

## Structure

```
agent-lab/
├── apps/web/          Next.js + API + D1
├── agents/
│   ├── shared/        llm / db / schema 公共库
│   └── radar/         Radar Agent (MVP)
├── packages/types/    前后端共享类型
└── scripts/           一次性任务 / 迁移
```

## Status

MVP in progress — see [ROADMAP.md](./ROADMAP.md).
