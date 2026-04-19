# 26 - 已知 Bug 索引（已迁 GitHub Issues）

> **定位**：已知未修 bug 已迁到 GitHub Issues（2026-04-19）。本文件仅保留文档地图 + 索引入口。
> **权威来源**：[GitHub Issues — label:bug](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug)
> **最后更新**：2026-04-19

---

## 快速入口

| 入口 | 说明 |
|---|---|
| [所有 bug](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug) | 全量 |
| [label:upstream](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Aupstream) | 上游 bug（等上游修 / 绕过） |
| [label:bug+label:debt](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug+label%3Adebt) | 低优先级 / 技术债类 bug |
| [label:bug+label:observability](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug+label%3Aobservability) | 可观测性相关 |
| [label:bug+label:agent](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Abug+label%3Aagent) | Agent / AG-UI / LangGraph |

## 状态约定

- `upstream` label — 别人的代码，我们绕过或等修
- 无 `upstream` 但 label 有 `agent` / `observability` — 我们盖住了（下游补丁），根因可能未严格验证
- 含 `debt` — 低优先级 / 长期存在，非阻塞

---

## 维护约定

- **发现新 bug**：直接开 GitHub Issue，打 `bug` + 领域 label（必要时 `upstream`）
- **修复**：close issue；commit message 带 `Closes #N`
- **根因确认**（例如 #10 对照实验做完）：更新对应 issue 状态 + 源文档

---

## 文档地图

| 文档 | 职责 |
|---|---|
| `26-KNOWN-BUGS.md`（本文） | GitHub bug issues 快捷入口 |
| `25-TODO.md` | GitHub Issues 全量快捷入口 |
| `21-TECH-DEBT.md` | 代码债务（会话持久化领域） |
| `22-OBSERVABILITY-ENTERPRISE.md` | observability 架构 + 28 风险表（bug 根因详述） |
| `17-AGUI-STREAMING-DEDUP.md` | AG-UI 事件去重历史排查记录（#19 / #20 根因） |
