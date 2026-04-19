# 25 - TODO 索引（已迁 GitHub Issues）

> **定位**：所有待办已迁移到 GitHub Issues（2026-04-19）。本文件仅保留文档地图 + 索引入口。
> **权威来源**：[GitHub Issues](https://github.com/hiveden/agent-lab/issues)
> **最后更新**：2026-04-19

---

## 快速入口

| 入口 | 说明 |
|---|---|
| [所有 open issues](https://github.com/hiveden/agent-lab/issues) | 全量待办 |
| [label:p0](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Ap0) | 阻塞当前目标 |
| [label:p1](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Ap1) | 企业级必备 |
| [label:p2](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Ap2) | 能力深化 |
| [label:p3](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Ap3) | 可选 / 机会性 |
| [M1 可 demo 的企业级](https://github.com/hiveden/agent-lab/milestone/1) | P0 聚合 |
| [M2 企业级深化](https://github.com/hiveden/agent-lab/milestone/2) | P1 聚合 |
| [label:bug](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug) | 已知 bug（见 26） |

## 领域 label

`observability` / `agent` / `infra` / `llm` / `ui` / `upstream` / `debt` / `feat`

## 推荐路径

**最短路径到"可 demo 的企业级"（~5-7d）**（见 M1 milestone）：
用户认证 #3 → Python Agent 部署 #1 → CI/CD #2 → LLM Gateway #4 → Eval pipeline #8

**最短路径到"observability 闭环"（半天）**：
对照实验 #10 → 上游提 issue #11（若 #10 证明是上游 bug）

---

## 维护约定

- **新增 TODO**：直接开 GitHub Issue，打上 `p0-p3` + 领域 label + 可选 milestone
- **完成**：close issue；若涉及代码变更，commit message 带 `Closes #N`
- **权威内容**：issue 正文是"薄索引"，详细内容仍在 `docs/22` / `docs/23` 等源文档里，issue 指向源文档

---

## 文档地图

| 文档 | 职责 |
|---|---|
| `25-TODO.md`（本文）| GitHub Issues 快捷入口 |
| `26-KNOWN-BUGS.md` | bug issues 快捷入口 |
| `21-TECH-DEBT.md` | 技术债（现有代码） |
| `22-OBSERVABILITY-ENTERPRISE.md` | 可观测性架构 + ADR + Phase + 风险 |
| `23-ARCHITECTURE-BACKLOG.md` | 架构缺口（未做的新功能） |
| `24-OBSERVABILITY-PLAYBOOK.md` | 排查手册 |
| `02-ARCHITECTURE.md` | 项目整体架构 |
| `03-TECH-STACK.md` | 技术栈登记 |
