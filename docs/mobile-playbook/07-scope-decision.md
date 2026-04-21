# 07 · 决策记录：Mobile 不做 Production view

> 2026-04-21 决策（Q3 同意）。
> 本文是决策依据、边界定义、实现策略、演化触发器的集合。

---

## 1. 决策

**Mobile（compact viewport）不渲染 Production 类 View 的完整编辑界面。**

具体：
- `sources` → Mobile 引导到桌面，不渲染编辑 UI
- `settings` → Mobile 只显示核心只读项（如 LLM 配置状态查看、mock toggle），复杂配置（LLM key、secret、connection test）引导到桌面
- `runs` / `agent` → Mobile 提供只读 Glance（运行状态、最新会话摘要），不支持触发/编辑

**Mobile 是 Consumption + Monitoring 界面，不是 Production 界面。**

---

## 2. 决策依据

### 2.1 产品场景非对称

| 场景 | 设备 | 动作 | 时长 |
|---|---|---|---|
| Consumption | 📱 地铁/床/排队 | 刷 Inbox、swipe、读、追问 | 10s – 5min |
| Production | 💻 工位 | 调 Source、读 Run trace、改 Attention、改 Settings | 5min – 2h |
| Monitoring | 📱/💻 | 瞥 Mirror 偏差、查 Runs 状态 | 10s |

→ Production 在 Mobile 是**低频 + 低价值**场景。手机上配置 LLM secret、调试 Source RSS URL、诊断 Run 失败 → 全是反体感体验。

### 2.2 投入产出不成比例

做 Mobile 适配 Production view 的成本：
- `SourcesView.tsx` 509 行，表单 / 列表 / 开关混合 → 重写 Mobile 版成本高
- `SessionDetail.tsx` 583 行 → trace 可视化在小屏基本不可用
- `SettingsView` 有 LLM connection test 等高密度 form
- 每加一个桌面功能，Mobile 要跟改

收益：
- 每月使用一次？每年？
- 用户（你）已经表达"mobile 配置 Source 不是痛点"

→ 典型过度工程化。

### 2.3 桌面是不可替代的生产环境

Claude.md 原则之一"不要过度工程化"。与其在 Mobile 做功能残缺的 Production view，不如**明确 Mobile 不做，让桌面保持完整**。

这也是 iOS / macOS、Android / ChromeOS 的主流生态假设：**严肃的配置和管理在电脑做**。

---

## 3. 边界定义

### 3.1 Mobile 的最小生产能力（保留）

即使不做完整 Production view，以下最小项在 Mobile 必须可用：

| 能力 | 必要性 | 实现 |
|---|---|---|
| 切换 LLM Mock 开关 | 调试急用 | Settings 里单一 toggle |
| 查看 Run 状态 / 最近失败 | 监控 | `RunsGlance` 只读 |
| 查看 Source 启用状态 | 监控 | Sources 列表只读 |
| 触发一次采集 run | 偶尔在外 | Runs 里一个"Run now"按钮（不改配置） |
| 查看最近 Agent session 摘要 | 追溯 | 只读历史 |

**界定原则**：
- 可以**看**、可以**触发既有动作**
- 不能**配置**、不能**编辑 schema 型字段**

### 3.2 引导到桌面的交互

Mobile 点进 `/sources` 或 `/settings` 的完整编辑入口时，渲染**引导卡片**而不是残缺 UI：

```
┌────────────────────────────────────────┐
│                                        │
│          🖥  在电脑上配置                │
│                                        │
│   这个功能需要更大的屏幕。               │
│   打开电脑浏览器访问：                    │
│                                        │
│   [  agent-lab.xxx.com/sources  ]      │
│   [  复制链接  ]  [  邮件自己  ]         │
│                                        │
└────────────────────────────────────────┘
```

**待决策（O3）**：是否加 "扫码直达桌面" 功能（用手机扫桌面浏览器弹出的二维码）—— 这是进阶交互，先不做。

---

## 4. 信息架构影响

### 4.1 TabBar 精简

Mobile TabBar 从当前 5 项简化：

```
当前: Inbox | Watch | Mirror | Runs | Settings
                                 ↑
                             Runs 在 Mobile 只是 Glance

重设计后: Inbox | Watch | Mirror | Activity | More
                                     ↑           ↑
                                 统一监控视图    抽屉（Settings 核心 + 引导入口）
```

- `Activity`：整合 Runs Glance + 最近 Agent session + 系统状态的单一监控 view
- `More`：底部抽屉，放 Mobile 支持的 Settings 核心项 + 桌面引导链接

### 4.2 View 可见性矩阵（更新）

| View | compact | medium | expanded |
|---|---|---|---|
| `inbox` / `watching` | ✅ 主要 | ✅ | ✅ |
| `attention` (Mirror) | ✅ 只读 + 简化图表 | ✅ | ✅ |
| `activity` (合并 Runs + Agent Glance) | ✅ 只读 + 单按钮触发 | ✅ | ✅ |
| `sources` | ❌ 引导卡片 | ✅ | ✅ |
| `settings` | ⚠ 核心项 + 引导 | ✅ | ✅ |

---

## 5. 实现策略

### 5.1 路由层面的处理

```tsx
// app/agents/radar/sources/page.tsx
'use client';
import { useViewport } from '@/lib/hooks/useViewport';
import SourcesView from '@/views/production/SourcesView';
import DesktopOnlyGuide from '@/components/primitives/DesktopOnlyGuide';

export default function Page() {
  const vp = useViewport();
  if (vp === 'compact') {
    return <DesktopOnlyGuide feature="sources" />;
  }
  return <SourcesView />;
}
```

**而不是**在 SourcesView 内部做 `if (isMobile) return <Fallback />` —— 保持 Layer 4 Surface 组件本身不知道设备形态，符合 P1 分层原则。

### 5.2 `DesktopOnlyGuide` primitive

```tsx
// components/primitives/DesktopOnlyGuide.tsx
<EmptyState
  icon="🖥"
  title="在电脑上配置"
  description="{feature} 需要更大的屏幕。"
  actions={[
    { label: '复制链接', onClick: copyUrl },
    { label: '邮件自己', onClick: emailSelf },
  ]}
/>
```

统一外观，所有 Production view 共用。

---

## 6. 决策的演化触发器

当以下条件发生，**重新评估**：

1. **用户（你）在移动端想改 Source 配置 ≥ 3 次/月** → 说明这是真痛点
2. **增加多用户场景**（agent-lab 从单用户工具变协作产品） → 移动端配置变高频
3. **外出场景占比 > 50%**（长期 remote / 旅行） → 桌面不在手边

触发后的行动：
- 挑**最刚需**的一个 Production 能力（如 Source toggle enable）做 Mobile 适配
- 其余保持桌面专属

---

## 7. 反对意见与回应

### Q：用户想手机查 run 错误日志怎么办？

A：`Activity` view 提供只读 Glance，可以看最近失败的 run + 摘要错误信息 + trace_id。要深度 debug 还是桌面。

### Q：朋友推荐一个 RSS URL，我想当场加进去？

A：短期用"邮件自己 / 微信收藏"过渡。产品本身没必要做手机添加 Source。
未来如果这是高频场景，可以做一个**轻量 Quick Add**：只填 URL，自动推断 source_type，不暴露完整配置。但这是**特殊化的轻操作**，不等于做完整 Production view。

### Q：这样会不会显得产品"缺功能"？

A：单用户工具，只有你一个用户。你不觉得缺，就不缺。

---

## 8. 与总 RFC 的对齐

[`01-architecture-rfc.md`](./01-architecture-rfc.md) 的 P4 原则：
> Progressive Disclosure — Mobile: essential + contextual；Desktop: full advanced

本决策是 P4 的具体落地。
