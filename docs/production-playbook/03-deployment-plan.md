# 03. 部署方案与 4-6 月时间线

> **核心决策**：双节点跨云部署 + 全组件自托管 + 20% 部署 80% 运维

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  用户（VPN 访问无延迟约束）                              │
└─────────────────────────────────────────────────────────┘
         │
         ├─── https://xxx.pages.dev (BFF)
         │    └─ Cloudflare Pages
         │       └─ Cloudflare D1 (SQLite，边缘复制)
         │
         └─── https://agent.xxx.com (Agent API)
              └─ Caddy (阿里云入口)

┌─── 阿里云 Ubuntu 2GB (hkg-1) 应用节点 ────────────┐
│                                                    │
│  Caddy (443 入口，反代 + HTTPS)                     │
│  ├── Python Agent Radar (8001)                     │
│  ├── LiteLLM Proxy (4000)                          │
│  └── OTel Collector (4318) ─┐                      │
│                              │                      │
└──────────────────────────────┼──────────────────────┘
                               │ Tailscale 内网
                               │ (OTLP gRPC/HTTP)
                               ▼
┌─── Hetzner CX32 (eu-1) 观测栈节点 8GB ────────────┐
│                                                    │
│  Caddy (443 入口，子域名反代)                       │
│  ├── langfuse.xxx.com  → Langfuse v3 全家桶       │
│  ├── signoz.xxx.com    → SigNoz 全家桶            │
│  ├── errors.xxx.com    → GlitchTip                │
│  └── OTel Collector (接收上游)                     │
│                                                    │
│  数据持久化:                                        │
│  └── Volumes → 每日 rclone 推 Cloudflare R2       │
└────────────────────────────────────────────────────┘

Cloud 兜底:
├── Grafana Cloud（LGTM 栈，OTLP 接入）
└── Sentry Cloud（可选）
```

---

## 为什么这么设计

### 1. 为什么双节点

| 设计选择 | 单节点方案 | 双节点方案 |
|--------|-----------|----------|
| 资源 | 升级单机到 8GB+ | 2GB + 8GB 分开 |
| 故障域 | 一锅端 | 独立（应用挂不影响观测） |
| 学习维度 | 单机运维 | **跨节点网络 + 分布式拓扑** |
| 真实场景模拟 | 弱 | 强（模拟生产常见模式） |

**学习 ROI 考虑**：双节点能顺带学 Tailscale 组网、跨节点 OTel 推送、反代链路跨机、证书分发——这些都是**真实生产经验**。

### 2. 为什么跨云（阿里云 + Hetzner）

**同云多节点学不到的东西**：
- 证书跨云分发
- DNS 跨域名管理（一个国内 DNS 一个国际 DNS）
- 跨境网络调优（latency、TCP keepalive、MTU）
- 故障演练"一朵云挂了"

**现有资源利用**：
- 阿里云 2GB 已付费到 2026-06（沉没成本）
- Hetzner 新租 CX32 €8/月 = 真实运维经验与跨云内容素材的入场费

### 3. 为什么不 K8s

见 [`02-learning-roi.md`](./02-learning-roi.md) "为什么不学 K8s"。简言：学习曲线陡 + 本项目规模不需要 + 可作为后续项目。

### 4. 为什么 BFF 留在 Cloudflare Pages

- D1 绑定强制 Cloudflare 生态，迁走代价大
- Edge 部署对 BFF（纯数据层）是福音
- 免费额度够
- 已有代码围绕 Cloudflare 生态构建

---

## 组件部署清单

### 阿里云节点（应用层）

| 组件 | 资源 | 端口 | 备注 |
|------|------|------|------|
| Caddy | 50MB | 80/443 | HTTPS 自动化 + 反代 |
| Python Agent (Radar) | ~500MB | 8001（内部） | FastAPI + LangGraph |
| LiteLLM Proxy | ~300MB | 4000（内部） | LLM Gateway |
| OTel Collector | ~100MB | 4318（内部） | 采集 + 转发到 Hetzner |
| Tailscale | ~30MB | daemon | 内网连 Hetzner |

**预算**：~1.0GB / 2GB，留 1GB 余量给系统和突发。

### Hetzner 节点（观测栈）

| 组件 | 资源 | 端口 | 备注 |
|------|------|------|------|
| Caddy | 50MB | 80/443 | 子域名反代 |
| Langfuse v3 全家桶 | ~3GB | 3010 | PG + CH + Redis + MinIO |
| SigNoz 全家桶 | ~3GB | 3301 | ClickHouse + Zookeeper |
| GlitchTip | ~1GB | 8002 | PG + Valkey |
| OTel Collector | ~100MB | 4318 | 接收上游 + 分发 |
| Tailscale | ~30MB | daemon | 内网接阿里云 |

**预算**：~7.2GB / 8GB，紧但够。

**如果不够**：
- 先停 SigNoz（C 级，可替代为 Grafana Cloud）
- 升级 Hetzner CCX13（€12/月 / 8GB 专用 vCPU）

### Cloudflare 层（BFF）

| 组件 | 部署 | 备注 |
|------|------|------|
| Next.js BFF | Pages | 已有 wrangler.toml |
| D1 | 绑定 | 需创建生产实例 |

---

## Phase 1-6 时间线

### Phase 1：部署全栈（W1-2）

**目标**：所有组件**上线可访问**，端到端 smoke test 通过。

**任务**：
- [ ] 租 Hetzner CX32，Ubuntu 24.04
- [ ] 两节点装 Docker + Tailscale 组网
- [ ] 创建 Cloudflare D1 生产实例 → 更新 wrangler.toml → 跑远端 migrations
- [ ] 注册国际域名（Cloudflare Registrar 或 Namecheap）
- [ ] 给 `agents/radar` 写 Dockerfile（抄 tts-agent-harness 改造）
- [ ] 阿里云：docker-compose.app.yml（Agent + LiteLLM + Collector + Caddy）
- [ ] Hetzner：docker-compose.obs.yml（Langfuse + SigNoz + GlitchTip + Collector + Caddy）
- [ ] Cloudflare Pages 部署 BFF
- [ ] 端到端 smoke：从浏览器触发 chat → trace_id 在 Langfuse/SigNoz 可查

**产出**：
- Dockerfile / docker-compose / Caddyfile 完整落仓
- 部署操作记录（未来 blog 素材）

### Phase 2：告警体系（W3）

**目标**：所有可预见的故障都能 **push 到手机**。

**任务**：
- [ ] 装 Prometheus + node-exporter（Hetzner 节点）
- [ ] 写 alertrule.yml：CPU / RAM / 磁盘 / 容器 restart / 证书过期 / DNS 失效
- [ ] 开 Telegram bot，alert 推到自己
- [ ] 配 OTel Collector health check → Prometheus scrape
- [ ] 配 Langfuse / SigNoz / GlitchTip 自身的 healthcheck endpoint 监控
- [ ] 冒烟：手动触发一次 alert，验证 Telegram 收到

**产出**：
- `06-sre-runbook.md` 开篇：告警规则汇总

### Phase 3：故障演练（W4）

**目标**：把可能的故障**提前演练一遍**，积累排障履历。

**演练清单**：
- [ ] `docker kill` Langfuse 主容器 → 看 Caddy 怎么 502、ClickHouse 怎么 recover
- [ ] `fallocate -l 10G` 填 Hetzner 磁盘 → 看 ClickHouse 怎么挂、alert 怎么触发
- [ ] 断 Tailscale 网 → 看 OTel Collector 怎么 retry、应用是否降级
- [ ] 故意让 Caddy 证书过期 → 看恢复流程
- [ ] 故意填满 Cloudflare D1 某表 → 看 BFF 报错链路
- [ ] `stress-ng` 爆 RAM → 看 OOM killer 挑谁 + restart policy

**每次演练必写**：
1. 演练前预期
2. 实际发生了什么
3. 排查用的命令
4. 恢复步骤
5. 后续改进（加告警 / 加监控 / 加自愈）

**产出**：
- `06-sre-runbook.md` 故障演练章节
- 每次演练 = 1 个 blog / 面试故事

### Phase 4：调优（W5-6）

**目标**：各组件的**生产化配置**完成。

**任务**：
- [ ] ClickHouse TTL（Langfuse + SigNoz，3 月前数据自动删）
- [ ] Caddy 缓存 + gzip + HTTP/3
- [ ] LiteLLM Redis cache（常用 prompt 缓存）
- [ ] LiteLLM budget limit（每日 token 预算）
- [ ] 备份自动化：rclone + crontab + Cloudflare R2
- [ ] 定期备份验证脚本（随机抽一天恢复试试）
- [ ] 所有容器 `restart: unless-stopped` + `healthcheck`
- [ ] 资源限制 `mem_limit` / `cpus`（防止一个组件拖垮节点）

**产出**：
- docker-compose 最终版
- 备份恢复 runbook

### Phase 5：真实运行积累（W7-16，约 2.5 个月）

**目标**：**就让它跑**，记录每次事故。

**这是最重要的阶段**——前面 6 周是为了这 10 周的"有效运行时间"准备的。

**日常任务**：
- 每周一 check 所有节点状态（10 分钟）
- 每次 alert 触发必跟进记录到 `07-incident-log.md`
- 每月 review 一次整体成本、容量、性能趋势
- 每月主动演练 1 次新场景

**产出**：
- **`07-incident-log.md` 每条都是 blog / 深度追问素材**
- 真实 MTTR / MTTD 数据（对外陈述时有具体数字支撑）
- 调优 commit 历史（可引用"我优化了 X% 的 Y"有依据）

### Phase 6：内容收口 + 公开发布（约 2026-07）

**目标**：把 4-5 个月积累**转化**成可持续的分享资产。

**任务**：
- [ ] 重写项目 README：同行读者视角 + 架构图 + 技术栈
- [ ] 录 2-3 个 demo 视频（10 分钟内讲清一个技术点）
- [ ] 整理 blog：从积累的 draft 里挑 5-8 篇精修发布
- [ ] 陈述打磨：每条经验按 L1-L6 自评，L3 以下不公开陈述
- [ ] 对外表达 mock：按 [`04-expression-precision.md`](./04-expression-precision.md) 练几轮
- [ ] GitHub README 精修：架构图 / demo 链接 / blog 索引
- [ ] （副产出）简历更新：引用上述已发布内容

**产出**：
- GitHub 作品页（主入口）
- 3-5 个 demo 视频
- 5-8 篇已发布的技术博客
- 简历终版（副产出）

---

## 关键里程碑

| 日期 | 里程碑 |
|------|-------|
| 2026-04-底 | 全栈上线，smoke test 通过 |
| 2026-05-底 | 告警体系完成，Phase 3 演练完 |
| 2026-06-底 | Phase 4 调优完，正式进入"纯运行"期 |
| 2026-07-中 | 积累 2.5 月真实运行数据 |
| 2026-07-底 | 内容收口：5-8 篇 blog 发布 + demo 视频完成 |
| 2026-08 | 外部互动期（同行讨论 / 面试 / 可能的接项目） |

**硬约束**：
- 阿里云 2GB 到期 2026-06-21 → 这之前决定是否续费或迁移
- 7 月底内容必须收口发布，不能再改架构

---

## 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Hetzner 某次 downtime 1 天 | 中 | 预期内，当作"一次真实事故"记录 |
| Langfuse v3 升级破坏性变更 | 中 | 锁定 minor 版本，升级前备份 |
| 阿里云 2GB OOM 崩溃 | 中 | 加 swap 临时扛，不够再升级 4GB |
| 某组件学习时间超预算 | 高 | 严格按 ROI 分级砍时间 |
| 运维事故太少不够素材 | 低 | 主动演练补齐（Phase 3+每月 1 次） |
| 对外陈述被技术深挖露馅 | 中 | 靠 Phase 5 真实运行 + L4-L5 素材托底 |

---

## 不包含的事

**明确不做**：
- K8s（学习曲线陡 + 项目不需要）
- 多用户 / 多租户（单用户项目，不偏离主线）
- 大规模压测（单用户流量无意义）
- 复杂 CI/CD（GitHub Actions 基础版够）
- 自建监控告警平台（Prometheus + AlertManager + Telegram 够）

**只有触发条件才做**：
- K8s：如果外部场景明确要求（某家目标公司 / 某个读者 / 接项目）
- 压测：如果读者追问或具体场景需要性能数据
- SRE on-call 模拟：时间多余可选

---

## 下一步立即执行

按优先级：

1. 租 Hetzner CX32（10 分钟）
2. 两节点装 Docker + Tailscale（1 小时）
3. 创建 Cloudflare D1 生产库（10 分钟）
4. 给 agents/radar 写 Dockerfile（半天，抄 tts-agent-harness）
5. 阿里云部署应用层 compose（1 天）
6. Hetzner 部署观测栈 compose（2 天，Langfuse + SigNoz 最花时间）
7. Cloudflare Pages BFF 部署（半天）
8. smoke test 拉通（1 天）

**Week 1 预计工作量**：集中攻关 5 天左右。
