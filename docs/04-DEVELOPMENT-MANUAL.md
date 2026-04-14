# Radar MVP 阶段回顾

> 本文档为早期 MVP 阶段计划，已于 2026-04-12 全部完成。保留作为历史记录。
> 当前架构和开发指南见 [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) 和 [DEV.md](./DEV.md)。

---

## 已完成功能

### 阶段一：Web 端配置与指挥 ✅
- Sources CRUD + attention weight
- 手动 Trigger + SSE trace + Runs 视图

### 阶段二：Mobile 端消费与追踪 ✅
- 流式信息流 + 左滑右滑 + 乐观 UI
- 隐式行为追踪 (Visibility API + dwell_ms)
- Mobile Chat UI + 状态跃迁

### 阶段三：Web 端周期性反思 ✅
- 偏差分析 (AttentionView)
- expected vs actual weight 可视化
