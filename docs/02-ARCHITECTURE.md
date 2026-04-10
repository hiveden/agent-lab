# ARCHITECTURE: Radar 系统架构

> **定位**: 单用户多设备、重度数据追踪的 Agent 系统。
> **原则**: 控制面与数据面严格解耦。

---

## 一、 核心架构图 (Core Architecture)

系统整体分为四层，通过明确的边界分离了 UI 渲染、状态调度、重度计算与持久化存储。

```text
=====================================================================================
                          1. Client Layer (前端展现层)
=====================================================================================
    📱 Mobile PWA                                  💻 Web Desktop
 (流式卡片 / 注意力追踪)                           (多栏指挥中心 / Trace 监控)
          |                                               |
          |                                               |
          +-----------------------+-----------------------+
                                  |
                   HTTP / SSE (Vercel AI SDK)
                                  |
                                  v
=====================================================================================
                         2. Control Plane (核心编排层)
=====================================================================================
                          [ Next.js App Router (BFF) ]
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
  [ API Routes ]          [ State Management ]        [ Auth & Guard ]
 (/api/items, /api/chat)   (Vercel AI SDK)
          |
          | REST API / Context
          v
=====================================================================================
                         3. Data Plane (智能体算力层)
=====================================================================================
                          [ Python Engine (FastAPI) ]
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
   [ Scraper Engine ]   [ RAG & Context Builder ]    [ LLM Router ]
 (HN, RSS, Twitter)                               (GLM-4 / GLM-4-Flash)
          |
          |
          | (Data Processing & AI Inference)
          |
          v
=====================================================================================
                         4. Data Storage (持久化层)
=====================================================================================
                             [ Drizzle ORM ]
                                  |
                                  v
                       [ Cloudflare D1 (SQLite) ]
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
      [ sources ]             [ items ]           [ user_states & chats ]
     (基线配置)             (物料/文章)             (行为日志 / 对话记录)
=====================================================================================

* 外部触发: ⏰ Cron Triggers (Cloudflare Workers) -> Invoke API Routes -> Wake up Python Engine
```

### 架构说明
- **Client (前端展现层)**
  - **Mobile PWA**: 流式卡片分发、毫秒级注意力追踪、沉浸式对话框。
  - **Web Desktop**: 多栏指挥中心、基线配置、全链路 Trace 监控。
- **Control Plane (核心编排层 - Next.js)**
  - **职责**: 路由、鉴权、数据库 CRUD (Drizzle ORM)、状态机跃迁控制、Vercel AI SDK 对话流转流。掌握所有持久化状态。
- **Data Plane (智能体算力层 - Python)**
  - **职责**: 无状态执行节点。被动唤醒 -> 执行爬虫/大模型推理 -> 结果与日志推至 Control Plane 落库。执行完毕即销毁。
- **Data Storage (持久化层 - Cloudflare D1)**
  - **核心实体**: `sources` (基线)、`items` (物料)、`user_states` (高保真行为日志)、`runs` (执行快照)、`chat_messages` (对话历史)。

---

## 二、 核心业务流转 (Business Workflows)

### 1. 信息摄取与白盒化 (Ingestion)
*目标：Agent 抓取并过滤，全程留痕。*

```text
[⏰ Cron]
   | (触发)
   v
[Next.js API: /api/cron/radar]
   | (唤醒)
   v
[Python Agent] === (1. 抓取) ===> [外部信息源: HN/RSS]
   | 
   +============= (2. 评分) ===> [LLM: GLM-4-Flash]
   |
   | (3. 推送 Items & Trace)
   v
[Next.js API: /api/items/batch]
   | (写入)
   v
[D1: items & runs]
```

### 2. 移动端隐式捕获 (Implicit Tracking)
*目标：无感记录真实注意力消耗。*

```text
[🧑 User] ---> (点击卡片) ---> [Mobile Client]
                                  |
                                  | (状态: unread -> viewing)
                                  v
                            [Visibility API (计时器)]
                                  |
                                  | (切后台/卸载时暂停)
                                  v
                             [Mobile Client]
                                  |
                                  | (sendBeacon: PATCH /api/items/[id]/state)
                                  v
                           [Next.js API]
                                  |
                                  | (更新状态与累计时长)
                                  v
                        [D1: user_states]
```

### 3. 周度认知反思 (Cognitive Mirror Reflection)
*目标：对比“理想设定”与“真实消耗”，生成反思报告。*

```text
[⏰ Weekly Cron]
   | (唤醒反思任务)
   v
[Python Agent]
   | (GET 聚合数据)
   v
[Next.js API] === (查询基线 vs 实际消耗) ===> [D1: sources & user_states]
   |
   | (返回偏差数据集)
   v
[Python Agent] === (生成分析报告) ===> [LLM]
   |
   | (POST Markdown 报告)
   v
[Next.js API: Report]
   | (落库)
   v
[D1]
```

### 4. 深度追问与流式响应 (Chat Interaction)
*目标：移动端碎片化提问，状态升级，流式渲染。*

```text
[Mobile Client (Vercel AI SDK)]
   |
   | (发送首条消息)
   v
[Next.js BFF: /api/chat] === (强升 status 为 discussing) ===> [D1: user_states]
   |
   +======================== (提取原文与历史组装上下文) ===> [D1: items & chats]
   |
   | (转发完整上下文)
   v
[Python Agent] === (LLM 推理) ===> [LLM: GLM-4]
   |
   | (SSE 流式返回 OpenAI 格式)
   v
[Next.js BFF: /api/chat] - - - (Vercel AI SDK 透传流) - - -> [Mobile Client]
   |
   | (接收到 [DONE] 信号后)
   v
[D1: chat_messages (onFinish 落库)]
```
