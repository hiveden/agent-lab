# ARCHITECTURE: Radar 系统架构

> **定位**: 单用户多设备、重度数据追踪的 Agent 系统。
> **原则**: 控制面与数据面严格解耦；Ingestion 与 Intelligence 两阶段分离。

---

## 一、核心架构图

```text
=====================================================================================
                          1. Client Layer (前端展现层)
=====================================================================================
    📱 Mobile (响应式)                               💻 Web Desktop
 Tab Bar / 卡片滑动 / 全屏对话                     NavRail / 三栏布局 / Trace 监控
 停留时长追踪 (Visibility API)                      键盘导航 / Command Palette
          |                                               |
          +-----------------------+-----------------------+
                                  |
                   HTTP / SSE (Vercel AI SDK)
                                  |
                                  v
=====================================================================================
                         2. Control Plane (核心编排层)
=====================================================================================
                          [ Next.js 15 App Router (BFF) ]
                                  |
          +-----------+-----------+-----------+-----------+
          |           |           |           |           |
    [ API Routes ]  [ Sources ]  [ Settings ] [ Attention ]
    /api/items      /api/sources /api/settings /api/attention
    /api/raw-items  /api/runs    (AES-GCM)    /snapshot
    /api/chat       /api/cron/*
          |
          | REST API (Bearer auth)
          v
=====================================================================================
                         3. Data Plane (智能体算力层)
=====================================================================================
                          [ Python FastAPI (无状态) ]
                                  |
    +------------+----------------+----------------+
    |            |                |                |
[ Collectors ] [ Pipelines ]  [ Chains ]     [ Endpoints ]
  ├─ HN         ├─ ingest.py   ├─ recommend   /ingest
  ├─ HTTP(通用)  └─ evaluate.py └─ chat        /evaluate
  ├─ RSS                                       /test-collect
  └─ Grok(X)                                   /source-types
                                               /v1/chat/completions
          |
          v
=====================================================================================
                         4. Data Storage (持久化层)
=====================================================================================
                             [ Drizzle ORM ]
                                  |
                       [ Cloudflare D1 (SQLite) ]
                                  |
    +----------+----------+----------+----------+----------+
    |          |          |          |          |          |
 sources   raw_items    items    user_states  runs     llm_settings
 (配置)    (原始内容)  (评判后)   (行为追踪)  (执行记录) (LLM配置)
           +run_id     +grade    +dwell_ms              +加密API key
=====================================================================================

* 外部触发: ⏰ Cron Triggers → /api/cron/radar/ingest → /api/cron/radar/evaluate
* 配置优先级: env var > DB (测试环境覆盖生产)
```

---

## 二、数据流

### 1. Ingestion（采集）— 配置驱动，多 Collector

```text
sources 表 (D1)
   | CP 读 enabled sources
   v
POST Python /ingest {sources: [{id, source_type, config}]}
   |
   v (按 source_type 分发)
┌──────────────────────────────────────────┐
│ Collector Registry                       │
│  hacker-news → HNCollector (HN API)     │
│  http        → HttpCollector (通用 JSON) │
│  rss         → RssCollector (feedparser) │
│  grok        → GrokCollector (x_search)  │
└──────────────────────────────────────────┘
   |
   v
POST /api/raw-items/batch → D1 raw_items (run_id 关联)
POST /api/runs            → D1 runs (stats + trace)
```

### 2. Intelligence（评判）— LLM 筛选

```text
POST Python /evaluate
   |
   v
GET /api/raw-items?status=pending
   |
   v
LLM 评分筛选 (mock / GLM / Ollama / Gemini / Anthropic)
   |
   v
POST /api/items/batch     → D1 items (promoted)
PATCH /api/raw-items/status → D1 raw_items (promoted/rejected)
```

### 3. 隐式追踪

```text
用户点击 item → 自动 PATCH status=watching
停留计时 (Visibility API) → 离开时 sendBeacon dwell_ms
发送 chat 消息 → 自动升级 status=discussed
```

### 4. 认知镜像

```text
GET /api/attention/snapshot
   |
   v
按 source 聚合: consumed×1 + watching×2 + chat_rounds×3
   |
   v
actual_weight vs expected_weight (sources.attention_weight)
   |
   v
偏差可视化 (AttentionView)
```

---

## 三、Collector 统一接口

```python
class Collector(Protocol):
    async def collect(self, config: dict) -> list[RawCollectorItem]

RawCollectorItem = {external_id, title, url, raw_payload}
```

| Collector | 采集方式 | 需要 API Key |
|-----------|---------|-------------|
| HNCollector | HN Firebase API | 否 |
| HttpCollector | 通用 REST API (config: url + mapping) | 按需 |
| RssCollector | RSS/Atom feed (feedparser) | 否 |
| GrokCollector | Grok API x_search (Twitter/X) | 是 (GROK_API_KEY) |

新增 collector: 实现 Protocol → 注册到 `collectors/base.py` registry → 用户在 Sources UI 配置即可使用。

---

## 四、配置管理

```
读取优先级: env var > DB > defaults

测试环境: .env 文件 (agents/radar/.env)
生产环境: D1 llm_settings 表 (API key 用 AES-256-GCM 加密)
          Cloudflare Pages env vars / Fly.io secrets
```
