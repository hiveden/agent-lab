# 配置管理设计

> ⚠️ **部署现状（2026-04-19）**：当前**无任何 prod 部署**。BFF 的 Cloudflare Pages 工具链 + Python 的 `DEPLOY_ENV=production` 校验代码都已就绪，但从未实际部署。下文涉及"生产 / Fly.io / Cloudflare Pages URL / fly secrets" 等内容为**目标状态**，首次部署前会变动。见 [GitHub #1](https://github.com/hiveden/agent-lab/issues/1)。

## 原则

1. **零代码切换环境** — 本地 dev / staging / production 仅通过环境变量区分，不改代码
2. **生产必填项无默认值** — 忘设就启动报错，不会静默用 dev 值跑生产
3. **利用平台原生机制** — Cloudflare Pages 环境变量 + 云托管 secrets（候选 Fly.io / Railway / 自建，见 #1），不自建配置中心

## 配置层级（优先级递增）

```
1. 代码 defaults (最低)
   └─ Pydantic Settings defaults / CloudflareEnv 接口
      ⚠ 仅 dev 安全的默认值（如 LLM_MOCK=1）
      ⚠ 生产必填项无默认值，强制从环境读取

2. .env 文件 (本地 dev)
   └─ CP: apps/web/.dev.vars       (Cloudflare wrangler 本地 secrets)
   └─ DP: agents/radar/.env        (Pydantic Settings 读取)
   └─ 不进 git，.example 文件做模板

3. 平台环境变量 (生产)
   └─ CP: Cloudflare Pages Dashboard → Settings → Environment Variables
   └─ DP: fly secrets set KEY=VALUE
   └─ 覆盖一切 defaults 和 .env
```

## 变量清单

### Control Plane (Next.js / Cloudflare Pages)

| 变量 | 必填 | 来源 | 说明 |
|------|------|------|------|
| `DB` | ✅ | wrangler.toml binding | D1 数据库，本地自动创建，生产在 CF Dashboard 绑定 |
| `RADAR_WRITE_TOKEN` | ✅ | .dev.vars / CF Env | Agent 写入 API 的 Bearer token |
| `RADAR_AGENT_BASE` | ✅ | .dev.vars / CF Env | Python Agent 服务地址（dev: `http://127.0.0.1:8001`，prod: 云托管 URL，见 #1） |
| `DEFAULT_USER_ID` | — | 默认 `default_user` | MVP 单用户 ID |

### Data Plane (Python Agent — 托管候选见 #1)

| 变量 | 必填 | Dev 默认 | Prod 说明 |
|------|------|---------|----------|
| `DEPLOY_ENV` | — | `development` | 设为 `production` 触发启动校验 |
| `LLM_MOCK` | — | `1` | 生产必须设为 `0` |
| `LLM_PROVIDER` | — | `glm` | |
| `GLM_API_KEY` | 生产 ✅ | 空 | 生产 `DEPLOY_ENV=production` 时为空会报错 |
| `GLM_BASE_URL` | — | `https://open.bigmodel.cn/api/paas/v4` | |
| `LLM_MODEL_PUSH` | — | `glm-4-flash` | |
| `LLM_MODEL_CHAT` | — | `glm-4.6` | |
| `LLM_MODEL_AGENT` | — | `glm-4.6` | Agent chat 用的模型 |
| `RADAR_WRITE_TOKEN` | ✅ | `dev-radar-token-change-me` | 必须和 CP 侧一致 |
| `PLATFORM_API_BASE` | ✅ | `http://127.0.0.1:8788` | 上 prod 后设为 Cloudflare Pages URL |
| `RADAR_AGENT_PORT` | — | `8001` | |
| `HTTPS_PROXY` / `HTTP_PROXY` | — | 本地 ClashX | 云托管通常不需要代理，不设即可 |

## 环境文件

```
.env.example                    # 全量模板（文档用途）
apps/web/.dev.vars.example      # CP 本地开发变量
agents/radar/.env.example       # DP 本地开发变量
```

`.dev.vars` 和 `agents/radar/.env` 均在 `.gitignore` 中。

## 启动校验

### Python 侧

`DEPLOY_ENV=production` 时，`Settings.__init__` 后运行 `validate_production()`：
- `LLM_MOCK` 必须为 `False`
- `GLM_API_KEY` 不能为空
- `RADAR_WRITE_TOKEN` 不能是 `dev-radar-token-change-me`
- `PLATFORM_API_BASE` 不能是 `127.0.0.1`

校验失败直接 `raise ValueError`，进程不启动。

### Next.js 侧

Cloudflare Pages 如果缺少必填 binding/env，请求到达时 `getEnv()` 会在运行时抛出，通过日志发现。无需额外校验代码。

## wrangler.toml 环境

```toml
# 本地 dev（默认 wrangler dev / next dev）
[[d1_databases]]
binding = "DB"
database_name = "agent-lab-dev"
database_id = "local-placeholder"

# 生产：通过 Cloudflare Pages Dashboard 绑定 D1
# database_name = "agent-lab-prod"
# 在 Pages > Settings > Functions > D1 database bindings 配置
```

Cloudflare Pages 不读 `wrangler.toml` 的 `[env.production]`，生产 D1 绑定通过 Dashboard 配置。

## 部署 Checklist

> 📝 **目标状态文档**：以下步骤**尚未执行过任何一次**，是首次部署的参考 runbook。Fly.io 举例仅为候选之一（见 #1）。真实首次部署时以 GitHub #1 的结论为准，并回写本节校正。

### Cloudflare Pages (CP)

1. 在 Pages Dashboard 绑定 D1 production 数据库
2. Settings → Environment Variables 设置：
   - `RADAR_WRITE_TOKEN` = 生产 token
   - `RADAR_AGENT_BASE` = `https://radar.your-domain.com`
3. 运行 migration：`wrangler d1 execute agent-lab-prod --remote --file=migrations/0001_init.sql`
4. `pnpm deploy:web`

### Fly.io (DP)

```bash
fly secrets set \
  DEPLOY_ENV=production \
  LLM_MOCK=0 \
  GLM_API_KEY=your-key \
  RADAR_WRITE_TOKEN=same-as-cp \
  PLATFORM_API_BASE=https://your-pages-url.pages.dev
```
