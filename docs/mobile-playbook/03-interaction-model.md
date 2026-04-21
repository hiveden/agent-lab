# 03 · 交互模型

> 手势、Thumb Reach、触觉反馈、键盘适配、无障碍的统一规范。

---

## 1. 手势矩阵

| 手势 | compact | medium | expanded |
|---|---|---|---|
| 单击卡片 | 打开 detail（路由全屏） | 打开 detail（右 panel） | 打开 detail（内嵌） |
| 横滑左 | dismiss | dismiss | ❌ |
| 横滑右 | watch | watch | ❌ |
| 长按 | 进入多选模式 | 多选 | Shift+Click |
| 下拉（列表顶部） | Pull-to-refresh | — | — |
| 上滑 / Home 条 | 关闭 Sheet | — | — |
| 双指捏合 | — | Panel resize | — |
| 键盘 J/K | ❌ | ✅（带外接键盘） | ✅ |
| ⌘K | ❌ | ✅（软键盘激活） | ✅ |
| 浏览器后退 | ✅ detail→列表 | ✅ | ✅ |

**规则**：每个移动端手势在 medium/expanded 必须有键盘对等（P5 原则），反之不强制。

---

## 2. Thumb Reach 分区

```
┌─────────┐
│  HARD   │  顶部 25%  ← 只放被动信息（标题、时间、状态）
├─────────┤
│  OK     │  中段 50%  ← 主内容（消息、卡片）
├─────────┤
│  EASY   │  底部 25%  ← 主动作（TabBar、Input、Apply 按钮）
└─────────┘
```

**落位规则**（Compact Shell）：

| 元素 | 区域 | 原因 |
|---|---|---|
| 标题 / 来源 / 时间 | HARD | 被动阅读，偶尔瞥 |
| 卡片列表 / 消息 | OK | 主内容，滑动浏览 |
| TabBar | EASY | 频繁切换 view |
| Chat 输入 + 发送 | EASY | 频繁输入 |
| **PendingChangesSheet** | EASY | Apply/Discard 是高频主动作 |
| 搜索按钮 | HARD 右上 | 低频进入，可接受远距 |
| 返回按钮 | HARD 左上 | 浏览器后退替代，Sheet 里才出现 |

**反例**（当前桌面搬过来的错位）：
- `PendingChangesBanner` 在顶部 → Mobile 按 Apply 要伸手，错。重设计放底部 Sheet。

---

## 3. 触觉反馈（Haptic）

用 Web Vibration API（Android Chrome 支持，iOS Safari 不支持 → 原生壳时才能补齐）：

| 场景 | 振动模式 | 含义 |
|---|---|---|
| Swipe 触发阈值 | `vibrate(10)` | 轻提示"已越线" |
| Apply pending 成功 | `vibrate([10, 50, 10])` | 双击反馈 |
| 操作失败 | `vibrate([100, 50, 100])` | 强提示 |
| 长按进入多选 | `vibrate(30)` | 确认进入模式 |

**iOS 补救**：不能振动时用**视觉 + 音效**替代（按钮缩放 + 短 tick 音）。或等 Capacitor 壳接 `Haptics` 原生 API（见 [`05-pwa-strategy.md`](./05-pwa-strategy.md)）。

---

## 4. Swipe 行为规范

### 4.1 阈值

```
阈值 = min(容器宽度 × 25%, 100px)
```

固定 100px 在 320px 屏上过大（31%），按百分比更合理。

### 4.2 视觉反馈

```
拖动进度 0% ──────→ 25% ──────→ 50%
          ↑背景淡    ↑阈值 vibrate  ↑颜色饱和
          色显现    + 图标放大     + 文字出现
```

- 背景色按 `Math.abs(offsetX) / threshold` 映射 opacity 0→0.8
- 到达阈值时**按方向**提示图标放大（当前是固定两边都显示，用户不知道当前方向）
- 松手触发后卡片滑出视野 + `AnimatePresence` 折叠

### 4.3 误触保护

- 横向拖动 < 10px 一律视为 tap（触发 onClick）
- 垂直拖动占主导（`|deltaY| > |deltaX| * 1.5`）时禁用水平 drag
- 双指触控一律禁用 swipe（防止系统手势冲突）

---

## 5. 键盘 / 软键盘适配

### 5.1 Visual Viewport 提升到 Shell 级

当前 `MobileChatView.tsx:64` 只在 chat 订阅，其他 view（搜索、表单）键盘弹起会遮挡。

```tsx
// shells/MobileShell.tsx（重设计）
useEffect(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    document.documentElement.style.setProperty('--vv-h', `${vv.height}px`);
    document.documentElement.style.setProperty('--vv-kb', `${window.innerHeight - vv.height}px`);
  };
  update();
  vv.addEventListener('resize', update);
  return () => vv.removeEventListener('resize', update);
}, []);
```

全局 CSS 变量：
- `--vv-h`：当前可视高度（键盘弹起时变小）
- `--vv-kb`：键盘高度（不弹起时为 0）

**所有**需要贴底的元素用 `bottom: var(--vv-kb, 0)` 自动让位。

### 5.2 外接键盘（iPad）

medium 档位带 Magic Keyboard 的 iPad 是"类桌面"用户，要支持：
- J/K 导航（同 expanded）
- ⌘K 搜索
- Esc 关闭 Sheet / Panel

检测：`navigator.keyboard.getLayoutMap()` 存在 + visual viewport 未缩小 → 外接键盘在位。

---

## 6. 无障碍（Accessibility）

### 6.1 触控目标尺寸

**最小 44×44pt**（Apple HIG）或 **48×48dp**（Material）。

当前违规：
- `TabBar.tsx` 图标区域够大但文字标签小
- `MobileItemsList` filter chips `py-1.5 px-3.5` ≈ 28px 高，偏小

重设计最小：
```css
.tap-target { min-height: 44px; min-width: 44px; }
```

### 6.2 屏幕阅读器

- `TabBar` 每个 button 要有 `aria-label`（已有）
- 卡片 swipe 手势要提供**按钮替代**（长按弹菜单，菜单里有"标记 watch / dismiss"）— 单手触控用户也受益
- `role="tablist"` / `role="tab"` 在 TabBar 正确标注

### 6.3 对比度

- 文字正文 ≥ 4.5:1（WCAG AA）
- 大文字 / 图标 ≥ 3:1
- 当前 `--ag-text-2` 在浅色主题对比度需真机验证

### 6.4 减弱动效（prefers-reduced-motion）

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Swipe 阈值等视觉反馈降级为**即时 snap**。

---

## 7. 错误与反馈

| 事件 | 反馈形式 |
|---|---|
| 网络失败 | Sonner toast bottom-center + 图标 + 重试按钮 |
| Apply pending 部分失败 | Banner 显示"2/3 成功，1 失败"，失败项保留 pending 态 |
| 输入验证 | 内联 error text（不弹 toast） |
| Swipe 触发 | Haptic + toast "Marked as watch" + Undo 按钮 5s |
| 长耗时操作 | 骨架 + 进度百分比 |

**Undo 原则**：任何不可逆操作（mark、delete）必须有 5s Undo。Mobile 误触成本高。

---

## 8. Loading 策略

| 场景 | 展示 |
|---|---|
| 首次进入 Inbox | Shell 骨架 + 列表 shimmer |
| 切换 filter | 列表区域局部 shimmer，Shell 保持 |
| Item detail 打开 | 标题先显示（走路由 loader） + 内容 shimmer |
| Chat 发送中 | 消息气泡显示"Thinking..." + 光标闪烁 |
| Apply pending | 按钮内联 spinner，成功后消失 |

---

## 9. 手势冲突矩阵（iOS）

iOS 系统手势会抢先，需要避免冲突：

| 系统手势 | 冲突风险 | 处理 |
|---|---|---|
| 屏幕左边缘右滑 = 后退 | 卡片横滑 watch 容易误触发系统后退 | 列表最左侧 20px 保留系统手势区（禁用 drag） |
| 底部上滑 = Home | Sheet 的上滑关闭冲突 | Sheet 关闭用"下滑"代替 |
| 顶部下拉 = 通知中心 | Pull-to-refresh 冲突 | 触发阈值 > 80px，且只在列表顶部 |
| 双指捏合 = 缩放 | ❌ | meta viewport 禁用 `user-scalable=no` |

---

## 10. 验收清单

Step 3 完成后验证（真机 iOS Safari + Android Chrome 各一台）：

- [ ] 单手拇指能触达所有 EASY 区元素
- [ ] Swipe 阈值在 320px 和 414px 屏上感觉一致
- [ ] 键盘弹起不遮挡 chat 输入框
- [ ] 减弱动效开启后动画消失
- [ ] VoiceOver 朗读 TabBar / 卡片内容正确
- [ ] 系统左滑后退与 swipe dismiss 不冲突
- [ ] `prefers-color-scheme` 切换暗色正确
- [ ] 卡片 Undo toast 在 5s 内可撤销
