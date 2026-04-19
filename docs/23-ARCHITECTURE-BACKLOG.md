# 23 - 架构缺口清单（Backlog）

> **创建**：2026-04-18
> **上下文**：可观测性栈（docs/22）完成后的系统性盘点。从"全栈企业级落地项目"标准看 agent-lab 仍缺的非-observability 维度。
> **定位**：**backlog**，不是技术债（现有代码没坏）也不是产品需求（不直接面向用户），而是**基础设施演进路径**。

---

## 优先级层级

- 🔴 **阻塞当前目标**：不做就卡住多用户 / 生产化
- 🟡 **企业级必备**：生产暴露前必须做
- 🟢 **LLM 专属能力**：让 LLM 部分真正生产可维护
- 🔵 **可选优化**：等触发条件再做

---

## 🔴 P0 — 阻塞当前目标

### #1 BFF + Python Agent 首次部署（双端上线）

**问题**：当前两端都只能本地跑。BFF（apps/web）虽然配好了 Cloudflare Pages 工具链（wrangler.toml + @cloudflare/next-on-pages + `pnpm deploy:web` 脚本），但**从未实际部署**。Python Agent 更是零托管。全链路只能 localhost。

**范围**（一次性打包）：
1. BFF 首次 Cloudflare Pages 部署 — 真跑一次 `pnpm deploy:web`，拿到 prod URL + D1 远端 schema + secrets（wrangler pages secret put）
2. Python Agent 部署 — 选一家云托管上线
3. 两端连通 — `PLATFORM_API_BASE` / CORS / `RADAR_WRITE_TOKEN` 等环境变量在两侧 prod 对上

**Python Agent 方案候选**：
- Fly.io（简单、便宜、go-to 选择）
- Railway（DX 最好）
- 自建 Hetzner / VPS（学运维 + 与 docker/signoz+langfuse+glitchtip 共存）
- Cloudflare Containers（beta 但与 Pages 生态一致）

**依赖**：无

**估算**：BFF 首次部署 2-4h（首次配 D1 远端 + secrets + domain） + Python Agent 4h-1d = **半天 - 1.5d**

---

### #2 CI/CD pipeline

**问题**：全手动。E2E 跑不跑靠自觉；部署靠 `pnpm deploy:web`；无自动 lint/test gate。

**方案**：GitHub Actions
- PR: lint + unit test + E2E（Playwright）
- main push: 自动部署 BFF + Python Agent
- 可选：预览部署（Cloudflare Pages + Fly.io preview）

**依赖**：#1（Agent 有部署目标才能自动化部署它）

**估算**：1-2d

---

### #3 用户 / 认证系统

**问题**：`DEFAULT_USER_ID=alex` 硬编码。单用户原型可接受，但"企业级"必须多用户化，认证是第一步。

**方案候选**：
- Clerk / Stytch（托管 auth，DX 最好）
- NextAuth / Auth.js（开源，接入 Next.js）
- 自建 JWT + bcrypt（学习价值最高）
- Better Auth（新兴开源，TS 原生）

**关联改动**：
- `chat_sessions` / `items` / `user_states` 等表加真实 user_id FK
- BFF route 加鉴权中间件
- Python Agent 接收 user context

**依赖**：无（可与 #1 #2 并行）

**估算**：2-3d

---

## 🟡 P1 — 企业级必备

### #4 LLM Gateway

**问题**：当前多 provider 切换靠 `LLM_PROVIDER` env + `base_url`（`ChatOpenAI(base_url=...)`）；成本不可见；无 fallback；无 cache。

**方案候选**：
- **LiteLLM**（开源 proxy，统一 100+ provider，功能最全）
- **Helicone**（云 + 开源 proxy，UI 好）
- **Portkey**（企业向，多 gateway feature）
- **OpenRouter**（SaaS，不是 gateway 而是中转 provider，可跳过）

**接入点**：改 `ChatOpenAI(base_url=...)` 指向 LiteLLM，LiteLLM 配真实 provider。

**收益**：
- 统一 cost 追踪（Langfuse 也能看但 gateway 更精确）
- Fallback（Ollama 挂 → 自动切 GLM）
- Prompt cache（降本）
- Rate limit（防误用）

**依赖**：无

**估算**：1d

---

### #5 Secret management

**问题**：Langfuse / GlitchTip / GLM API key 等都在 `.env` 裸奔；Cloudflare env vars 无版本控制；无轮换策略。

**方案候选**：
- **Infisical**（开源 + cloud，team friendly）
- **Doppler**（cloud only，UX 最好）
- **HashiCorp Vault**（企业标准，重）
- **1Password Secrets Automation**（简单）

**关联**：
- 代码里 `os.environ[]` / `process.env` 保留（Vault inject）
- CI/CD 从 Vault 拉 secret
- 定期轮换计划（季度）

**依赖**：无

**估算**：半天集成 + 每个 secret 单独迁

---

### #6 Rate limiting + CORS 收紧

**问题**：
- Python FastAPI `allow_origins=["*"]`（`agents/radar/src/radar/main.py:60`）
- 无请求速率限制
- BFF 也无速率限制

**方案**：
- Python：`slowapi` + 精准 CORS origins（dev localhost + prod domain）
- BFF：`@upstash/ratelimit` + Cloudflare Rate Limiting Rules
- 浏览器 → BFF CORS 同源不需要；OTel collector CORS 已精准配

**依赖**：#3（rate limit 通常按 user_id）

**估算**：半天

---

### #7 环境分离 dev/staging/prod

**问题**：
- `deploy_env=production` 字段存在但没有 prod 实例
- D1 只一个 `agent-lab-dev`
- Langfuse / SigNoz / GlitchTip 都是本地 dev

**方案**：
- Cloudflare Pages 多环境（wrangler env）+ 独立 D1 `agent-lab-staging` / `agent-lab-prod`
- Python Agent 多实例（fly.io multi-region / deploy group）
- Langfuse Cloud 重新用作 prod（自托管作为 dev 学习）
- SigNoz / GlitchTip 自托管给 prod（考虑 Fly.io Machines + managed Postgres/ClickHouse 或 DigitalOcean Droplet）

**依赖**：#1 #2

**估算**：1d 配 + 持续调整

---

## 🟢 P2 — LLM 专属能力

### #8 Eval pipeline (Langfuse LLM-as-judge)

**问题**：Radar `evaluate` tool 推送的"fire/bolt/bulb"评分靠 LLM 主观，无客观度量。每次 prompt/model 改动，质量回归靠人工抽查。

**方案**：
- Langfuse Datasets：记录 historical evaluate 结果 + 人工 ground truth（"这条推荐我点了 / 没点"）
- Langfuse Evaluators：LLM-as-judge 批量跑 offline 评估（新 prompt vs baseline）
- Langfuse Experiments：A/B prompt 版本对比
- 独立 environment=eval，trace 与生产隔离

**依赖**：#9（Prompt 版本化）更配套

**估算**：2-3d（含 dataset 建设）

---

### #9 Prompt version control (Langfuse Prompt Management)

**问题**：prompt 散落在 `agents/radar/src/radar/pipelines/evaluate.py` / `agents/radar/src/radar/agent.py` 等文件，每次改动要发版；无 A/B；无热更新。

**方案**：Langfuse Prompt Management
- 把 system prompt / 工具描述 / 评判 prompt 迁到 Langfuse UI
- 代码用 `langfuse.get_prompt("evaluate-radar", version="latest")`
- 支持 `label="production"` / `label="staging"`
- 改 prompt → Langfuse UI 保存 → 下一次 request 自动用新版

**依赖**：无（自托管 Langfuse 已 ready）

**估算**：1d

---

## 🔵 P3 — 可选优化

### #10 RAG 基础设施

**触发条件**：Radar 要做"找类似内容" / "基于历史推荐"

**方案候选**：
- **pgvector**（最简单，加到现有 Postgres）
- **Qdrant**（专用 vector DB，开源自托管）
- **Cloudflare Vectorize**（与 Pages 同生态，serverless）
- **Weaviate / Chroma**（其他选择）

**估算**：2-3d

---

### 其他小块（没独立条目，按需做）

- **Feature flags**（LaunchDarkly / Unleash / 自建）— prompt 灰度 / agent 行为 A/B
- **LLM response caching**（prompt hash → response），可直接走 LiteLLM built-in
- **Infrastructure as Code**（Terraform / Pulumi）— 等自托管栈稳定后做
- **Audit log**（谁在什么时候改了什么）— 多用户后必要
- **Content moderation / PII 脱敏**（输入输出过滤）— 对外开放前必要
- **Chaos testing**（Chaos Monkey / Gremlin）— 生产稳定后
- **Product analytics**（PostHog / Mixpanel）— 有真实用户后
- **Visual regression test**（Percy / Chromatic）— UI 团队扩大后
- **Runbook**（on-call 手册）— 真有 on-call 后
- **ADR 目录**（Architecture Decision Records）— 当前散落在 docs/ 各文件，未来抽独立 `docs/adr/` 目录

---

## 推荐启动路径

**最短路径到"可 demo 的企业级"（~5-7d）：**

```
1. #3 用户/认证        (2-3d)  ← 解锁多用户
2. #1 Python Agent 部署  (4h-1d)  ← 脱离本地
3. #2 CI/CD            (1-2d)  ← 自动化
4. #4 LLM Gateway       (1d)   ← 成本可见 + provider HA
5. #8 Eval pipeline     (2-3d) ← 模型质量可度量
```

剩下 #5/#6/#7/#9/#10 按触发条件推进。

---

## 维护约定

- 条目完成后：加 ✅ + commit hash + 实际工作量，不删除（保留设计演进）
- 有新缺口发现：追加到对应优先级区块
- 每 milestone 结束回顾一次，调整优先级
