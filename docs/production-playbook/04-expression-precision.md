# 04. 技术能力陈述的精度分级与范本

> **定位**：这是一套**描述自己技术能力**的精度标准。适用于简历、技术博客、内部 review、对外技术沟通等场景。
> **原则**：表达的精度和真实掌握深度匹配——宁可说少，不要说虚。

---

## L1-L6 陈述对比（同一话题）

以"LLM trace 怎么做"为例，看不同级别的陈述差异：

### L1 — AI 能独立完成的部分
> "我用了 Langfuse Cloud，注册账号接入就行。"

**陈述效果**：
- 听者能得到的信息量接近零
- 没什么可追问的
- 价值 ≈ 0

### L2 — 本地跑通过但没沉淀
> "我本地用 Docker Compose 起了一套 Langfuse v3，接 LangChain callback，可以看到每次 LLM 调用的 input/output/token 成本。"

**陈述效果**：
- 一经追问"生产呢？遇到过什么问题？"就暴露只有本地经验
- 价值：低

### L3 — 做过取舍判断
> "我对比过 Langfuse Cloud 和自托管的取舍。单用户项目 Cloud 免费额度够；数据敏感或成本紧的情况下自托管更合适。我的项目做了混合：本地自托管用于开发，生产走 Cloud。"

**陈述效果**：
- 体现出有思考过设计决策
- 可以追问具体取舍维度
- 价值：中

### L4 — 真实运行时间背书
> "我自托管了 Langfuse v3 在生产跑了 4 个月，大约 2 万条 LLM trace。期间升级过 3 次版本，其中 v3.38 → v3.42 的 ClickHouse schema migration 有坑，追到 upstream issue #5xxx，临时回滚用了 X 方案。另外配了每日 rclone 备份到 Cloudflare R2，做过一次恢复演练。"

**陈述效果**：
- 内容可以支撑 15 分钟深入讨论
- 每一个细节都有对应的 commit / issue / 日志可核验
- 价值：高

### L5 — 真实事故
> "有一次凌晨 Langfuse ClickHouse 容器 OOM restart 死循环。Grafana 看到磁盘 97% 满，是 trace 数据累积 + TTL 配置没生效（TTL 要显式设置在 MergeTree 的 PARTITION BY 上，默认不会回收）。临时手动 DROP PARTITION 释放空间，永久 fix 是 ALTER TABLE 加 TTL。MTTR 42 分钟，复盘在 GitHub 上有记录。这之后我把所有 ClickHouse 表都加了容量告警，阈值 80% 触发。"

**陈述效果**：
- 包含具体现象、根因、临时方案、永久方案、改进闭环
- 所有细节都是真实运维过才能说出来的
- 价值：极高

### L6 — 元认知 + 地图 + 承认未知
> "LLM observability 领域我的认知地图：
>
> **做过**：Langfuse 自托管 v3 运维 4 月、OTel Collector 自定义 processor、LangChain callback 深度集成
>
> **读过没实操**：LangSmith 文档读过知道和 Langfuse trace schema 的差异，没实际对比；Arize Phoenix 读过一篇 blog 知道偏 eval 方向
>
> **只听过名字**：Helicone、Lunary、OpenLLMetry
>
> **承认盲区**：这领域快速演化，2025-2026 可能有我完全没听过的新玩家；大厂内部工具我不可能接触；RAG 专属 observability 是不是有更专门的方案我没关注
>
> 要做选型我会先 landscape scan 再给方案——做过的东西有信心，没做过的诚实说没做过。"

**陈述效果**：
- 展示了跨技术的地图感，而不是单点深度
- 边界清晰，不浮夸也不装谦虚
- 资深岗位评估时这种表达更有说服力

**L6 陈述的关键特征**：
- **具体动词**：做过 / 读过 / 听过 / 没接触（不用"熟悉"/"了解"）
- **分层清晰**：三层认知地图都点名
- **承认未知**：明确说出盲区
- **有后续动作**：不是说完就完，配套方法论（landscape scan 等）

---

## L4-L5 陈述的共同特征

能通过 L4-L5 精度测试的陈述，共有六点：

1. **具体时间跨度**："运维 4 个月"、"2 万条 trace"
2. **具体数字**："MTTR 42 分钟"、"磁盘 97% 满"
3. **具体工具/命令**："rclone 备份到 R2"、"DROP PARTITION"
4. **upstream 追踪**："追到 issue #5xxx"
5. **有改进闭环**："事后加了容量告警"
6. **可验证**："复盘在 GitHub 上"

**这六点都不能凭空编**——必须真运行过才能说。这也是为什么 Phase 5（真实运行）最重要。

## L6 陈述的独立特征

L6 不是"更深的 L5"，是**另一个维度的能力**：

| L5 特征 | L6 特征 |
|--------|--------|
| 单点深：在 X 上做了多深 | 地图广：在 X 领域里认知覆盖多广 |
| "遇到过 Y 问题并修复" | "领域有 A/B/C 方案，做过 A，读过 B，听过 C" |
| 时间维度（4 个月） | 结构维度（三层地图） |
| 靠运维积累 | 靠 **landscape scan + 诚实用词纪律** 积累 |

**一个合格的资深工程师应同时有两者**：
- 几个 L4-L5 的深点（否则是空话）
- 覆盖多个领域的 L6 地图（否则是井底之蛙）

**没 L5 的 L6 = 伪谦虚 + 空话**
**没 L6 的 L5 = 深而窄 + 容易瞎拍板**
**L5 + L6 = 真正的成熟度**

---

## 典型技术问题的陈述范本

针对 AI Agent 岗常见技术问题，每题准备 L4-L5 级别的陈述骨架。

### 1. "怎么部署 AI Agent？"

**L4-L5 范本**：
> "我做了 agent-lab，双节点跨云部署：
> - BFF + D1 在 Cloudflare Pages（Edge）
> - Python Agent 在阿里云香港 2GB VPS
> - 可观测栈（Langfuse/SigNoz/GlitchTip）在 Hetzner CX32（欧洲）
> - 两节点 Tailscale 组网，OTLP 走内网推
> - 部署 Dockerfile + docker-compose + Caddy 反代，CI/CD 走 GitHub Actions
> - 跑了 X 个月，期间做过 Y 次部署，经历过 Z 次 rollback"

**追问应对**：
- "为什么不用 K8s？" → 规模不需要 + ROI + 学习重点在运维不在编排
- "跨云不麻烦吗？" → 讲 Tailscale + 证书分发 + DNS 管理
- "成本多少？" → 具体到月 + 拆解每个服务

### 2. "LLM 调用怎么做可观测？"

**L4-L5 范本**：
> "Langfuse 自托管 v3 + OpenTelemetry 双轨。
> - LangChain callback 把 LLM 调用发到 Langfuse，看 input/output/token cost
> - 自己的 agent 代码加 OTel span 打到 Collector → SigNoz + Grafana Cloud
> - trace_id 三端贯穿：浏览器 OTel SDK 生成 → W3C traceparent → BFF 透传 → Python FastAPI Instrumentor 接收
> - 一次用户点击按钮，一个 trace_id 能追到 LangGraph 每个 node 的 LLM 调用
> - 运维期间抓到过 X 个 bug，最经典的是 CopilotKit Provider 引用不稳定导致 Inspector 清空（issue #32），3 轮错误归因才定位"

**追问应对**：
- "callback 何时触发？" → LangChain BaseCallbackHandler 的钩子链
- "采样怎么做？" → head sampling vs tail sampling 权衡
- "Langfuse session 怎么组织？" → 自己的实现方案

### 3. "怎么控制 LLM 成本？"

**L4-L5 范本**：
> "LiteLLM Proxy 做 Gateway，统一对接 Anthropic / OpenAI / Ollama / GLM / Gemini 五个 provider。
> - Redis cache 常用 prompt，命中率约 X%
> - 每日 budget 限额，超限自动降级到便宜模型
> - cost tracking 接 Langfuse 统一看板
> - 热更支持：BFF 改 LLM 配置 → 推送给 LiteLLM → <50ms 生效，不用重启
> - 运维 4 个月累计账单 $X，平均每条 trace $Y"

**追问应对**：
- "cache key 怎么设计？" → hash(model + messages) + TTL
- "超限降级策略？" → fallback chain 配置
- "provider 挂了怎么办？" → retry + circuit breaker

### 4. "线上 agent 出问题怎么排查？"

**L4-L5 范本**：
> "标准流程：
> 1. Telegram 告警先到（Prometheus alertrule）
> 2. Grafana 确认范围（哪个服务、多大影响）
> 3. 拿 trace_id grep 全栈日志（browser / BFF / Python agent 三端都有 trace_id）
> 4. Langfuse 看具体 LLM 调用细节
> 5. SigNoz 看完整 trace 链路
>
> 真实例子：上个月一次 XXX 问题，从告警到定位 fix 大约 Y 分钟，根因是 Z，复盘在 GitHub。"

**追问应对**：
- "trace_id 怎么在浏览器生成？" → W3C trace-context spec + OTel browser SDK
- "日志聚合？" → structlog + OTel log / Loki 规划
- "最难排查的一次？" → issue #32 三次错误归因

### 5. "印象最深的一次 debug？"

**这是高频问题**——准备一个能讲 15 分钟的故事。

**agent-lab 现成素材：issue #32**

> "CopilotKit Dev Console 在切换会话时清空 Agent tab。前后错过 3 次归因：
>
> 第 1 次：'upstream bug'，没做对照实验，错了
> 第 2 次：'初始化 race 窗口'，只凭推测，错了
> 第 3 次：'E2E 数据证伪 sessionReload'，盲信 E2E 行为 ≠ 人工行为，又错了
>
> 最后人工对照实验（setTimeout 1000→5000，现象延迟 5 秒）锁定 sessionReload 是触发源。然后源码追链路：`<CopilotKit>` 没传 `agents__unsafe_dev_only` 等 prop，destructure 默认值 `= {}` 每次 render 产生新 ref，触发 effect 重跑，Dev Console 的 subscribe 被 unsubscribe 覆盖。
>
> 修复：传一个模块级稳定的 `EMPTY_OBJ`。一行代码。
>
> 三个教训：
> 1. '未定位的层' ≠ 'upstream bug 无解'，再追一层源码往往就破了
> 2. E2E 行为 ≠ 人工行为 ≠ 生产行为，关键现象要人工验证
> 3. 数据巧合是确认偏差陷阱，要控制变量验证
>
> 写进了项目 CLAUDE.md 的'调研置信度分级'部分作为后续纪律。"

**这个故事结构的特点**：
- 承认自己错过 3 次 → 坦诚 + 反思能力
- 源码追到底 → 技术深度
- 提炼方法论 → 元能力
- 写入团队文档 → 工程素养

### 6. "怎么做 eval？"

准备中（需要 Phase 5 积累 eval 数据）。骨架：
> "用 Langfuse eval + 自己的评判 pipeline。每天跑 X 条 raw_items，人工 label Y 条作为基准，对比 agent 的评分和人工一致率。过去 4 个月准确率从 XX% 提到 YY%。"

### 7. "会 K8s 吗？"

**诚实 + 取舍的回答**：
> "K8s 基础概念清楚（Pod / Deployment / Service / Ingress），但没生产运维经验。当前项目做了明确取舍：双节点 Docker + Tailscale 比 K8s 更适合单用户项目规模，学习时间也更聚焦到 AI Agent 本身的能力上。如果工作中 K8s 是硬要求，2-4 周能学到生产可用水平——已经有单节点生产运维 4 个月的经验，K8s 对我来说是补一层编排概念而不是从 0 学运维。"

**这样回答的好处**：
- 不虚张声势
- 取舍有理由
- 展示学习能力和迁移能力

---

## 简历表达的落地规则

### 每条简历经验过 3 个自检

1. **AI 替代难度测试**：如果把这条写进 prompt 让 Claude 回答，答案比我强吗？
   - Claude 更强 → 这条停在 L1-L2 → 删
2. **深挖测试**：追问 3 轮我能答吗？
   - 答不到 3 轮 → L3 → 要么补深度要么删
3. **数字测试**：有具体数字吗？时间 / 量级 / 指标 / commit？
   - 没数字 → 加数字，或者换条

### 推荐的简历表达

**❌ 弱表达**（L1-L2）：
- "熟悉 Langfuse / Docker / OpenTelemetry"
- "搭建了可观测性平台"
- "优化了 LLM 调用性能"

**✅ 强表达**（L4-L5）：
- "设计并运维 agent-lab 可观测栈 4 个月（Langfuse v3 + SigNoz + OTel Collector 双节点跨云部署），累计 X 万条 LLM trace，MTTR 中位数 Y 分钟"
- "独立处理 3 次生产事故（ClickHouse OOM / 证书续期失败 / Langfuse upgrade 破坏性变更），每次事故有事后复盘（GitHub 链接）"
- "将 LLM 调用平均成本从 $X 降到 $Y，通过 LiteLLM Proxy cache + budget limit + 模型降级策略"

**强表达的特征**：
- 动词具体（设计 / 运维 / 处理 / 降低）
- 数字在场（4 个月 / X 万条 / Y 分钟）
- 有可验证性（链接 / commit / 复盘文档）
- 有**判断依据**（选 X 不选 Y 的理由）

### L6 版的简历表达

在"技术栈"/"能力总结"章节加一段 L6 元认知表达：

**❌ 常见写法**：
- "熟悉 LLM observability（Langfuse / LangSmith / Helicone）"

**✅ L6 写法**：
- "LLM observability：自托管 Langfuse v3 生产运维 4 月（L5）；LangSmith、Arize Phoenix 读过文档未实操；Helicone、Lunary 仅了解定位。选型方法论：先做 landscape scan 再 POC 2-3 个 top 候选"

差别：
- 每个技术的**掌握深度明确标注**
- 承认哪些没做过
- 有**方法论**（可追问 landscape scan 具体怎么做）

这种表达占篇幅不多，但能让阅读者看出陈述者的边界诚实——对资深岗位评估而言更有说服力。

---

## 对外表达准备 checklist

适用场景：技术面试、内部 review、技术博客/演讲、对外合作介绍。

- [ ] 简历每条经验过 3 测试，删掉 L3 以下
- [ ] 准备 5 个 L4-L5 故事（最少 3 个，每个能讲 10 分钟）
- [ ] **为 3-4 个核心领域各做一张 L6 地图**（LLM observability / LLM Gateway / Agent 架构 / 部署运维），三层结构
- [ ] 架构图画出来（能手绘 + 能讲清设计理由）
- [ ] 准备 ROI / 取舍 / 学习路径相关的元认知回答
- [ ] **练 L6 陈述**：被问"怎么看 XX 领域"时能 30 秒内说出三层地图
- [ ] demo 视频 2-3 个（10 分钟讲清一个技术点，用于配合文字陈述）
- [ ] GitHub README 对应简历每条经验有链接
- [ ] 模拟对话（按本文档范本过一遍）

---

## 持续积累的日常动作

### 每周 1 小时更新素材

- 本周遇到的事故 → 加到对应话题的 L4-L5 素材
- 本周关键 commit → 备注成"可引用 commit"
- 本周的数字变化（trace 量 / 成本 / MTTR）→ 更新到可引用数字池

### 每月 1 小时做 L6 地图更新

核心领域（3-4 个）每月各做一次 landscape scan：

- 搜 "top X alternatives 2026" / "XX vs YY 2026" 更新候选清单
- 新听到的名字 → 加到地图第二层"听过但没深入"
- 本月深入过的技术 → 从第二层升到第一层"已做"
- review 自己承认的盲区是否还合理 → 更新第三层

**地图独立维护**：在 `docs/production-playbook/knowledge-maps/` 下一个领域一个 md 文件。

4-6 个月下来：
- 这个文档（04）= **L4-L5 深点素材库**
- `knowledge-maps/` = **L6 地图素材库**

两者合起来 = 专业能力陈述的完整资源。
