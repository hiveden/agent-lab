# PRODUCT-TODO — Radar 产品闭环待设计

> **状态**:技术闭环已通,产品闭环未成立
> **暂停原因**:用户需要时间思考
> **下次开工先看这个文件**

---

## 核心问题

今天做完的是**技术 demo**:
- Gemini 能从 HN 拉数据生成推荐 ✓
- 列表能浏览 ✓
- 对话能追问 ✓
- 可以手动触发采集 ✓

**但这不是产品**。用户问了 4 个问题,我全部没答案:

1. **信息源如何配置?** — HN 写死在代码里,加 V2EX/Reddit 要改代码
2. **如何查看和修改配置?** — LLM / 模型 / 温度 / 频率 全部 .env
3. **如何修改提示词?** — hardcoded 在 chains/*.py,改 prompt 要重启
4. **如何管理资讯?** — 只能看,不能删,不能归档,不能编辑

---

## Radar 的真·最小闭环(待用户确认)

一个 Agent 产品,用户能走完一个**自运转循环**:

```
┌─────────────────────────────────────────────┐
│                                              │
▼                                              │
发现 → 阅读 → 判断 → 反馈 → 学习 ─────────────┘
 │      │      │      │       │
 │      │      │      │       └ Agent 下一轮更懂你
 │      │      │      └ 告诉 Agent 为什么好/为什么坏
 │      │      └ 标记 watching/dismissed
 │      └ 看 title/summary/why
 └ Agent 定期自动推,不用手动触发
```

### 当前各环节状态

| 环节 | 状态 | 缺什么 |
|---|---|---|
| 发现 | ⚠️ 手动触发能跑 | **没有定时,不会自动推** |
| 阅读 | ✅ 足够 | — |
| 判断 | ⚠️ 能标 watching/dismissed | **没有 Watching 队列给我回顾** |
| 反馈 | ❌ 完全没有 | **点 dismissed 不能写为什么** |
| 学习 | ❌ 完全没有 | **下轮 push 完全不看历史反馈** |

**5 环节里 3 环节断了**,所以不成立为产品。

---

## 两层设计:最小闭环 vs 完整产品

### 层 1:最小闭环(可能是 3 小时工作量)

只做让"自运转循环"能跑起来的东西:

| 编号 | 功能 | 工作量 | 为什么必须 |
|---|---|---|---|
| **A** | 前端定时采集 toggle (setInterval) | 10 分钟 | 不手动也能跑 |
| **B** | Watching 队列页(复用列表组件) | 30 分钟 | watching 标记才有意义 |
| **C** | Dismissed 时弹 feedback 输入 + `items.feedback` 字段 | 1 小时 | 反馈链路 |
| **D** | Push 时读最近反馈注入 system prompt (learned_rules 数字化) | 30 分钟 | 学习链路 |
| **E** | `runs` 表 + Runs 页 | 1 小时 | 可追溯,失败可诊断 |

**完成后**:Radar 能自动跑、能学、能追溯。是一个真的产品。

### 层 2:完整产品(不是 MVP,是中期方向)

二级 tab 结构:

```
radar / [Feed] [Runs] [Sources] [Prompts] [Settings]
```

- **Feed**:现有列表 + chat + trace(+ 补 Delete/Archive/Edit)
- **Runs**:每次 push 的历史、状态、trace、失败诊断。顶部 `[Trigger now]`
- **Sources**:信息源列表,每个可开关 + 配置 limit/频率 + 看最后拉取状态;支持新增源(HN API / RSS / Reddit / custom URL 模板)
- **Prompts**:Monaco 编辑器 + 版本管理 + 保存立刻生效,不用重启
- **Settings**:LLM / 调度 / 阈值 / 提醒规则 / 数据导出

### 层 3:更远的方向(下次不要讨论)

- 多 Agent 模板 / 一键新建 Agent
- 多用户 / 权限
- Watching 的定期重推
- 智能 deduplication(不只是 external_id 精确匹配,还有语义去重)
- 跨 Agent 信号聚合(Pulse / Scout 数据如何关联到 Radar)

---

## 数据模型演进(层 1 和层 2 需要)

### 现有表
```sql
items            -- 推荐条目
user_states      -- 用户标记状态(unread/watching/...)
chat_sessions
chat_messages
```

### 层 1 需要新增
```sql
-- 每次 push 的记录
runs (
  id              TEXT PK,
  agent_id        TEXT,
  trigger         TEXT,          -- 'manual'|'cron'|'cli'|'auto'
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  status          TEXT,          -- 'running'|'success'|'failed'
  inserted        INT,
  skipped         INT,
  spans_json      TEXT,          -- 完整 trace 归档
  error_msg       TEXT
);

-- items 加字段
ALTER TABLE items ADD COLUMN run_id TEXT;
ALTER TABLE items ADD COLUMN feedback_note TEXT;       -- 用户反馈文字
ALTER TABLE items ADD COLUMN feedback_reaction TEXT;   -- good/bad/neutral
ALTER TABLE items ADD COLUMN archived_at TIMESTAMP;    -- 软删除
```

### 层 2 再加
```sql
sources          (id, agent_id, kind, config_json, enabled, last_fetch_at, last_success_at)
prompts          (id, agent_id, key, content, version, created_at, author)
agent_settings   (agent_id, key, value_json, updated_at)
```

---

## 待用户回答的决策问题

1. **接受最小闭环的重新定义吗?**(5 项 A-E)
2. **范围选哪个**:
   - `a.` 只做 A+B(采集自动化 + Watching 队列)— 约 40 分钟
   - `b.` 最小闭环 A-E 全做 — 约 3 小时
   - `c.` 最小闭环 + 部分层 2(Sources / Prompts)— 约 1 天
3. **Phase 4 部署**:推迟到产品闭环完成之后,还是先部署一版不完美占位?
4. **是否接受**:"技术闭环不等于产品闭环" 这个反思,以后所有 Agent 的设计都从"用户完整动作链条"开始,而不是"先让技术跑起来"

---

## 我的建议(不是决定)

- **做 `b.`**(最小闭环 A-E)
- **Phase 4 部署推到 b 完成之后**
- 原因:a 不够用,用两天就嫌弃;c 太远今天 ship 不了;先不部署反而加速迭代

但这是产品判断不是技术判断,**决策权在你**,你需要时间思考。

---

## 明天开工前的检查清单

- [ ] 重读这份文件
- [ ] 决定层 1 的范围(a/b/c)
- [ ] 决定 Phase 4 时机
- [ ] 如果要做,检查 `docs/SESSION-2026-04-09.md` 里的"后日再开时的入口",启动服务
