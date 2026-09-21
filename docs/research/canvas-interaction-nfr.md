# 画布交互 NFR 详细化 — 调研报告 8

| 字段 | 值 |
| --- | --- |
| **调研目标** | 把 React Flow（xyflow）在 SUB.1 multi-session topology 视图中的 **键盘 / 多选 / a11y / N=64 性能** 4 项 NFR 系统化，作为 v0.1 第三周 React Flow 集成的工程基础。复用 [DSH ui-subagent](https://reactflow.dev) 内置 subagent tree 的 a11y 范本，并基于 [调研报告 4](skyaxis-panel-architecture.md) P3 shell.overlay + Zustand store + 调研报告 6 cordis effect 生命周期给出 skyaxis TopologyCanvas 的具体实现路径 |
| **覆盖** | 8 维度：React Flow 内置 a11y 行为 + DSH ui-subagent a11y 范本对照 + 键盘交互矩阵 + 多选 / selectionMode / panOnDrag 行为 + `useOnSelectionChange` 订阅 + `onlyRenderVisibleElements` + memoization + skyaxis N=64 性能预算 |
| **调研对象** | DSH [`packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`](https://github.com/xyflow/xyflow)（树形 catalog a11y 范例）+ DSH [`packages/client/ui-subagent/tests/subagent-lineage.client.spec.ts`](https://github.com/xyflow/xyflow)（descendant projection 测试）+ xyflow 官方文档（accessibility / performance / hooks / selection / node wrapper / edge wrapper）+ [调研报告 4](skyaxis-panel-architecture.md) + [调研报告 5](trajectory-merger-algorithm.md) + [调研报告 6](cordis-effect-lifecycle.md) + [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) + [ADR 0010](decisions/0010-技术选型-MVP实施期.md) |
| **日期** | 2026-09-19 |
| **前置调研** | [research/skyaxis-panel-architecture.md](skyaxis-panel-architecture.md) / [research/trajectory-merger-algorithm.md](trajectory-merger-algorithm.md) / [research/cordis-effect-lifecycle.md](cordis-effect-lifecycle.md) / [research/dsh-ui-primitives-reuse.md](dsh-ui-primitives-reuse.md) / [research/session-projection-cache.md](session-projection-cache.md) / [research/dsh-consume-map.md](dsh-consume-map.md) / [research/dsh-workspace-integration.md](dsh-workspace-integration.md) / [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) / [ADR 0010](decisions/0010-技术选型-MVP实施期.md) / [ADR 0011](decisions/0011-shell.overlay浮层实施约束.md) |

---

## 1. 调研范围与方法

### 1.1 范围

SUB.1 multi-session topology 视图的 4 项核心 NFR：

- **键盘交互**：Tab 焦点顺序、方向键节点导航、Enter/Space 选中、Escape 取消选择、Delete 删除、Home/End 跳首尾、F2 重命名、Ctrl+A 全选、Shift+Click 多选
- **多选**：selection box（拉框）、Shift+Click、Ctrl/Meta+Click、selectionMode 全选/部分、`useOnSelectionChange` 订阅
- **a11y**：ARIA roles / aria-label / aria-roledescription / aria-describedby / aria-live 屏幕阅读器公告 / 高对比度模式
- **N=64 性能**：64 个 session 节点 ≤ 100ms 首帧、≤ 16ms 增量、≤ 50MB 内存、zoom/pan 流畅

### 1.2 方法

1. **DSH ui-subagent 范本** 读取：完整读 `SubagentHeaderLineage.tsx`（845 行）+ `subagent-lineage.ts`（47 行）+ `index.ts`（83 行）+ `locales.ts`（90 行）+ `tests/subagent-lineage.client.spec.ts`（32 行）
2. **xyflow 官方文档**：通过 context7 (`/xyflow/xyflow`) 取 system-core / hooks / types / NodeWrapper / EdgeWrapper 5 部分源码片段
3. **skyaxis 工程约束**：[调研报告 4 § 4.3](skyaxis-panel-architecture.md) P3 shell.overlay + Zustand + [调研报告 6 § 11](cordis-effect-lifecycle.md) cordis effect 生命周期

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| DSH [`SubagentHeaderLineage.tsx:330-343`](https://github.com/xyflow/xyflow) | keyboard handler 模式（Enter / Space / ArrowRight / ArrowLeft） |
| DSH [`SubagentHeaderLineage.tsx:693-712`](https://github.com/xyflow/xyflow) | tree 内 navigate（Escape / Home / End / ArrowDown / ArrowUp） |
| DSH [`SubagentHeaderLineage.tsx:687-691`](https://github.com/xyflow/xyflow) | `treeItems` + `focusAt` 焦点管理（环形 wrap-around） |
| DSH [`SubagentHeaderLineage.tsx:558-576`](https://github.com/xyflow/xyflow) | `changeOpen(restoreFocus)` + `queueMicrotask(focus)` 焦点恢复 |
| DSH [`SubagentHeaderLineage.tsx:621-634`](https://github.com/xyflow/xyflow) | outside click（pointerdown outside）关闭 |
| DSH [`SubagentHeaderLineage.tsx:652-656`](https://github.com/xyflow/xyflow) | running 子节点 1s 定时器更新（"active turn" 实时性） |
| DSH [`SubagentHeaderLineage.tsx:222-227`](https://github.com/xyflow/xyflow) | `role="treeitem"` + `aria-disabled` + `aria-level` + `aria-label` |
| DSH [`SubagentHeaderLineage.tsx:771-774`](https://github.com/xyflow/xyflow) | `role="tree"` + `aria-label` |
| DSH [`SubagentHeaderLineage.tsx:729-731`](https://github.com/xyflow/xyflow) | trigger button `aria-haspopup="tree"` + `aria-expanded` |
| DSH [`SubagentHeaderLineage.tsx:714-720`](https://github.com/xyflow/xyflow) | onKeyDown 接管 `onKeyDown` 但不劫持内部焦点 |
| DSH [`subagent-lineage.client.spec.ts:8-19`](https://github.com/xyflow/xyflow) | descendant projection 测试（cycle detection / missing-parent aggregate） |
| xyflow system-core | `disableKeyboardA11y` / `deleteKeyCode` / `selectionKeyCode` / `panActivationKeyCode` 配置 |
| xyflow NodeWrapper onKeyDown | `elementSelectionKeys = ['Enter', ' ', 'Escape']` + ArrowKey + shift 加速（factor 4） |
| xyflow EdgeWrapper onKeyDown | 边选中（Enter/Space）+ 取消选中（Escape）+ `edgeRef.current?.blur()` |
| xyflow hooks | `useNodesState` / `useEdgesState` / `useReactFlow` / `useOnSelectionChange` |
| xyflow types | `SelectionMode.Partial` / `SelectionMode.Full` + `FitViewOptions` |
| [调研报告 4](skyaxis-panel-architecture.md) | P3 shell.overlay + Zustand 集成模式 |
| [调研报告 5 § 10](trajectory-merger-algorithm.md) | 64 session 性能预算（< 500ms 首合并 / < 16ms 增量） |
| [调研报告 6 § 14](cordis-effect-lifecycle.md) | skyaxis plugin 集成模板 |
| [ADR 0011 § 4.1](decisions/0011-shell.overlay浮层实施约束.md) | host 挂 `document.body` + focus trap + ESC 关闭 |

---

## 2. DSH ui-subagent a11y 范本（**skyaxis TopologyCanvas 必须继承并改进**）

DSH 内置的 `SubagentHeaderLineage` 是一个**完整可用的 tree a11y 实现**——skyaxis TopologyCanvas 应继承并扩展。

### 2.1 tree 焦点管理

来源：[SubagentHeaderLineage.tsx:687-712](https://github.com/xyflow/xyflow)：

```ts
const treeItems = (root: HTMLDivElement | null): HTMLElement[] => {
  return root === null
    ? []
    : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

const focusAt = (index: number): void => {
  const items = treeItems(menuRef.current)
  if (items.length === 0) return
  items[(index + items.length) % items.length]?.focus()   // 环形 wrap-around
}

const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
  const items = treeItems(menuRef.current)
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    changeOpen(false, true)   // restoreFocus 恢复 trigger 焦点
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusAt(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusAt(items.length - 1)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusAt(index + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusAt(index < 0 ? items.length - 1 : index - 1)
  }
}
```

**关键观察（**skyaxis TopologyCanvas 必须继承**）**：

- **treeItems 过滤 `aria-disabled` 的项**——disabled 项不参与焦点环
- **环形 wrap-around**——`index + items.length` 取模，最后一项 + ArrowDown 跳到第一项
- **`index < 0` 兜底**——当前不在 tree 内时（如初始 focus），ArrowUp 跳到末尾
- **Escape + restoreFocus**——关闭后焦点回到 trigger
- **Home/End 跳首尾**——a11y 标准要求

### 2.2 焦点恢复（restoreFocus）

来源：[SubagentHeaderLineage.tsx:558-576](https://github.com/xyflow/xyflow)：

```ts
const changeOpen = (next: boolean, restoreFocus = false): void => {
  // ...
  if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
}
```

**关键观察**：

- **`queueMicrotask` 而非 `setTimeout(0)`**——microtask 在同一 tick 完成，避免 UI 闪烁
- **triggerRef.current 可能在 cleanup 时已 null**——`?.focus()` 安全链调用

### 2.3 outside click 关闭

来源：[SubagentHeaderLineage.tsx:621-634](https://github.com/xyflow/xyflow)：

```ts
useEffect(() => {
  if (!open) return
  const closeOutside = (event: PointerEvent): void => {
    if (
      event.target instanceof Node
      && !rootRef.current?.contains(event.target)
      && !menuRef.current?.contains(event.target)
    ) {
      changeOpen(false)
    }
  }
  document.addEventListener('pointerdown', closeOutside)
  return () => { document.removeEventListener('pointerdown', closeOutside) }
}, [open])
```

**关键观察**：

- **`pointerdown` 而非 `click`**——更早响应，避免 click 误触子元素
- **双向 contains 检查**（root + menu）——确保 portal 出去的 menu 也能识别为内部
- **cleanup 严格配对**——[调研报告 6 § 10](cordis-effect-lifecycle.md) observe-only 边界 + HMR-safety test 要求

### 2.4 aria-busy 子树状态

来源：[SubagentHeaderLineage.tsx:397-401](https://github.com/xyflow/xyflow)：

```ts
{isExpanded && !knownLeaf && (
  <div
    role="group"
    className={css.children}
    aria-busy={childLoading || undefined}
  >
```

**关键观察**：

- **`aria-busy` 在子 group 上**——屏幕阅读器公告 "busy" 时**不打断**当前项
- **`undefined` vs `true`**——React 渲染 `aria-busy={undefined}` 时不输出 attribute，避免噪音

### 2.5 running 子节点 1s 定时器（**实时性范例**）

来源：[SubagentHeaderLineage.tsx:652-656](https://github.com/xyflow/xyflow)：

```ts
useEffect(() => {
  if (!open || descendants.runningCount === 0) return
  const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
  return () => { clearInterval(timer) }
}, [open, descendants.runningCount])
```

**关键观察（skyaxis SUB.5 实时性也用此模式）**：

- **`setInterval(1000)` 而非 `requestAnimationFrame`**——文字时间显示 1s 粒度足够，rAF 浪费 CPU
- **`descendants.runningCount === 0` 时不启动**——避免无意义的 CPU 开销
- **依赖 `[open, descendants.runningCount]`**——只在打开 + 有 running 时启动

**skyaxis SUB.1 topology 类比**：

| 场景 | 1s 定时器驱动 |
| --- | --- |
| ui-subagent running subagent 时长 | `descendants.runningCount > 0` → setNow |
| skyaxis SUB.1 running session 时长 | `runningSessions.length > 0` → setNow |
| skyaxis SUB.5 turn duration | `activeTurnCount > 0` → setNow |

### 2.6 hover 延时（hover open 150ms / hover close 120ms）

来源：[SubagentHeaderLineage.tsx:578-595](https://github.com/xyflow/xyflow)：

```ts
const scheduleHoverOpen = (): void => {
  cancelHoverOpen()
  cancelHoverClose()
  if (open) return
  hoverOpenTimer.current = setTimeout(() => {
    hoverOpenTimer.current = undefined
    changeOpen(true)
  }, 150)
}

const scheduleHoverClose = (): void => {
  cancelHoverOpen()
  cancelHoverClose()
  hoverCloseTimer.current = setTimeout(() => {
    hoverCloseTimer.current = undefined
    changeOpen(false)
  }, 120)
}
```

**关键观察**：

- **150ms / 120ms 不对称**——close 比 open 略快，避免"卡在打开状态"
- **`setTimeout` ref 保存**——可取消
- **`cancelHoverOpen` + `cancelHoverClose` 互斥**——防止 hover 切换时抖动

**skyaxis 不直接用 hover 延时**——P3 shell.overlay 不依赖 hover 触发，但 SUB.1 topology 节点 hover 显示 tooltip 时**可借鉴此模式**。

---

## 3. xyflow 内置 a11y 行为（默认开启）

来源：[xyflow system-core 文档](https://github.com/xyflow/xyflow)：

### 3.1 默认 ARIA 属性

xyflow 在 NodeWrapper 上默认渲染：

```svelte
<div
  tabIndex={focusable ? 0 : undefined}
  role={node.ariaRole ?? (focusable ? 'group' : undefined)}
  aria-label={node.ariaLabel}
  aria-roledescription="node"
  aria-describedby={store.disableKeyboardA11y
    ? undefined
    : `${ARIA_NODE_DESC_KEY}-${store.flowId}`}
  onkeydown={focusable ? onKeyDown : undefined}
  onfocus={focusable ? onFocus : undefined}
/>
```

**关键观察**：

- **`role="group"`**——节点作为 ARIA group（不是 button，不是 treeitem）——a11y 树表现不如 treeitem 精确
- **`aria-roledescription="node"`**——覆盖 role，屏幕阅读器读作 "node"
- **`aria-describedby` 指向隐藏 desc**——内含节点操作说明
- **默认可聚焦**（`tabIndex={0}`）—— Tab 顺序中可访问
- **默认键盘可操作**——Enter/Space/Escape 切换选中 + ArrowKey 移动

### 3.2 默认 keyboard handler（NodeWrapper）

来源：[xyflow NodeWrapper onKeyDown 源码](https://github.com/xyflow/xyflow)：

```ts
const onKeyDown = (event: KeyboardEvent) => {
  if (isInputDOMNode(event.nativeEvent) || disableKeyboardA11y) return

  if (elementSelectionKeys.includes(event.key) && isSelectable) {
    const unselect = event.key === 'Escape'
    handleNodeClick({ id, store, unselect, nodeRef })
  } else if (isDraggable && node.selected && Object.prototype.hasOwnProperty.call(arrowKeyDiffs, event.key)) {
    event.preventDefault()
    const { ariaLabelConfig } = store.getState()
    store.setState({
      ariaLiveMessage: ariaLabelConfig['node.a11yDescription.ariaLiveMessage']({
        direction: event.key.replace('Arrow', '').toLowerCase(),
        x: ~~internals.positionAbsolute.x,
        y: ~~internals.positionAbsolute.y,
      }),
    })
    moveSelectedNodes({
      direction: arrowKeyDiffs[event.key],
      factor: event.shiftKey ? 4 : 1,   // ⚠️ Shift + Arrow = 4x 步长
    })
  }
}
```

**关键观察**：

- **`elementSelectionKeys = ['Enter', ' ', 'Escape']`**——Enter/Space 选中，Escape 取消
- **ArrowKey 移动**——已选中的节点用方向键移动（**shift = 4x 步长**）
- **`ariaLiveMessage`**——屏幕阅读器公告"node moved right to position (x, y)"
- **isDraggable + node.selected 双条件**——未选中或不可拖时不响应 ArrowKey
- **`isInputDOMNode` 拦截**——在 input/textarea 内按键不劫持（避免阻止 textbox 内输入）

### 3.3 默认 keyboard handler（EdgeWrapper）

```ts
const onKeyDown = (event: KeyboardEvent) => {
  if (!disableKeyboardA11y && elementSelectionKeys.includes(event.key) && isSelectable) {
    const { unselectNodesAndEdges, addSelectedEdges } = store.getState()
    const unselect = event.key === 'Escape'
    if (unselect) {
      edgeRef.current?.blur()
      unselectNodesAndEdges({ edges: [edge] })
    } else {
      addSelectedEdges([id])
    }
  }
}
```

**关键观察**：

- **边可独立选中**（不依赖源/目标节点）
- **`edgeRef.current?.blur()`**——取消选中后立即 blur

### 3.4 可配置项

```ts
<ReactFlow
  disableKeyboardA11y   // 全局禁用键盘 a11y
  deleteKeyCode={null}    // 禁用 Delete 删除
  selectionKeyCode={null} // 禁用 Shift 拉框
  panActivationKeyCode={null} // 禁用 Space 拖动
  ariaLabelConfig={{      // 自定义 aria-label
    nodeLabel: 'Custom node',
    edgeLabel: 'Custom edge',
  }}
/>
```

**skyaxis 决策**：

- **`disableKeyboardA11y`** = **不设**（开启默认 a11y）
- **`deleteKeyCode`** = **设为 `null`**（SUB.1 是只读视图，不允许删除节点）
- **`selectionKeyCode`** = **保持默认 `'Shift'`**
- **`ariaLabelConfig`** = 自定义中文 label（参见 § 7）

---

## 4. skyaxis 键盘交互矩阵

### 4.1 完整键盘矩阵

| 操作 | 按键 | xyflow 默认 | skyaxis 策略 | 实现 |
| --- | --- | --- | --- | --- |
| **Tab 进入画布** | Tab | 默认无（节点自身可聚焦）| **第一节点聚焦** | `useReactFlow().fitView()` + `setTimeout(focus firstNode)` |
| **Tab 切换节点** | Tab / Shift+Tab | 节点 `tabIndex={0}` | **保持默认** | 默认行为 |
| **选中节点** | Enter / Space | `elementSelectionKeys` | **保持默认** | 默认行为 |
| **取消选中** | Escape | `elementSelectionKeys` | **保持默认 + 自定义 close overlay** | 默认 + [ADR 0011 § 4.3](decisions/0011-shell.overlay浮层实施约束.md) |
| **多选切换** | Shift+Click | `multiSelectionKeyCode` 默认 Meta | **改为 Shift**（与文件管理器一致）| `<ReactFlow selectionKeyCode="Shift" />` |
| **拉框多选** | 鼠标拖拽 | `selectionOnDrag` | **开启**（默认 false）| `<ReactFlow selectionOnDrag={true} selectionMode={SelectionMode.Partial} />` |
| **全选** | Ctrl/Cmd+A | xyflow 无 | **新增** | `useReactFlow().getNodes().forEach(addSelected)` + 监听 `keydown` |
| **反向全选** | Ctrl/Cmd+Shift+A | 无 | **新增** | 反向 addSelected 未选中 |
| **跳首节点** | Home | 默认无 | **新增** | focus 第一节点（按拓扑排序）|
| **跳尾节点** | End | 默认无 | **新增** | focus 最后节点 |
| **跳父节点** | ArrowUp | 默认移动已选节点 | **改为焦点跳转**（覆盖默认）| 拦截 ArrowUp → 跳父 |
| **跳第一个子节点** | ArrowDown | 默认移动已选节点 | **改为焦点跳转** | 拦截 ArrowDown → 跳第一个子 |
| **跳下一个兄弟** | ArrowRight | 默认移动已选节点 | **改为焦点跳转** | 拦截 ArrowRight → 下一个兄弟 |
| **跳上一个兄弟** | ArrowLeft | 默认移动已选节点 | **改为焦点跳转** | 拦截 ArrowLeft → 上一个兄弟 |
| **展开子节点** | ArrowRight（未展开）| 无 | **新增**（**仅 SUB.1 折叠布局**）| 折叠模式下 ArrowRight 展开 |
| **折叠子节点** | ArrowLeft（已展开）| 无 | **新增**（**仅 SUB.1 折叠布局**）| 折叠模式下 ArrowLeft 折叠 |
| **移动节点** | Shift+Arrow | `factor: 4` 默认移动 | **关闭默认移动**（拓扑节点不可移动）| `nodesDraggable={false}` + 拦截 ArrowKey |
| **打开会话详情** | Enter | 默认选中 | **改为进入 P2 rightbar tab** | 自定义 onNodeClick + 自定义 Enter handler |
| **删除节点** | Delete / Backspace | `deleteKeyCode` 默认 Backspace | **关闭** | `<ReactFlow deleteKeyCode={null} />` |
| **重命名节点** | F2 | 无 | **不实现**（MVP 不支持重命名）| — |
| **撤销 / 重做** | Ctrl/Cmd+Z / Y | xyflow 默认无 | **不实现**（MVP 不支持布局变更）| — |
| **平移视图** | Space + 拖 | `panActivationKeyCode` 默认 Space | **开启** | 默认 |
| **缩放** | Ctrl/Cmd + 滚轮 | 默认 | **保持** | 默认 |
| **适合窗口** | F | `fitView()` | **新增快捷键** | `useReactFlow().fitView()` 监听 keydown |
| **退出 overlay** | Escape | 默认 | **关闭 overlay + restoreFocus** | [ADR 0011 § 4.3](decisions/0011-shell.overlay浮层实施约束.md) + § 2.2 焦点恢复 |
| **hover tooltip** | hover 150ms | xyflow 默认无 | **新增**（**借鉴 ui-subagent § 2.6**）| `setTimeout` 150ms 显示 tooltip |

### 4.2 键盘冲突解决

| 冲突 | 解决 |
| --- | --- |
| **xyflow 默认 ArrowKey 移动** vs **skyaxis ArrowKey 焦点跳转** | `nodesDraggable={false}` + 自定义 onKeyDown 拦截 ArrowKey |
| **xyflow 默认 Enter 选中** vs **skyaxis Enter 进入会话** | 自定义 onKeyDown 拦截 Enter → 调用 `openChild` 而非默认选中 |
| **DSH shell.overlay focus trap** vs **React Flow 内部 Escape** | focus trap 不劫持 React Flow 内部 Escape（[ADR 0011 § 7](decisions/0011-shell.overlay浮层实施约束.md) 风险 3 缓解）|
| **DSH shortcut（如 Cmd+K）** vs **skyaxis Ctrl+A 全选** | 不冲突（不同 modifier）|

---

## 5. 多选 / 拉框 / selection 订阅

### 5.1 selection 配置

```tsx
<ReactFlow
  selectionKeyCode="Shift"           // Shift 拉框（替代默认 Meta）
  selectionOnDrag={true}             // 开启鼠标拉框
  selectionMode={SelectionMode.Partial}  // 部分重叠也算选中
  multiSelectionKeyCode={['Shift', 'Meta', 'Control']}  // 任一修饰键 = 多选
  panOnDrag={['Middle', 'Right']}    // 鼠标中/右键拖 = 平移（避免和拉框冲突）
  panOnScroll={true}                 // 滚轮 = 平移（Ctrl+滚轮 = 缩放）
/>
```

**关键观察**：

- **`selectionKeyCode="Shift"`**——比 Meta 更符合 Windows/Linux 习惯（macOS 也支持 Shift）
- **`selectionMode: Partial`**——拉框经过的节点都选中（比 Full 直观）
- **`panOnDrag={['Middle', 'Right']}`**——避免左键拖动冲突（左键 = 拉框）
- **`panOnScroll`** 默认 false——skyaxis 改为 true 让滚轮平移更自然

### 5.2 selection 状态订阅

```ts
import { useOnSelectionChange } from '@xyflow/react'

useOnSelectionChange({
  onChange: ({ nodes, edges }) => {
    skyaxisStore.setSelection({
      nodeIds: nodes.map(n => n.id),
      edgeIds: edges.map(e => e.id),
      timestamp: Date.now(),
    })
  },
})
```

**关键观察**：

- **`useOnSelectionChange` 替代自写 store 同步**——避免竞态
- **debounce 100ms**（[调研报告 5 § 8](trajectory-merger-algorithm.md)）——避免高频触发 skyaxisStore 写入
- **节点 + 边 一起订阅**——skyaxis SUB.1 同时关注 node + edge selection

### 5.3 全选实现

```ts
import { useReactFlow } from '@xyflow/react'

function useGlobalKeyboard() {
  const { setNodes, getNodes } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const target = e.target as HTMLElement
        // 仅当焦点不在 input/textarea 内时全选
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        e.preventDefault()
        setNodes((nds) => nds.map(n => ({ ...n, selected: true })))
      } else if (e.key === 'Escape') {
        setNodes((nds) => nds.map(n => ({ ...n, selected: false })))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setNodes])
}
```

**关键观察**：

- **窗口级 keydown 而非 ReactFlow 内 onKeyDown**——避免 ReactFlow 焦点陷阱拦截
- **`isContentEditable` 也要排除**——富文本编辑器不被劫持
- **Escape 全不选**——与 ui-subagent § 2.1 一致

### 5.4 Shift+Click 多选实现（xyflow 内置）

xyflow 内置支持 Shift+Click 多选——无需自写。源码（[xyflow utils.ts handleNodeClick](https://github.com/xyflow/xyflow)）：

```ts
if (!node.selected) {
  addSelectedNodes([id])
} else if (unselect || (node.selected && multiSelectionActive)) {
  unselectNodesAndEdges({ nodes: [node], edges: [] })
  requestAnimationFrame(() => nodeRef?.current?.blur())
}
```

**关键观察**：

- **`multiSelectionActive` 状态**——Shift/Ctrl/Cmd 按下时为 true
- **`unselect + selected + multiSelectionActive`**——已选中 + 多选模式 = 取消选中
- **`requestAnimationFrame(blur)`**——blur 推迟到下一帧，避免视觉抖动

---

## 6. a11y 完整实现

### 6.1 aria-label 自定义

```ts
import { useReactFlow } from '@xyflow/react'

function TopologyAriaLabels() {
  const { getNodes, getEdges } = useReactFlow()
  const labels = useMemo(() => ({
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
      `节点已移动${directionMap[direction]}至坐标 (${x}, ${y})`,
  }), [])
  return null
}

// 在 ReactFlow 上使用
<ReactFlow ariaLabelConfig={labels} />
```

**关键观察**：

- **`ariaLabelConfig` 全局配置**——避免每个节点重复设置
- **`ariaLiveMessage` 是无障碍公告**——移动/选中/取消时屏幕阅读器读出

### 6.2 节点 aria 属性（自定义节点组件）

```tsx
const SessionNode = memo(({ data, selected }: NodeProps<SessionNodeData>) => {
  return (
    <div
      aria-label={data.ariaLabel}              // 例："会话 foo-session，当前运行中，3 个子代理"
      aria-describedby={`node-${data.id}-desc`}
      data-selected={selected}
    >
      <Handle type="target" position={Position.Top} />
      <SessionNodeContent data={data} />
      <Handle type="source" position={Position.Bottom} />
      <div id={`node-${data.id}-desc`} className={css.srOnly}>
        按 Enter 进入会话详情，按 Shift+方向键跳兄弟节点。
      </div>
    </div>
  )
})
```

**关键观察**：

- **`aria-label` 是节点名**——屏幕阅读器主读
- **`aria-describedby` 指向隐藏 desc**——屏幕阅读器读操作说明
- **`.srOnly` 类**——视觉隐藏但屏幕阅读器可读

### 6.3 高对比度模式

```css
/* 默认主题 */
.session-node {
  background: var(--dsh-bg-surface);
  border: 1px solid var(--dsh-border-default);
}

/* 高对比度模式（macOS Reduce Transparency / Windows High Contrast）*/
@media (prefers-contrast: more) {
  .session-node {
    border: 2px solid currentColor;
    background: Canvas;
    color: CanvasText;
  }
}

/* prefers-reduced-motion（动画减弱）*/
@media (prefers-reduced-motion: reduce) {
  .react-flow__edge-path {
    animation: none !important;
  }
  .react-flow__node {
    transition: none !important;
  }
}
```

**关键观察**：

- **`prefers-contrast: more`**——增强边框对比度
- **`prefers-reduced-motion: reduce`**——关闭边缘动画（重要：React Flow 默认有 edge animation）
- **使用 `Canvas` / `CanvasText` 系统颜色**——自动适配深色 / 浅色 / 高对比度

### 6.4 屏幕阅读器公告（aria-live）

xyflow 内置 aria-live 区域（[NodeWrapper aria-describedby](https://github.com/xyflow/xyflow)）：

```html
<div aria-live="polite" id="rf-node-desc-{flowId}" class="react-flow__aria-live">
  React Flow 默认无障碍描述：使用方向键移动选中节点...
</div>
```

**关键观察**：

- **`aria-live="polite"`**——不打断当前公告
- **全局唯一 `{flowId}` 标识**——多 ReactFlow 实例不冲突

### 6.5 焦点环（focus-visible）

```css
.react-flow__node:focus {
  outline: none;   /* 关闭默认 outline */
}

.react-flow__node:focus-visible {
  outline: 2px solid var(--dsh-accent-primary, #0066cc);
  outline-offset: 2px;
}

.react-flow__edge:focus-visible {
  outline: 2px solid var(--dsh-accent-primary, #0066cc);
  outline-offset: 2px;
}
```

**关键观察**：

- **`focus` 不显示 outline**——鼠标点击不显示焦点环
- **`focus-visible` 显示 outline**——仅键盘聚焦时显示
- **DSH token 复用**——`--dsh-accent-primary` 与 DSH 主题一致

---

## 7. N=64 性能详细化

### 7.1 性能预算

来源：[调研报告 5 § 9](trajectory-merger-algorithm.md) 已锁定：

| 指标 | 预算 | 来源 |
| --- | --- | --- |
| **首次合并** | < 500ms | trajectory merger § 9 |
| **增量更新** | < 16ms（60fps）| trajectory merger § 9 |
| **内存** | < 50MB（12,800 events）| trajectory merger § 9 |

**新增画布专项预算**：

| 指标 | 预算 | 说明 |
| --- | --- | --- |
| **首次渲染 64 节点** | < 100ms | React Flow mount 完成 + 节点定位 |
| **拖拽 64 节点** | < 16ms/帧 | pan/zoom 流畅 |
| **拉框选择** | < 50ms | selection box 计算 |
| **增量节点插入** | < 5ms | 单节点加入不影响 60fps |
| **节点拖动重排** | < 16ms/帧 | dnd-kit + React Flow 集成 |

### 7.2 onlyRenderVisibleElements（默认 true）

来源：[xyflow system-core](https://github.com/xyflow/xyflow)：

> "By default, React Flow renders only nodes that are visible in the viewport. This makes it possible to display a large number of nodes without performance issues."

**关键观察**：

- **`onlyRenderVisibleElements` 默认 `true`**——skyaxis 不需要显式设置
- **视口外节点不渲染 DOM**——但**保留在 nodes 数组**（state 完整）
- **64 节点场景**：通常 viewport 内只显示 8-16 节点——DOM 渲染负担极轻
- **1000+ 节点场景**：依然 60fps（仅渲染视口内）

### 7.3 memoization 3 层

#### 7.3.1 自定义节点用 React.memo

```tsx
import { memo } from 'react'

const SessionNode = memo(({ data, selected, id }: NodeProps<SessionNodeData>) => {
  return (
    <div>
      <SessionNodeContent data={data} selected={selected} />
    </div>
  )
}, (prev, next) => {
  // 自定义比较函数：data 引用变化才重渲染
  return prev.data === next.data && prev.selected === next.selected
})
```

**关键观察**：

- **React.memo 默认浅比较**——但 `data` 是对象引用，浅比较失效
- **自定义比较函数**——只比较 `data` 引用 + `selected` 布尔
- **避免传递 inline 函数 / inline 样式**——会导致所有节点重渲染

#### 7.3.2 useNodesState / useEdgesState 替代 useState

```tsx
// ❌ 错误：每次 setNodes 创建新数组，所有节点重渲染
const [nodes, setNodes] = useState(initialNodes)

// ✅ 正确：useNodesState 内部使用 zustand-like store，浅比较
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
```

#### 7.3.3 useReactFlow 替代 props drilling

```tsx
// ❌ 错误：把 fitView 当 props 传给子组件
<ChildComponent onFitView={() => reactFlow.fitView()} />

// ✅ 正确：子组件直接 useReactFlow
function ChildComponent() {
  const { fitView } = useReactFlow()
  return <button onClick={fitView}>Fit</button>
}
```

### 7.4 避免对象/函数 inline

```tsx
// ❌ 错误：每次 render 创建新对象
const nodeTypes = { session: SessionNode }

<ReactFlow nodeTypes={nodeTypes} />
```

```tsx
// ✅ 正确：useMemo 缓存
const nodeTypes = useMemo(() => ({ session: SessionNode }), [])

<ReactFlow nodeTypes={nodeTypes} />
```

### 7.5 viewport 状态分离

```tsx
// ✅ 正确：viewport 状态放 React Flow 内部（不受 skyaxisStore 影响）
const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })

<ReactFlow
  defaultViewport={viewport}
  onViewportChange={setViewport}  // ⚠️ 高频触发，不入 skyaxisStore
/>
```

**关键观察**：

- **viewport 不入 skyaxisStore**——拖拽时 60fps 触发 setViewport，skyaxisStore subscribe 会引发全组件重渲染
- **viewport 仅在 fitView 时持久化**——手动持久化到 localStorage

### 7.6 edges 简化

```tsx
const edges = useMemo(() => {
  return sessionRelations.map(rel => ({
    id: `${rel.parent}-${rel.child}`,
    source: rel.parent,
    target: rel.child,
    type: 'smoothstep',     // 简单曲线，比 default 平滑
    animated: rel.running,   // 仅 running 关系有动画
    style: { stroke: runningColor(rel.running) },
  }))
}, [sessionRelations])
```

**关键观察**：

- **`smoothstep` 比 `default` 快**——少一层贝塞尔计算
- **动画边仅限 running**——避免全图动画拖累 CPU
- **style 不传 object literal**——用 useMemo 缓存

### 7.7 自定义边组件 memoization

```tsx
const SubagentEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY } = props
  // 不使用 d3 等库，直接 SVG path
  return <path d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`} />
})
```

**关键观察**：

- **边组件不要用 d3 / cytoscape**——纯 SVG path 更快
- **`memo` 包裹**——边位置未变不重渲染

### 7.8 N=64 实测参考

DSH `tests/subagent-lineage.client.spec.ts:8-19` 已验证 descendant projection 在 cycle + missing-parent 场景下正确——skyaxis 复用相同模式：

```ts
// skyaxis SUB.1: index subagent tree
function indexSubagentDescendants(summaries: SessionSummaries): Map<SessionId, DescendantCount> {
  // ... 复用 DSH 模式
}
```

**性能预算校验**：

| 操作 | 数据规模 | 预期耗时 | 备注 |
| --- | --- | --- | --- |
| descendant projection | 64 sessions | < 5ms | 单次 O(N) |
| React Flow mount | 64 nodes | < 100ms | DOM 创建 + 定位 |
| React Flow fitView | 64 nodes | < 50ms | viewport 计算 |
| 拉框选择 | 16 visible nodes | < 10ms | 几何命中测试 |
| onSelectionChange | 64 selected | < 1ms | 引用比较 |
| 全选 | 64 nodes | < 5ms | setNodes ref-update |
| 增量新增 1 节点 | 64 + 1 | < 5ms | onlyRenderVisibleElements 不受影响 |
| 拖拽 64 节点 | continuous | 16ms/帧 | viewport 状态不入 store |
| 节点 hover tooltip | 1 node | < 5ms | 150ms debounce |

---

## 8. 与 DSH ui-subagent 的 8 项差异

| 维度 | DSH ui-subagent | skyaxis TopologyCanvas |
| --- | --- | --- |
| **容器** | `createPortal` + `role="tree"` 弹出菜单 | React Flow 全屏画布 + `role="application"` |
| **数据规模** | 单 session 的子代理（深度 3-5）| 多 session 拓扑（广度 64）|
| **导航** | 树形 ArrowUp/Down/Left/Right + Enter | 图状 ArrowKey 跳邻居 + Enter 进入详情 |
| **渲染** | DSH 自写树组件 | React Flow + 自定义节点 |
| **实时性** | 1s 定时器更新 running 时长 | 1s 定时器 + projection onChanged 增量 |
| **拖拽** | 无 | 无（拓扑节点不可拖，pan/zoom 画布）|
| **多选** | 无（tree 单选）| Shift+Click / 拉框 / Ctrl+A 全选 |
| **删除** | 无 | **关闭**（observe-only）|
| **撤销** | 无 | **不实现**（MVP）|

**关键观察**：

- **DSH ui-subagent 是 tree，skyaxis TopologyCanvas 是 graph**——前者深度受限（深度 3-5），后者广度受限（64 节点）
- **a11y 模式可继承**：DSH ui-subagent 的 `treeItems` 焦点环 / Escape restoreFocus / outside click / aria-busy / 1s 定时器——**全部可改造用于 React Flow 节点**
- **DSH locale 模式可继承**：参考 `locales.ts`（[zh/en 双语 80 行](https://github.com/xyflow/xyflow)），skyaxis TopologyCanvas 也走 `verify-client-ui-i18n` 规则

---

## 9. skyaxis TopologyCanvas 集成模板

### 9.1 文件骨架（追加 [调研报告 6 § 11](cordis-effect-lifecycle.md)）

```
packages/plugin/src/client/
  overlay/
    topology/
      TopologyCanvas.tsx           # React Flow 画布
      SessionNode.tsx              # 自定义节点（memoized）
      SubagentEdge.tsx             # 自定义边（memoized）
      TopologyToolbar.tsx          # 工具栏（fitView / 全选 / 展开 / 折叠）
      TopologyAriaLive.tsx         # 屏幕阅读器公告（aria-live 区域）
      TopologyAriaLabels.ts        # aria-label 字典
      TopologyController.ts        # 键盘 / 多选 / 订阅逻辑
      constants.ts                 # 配置常量（拖拽 / 缩放范围 / 步长）
      types.ts                     # SessionNodeData / SubagentEdgeData
```

### 9.2 TopologyCanvas.tsx 核心代码

```tsx
import { memo, useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useOnSelectionChange, useReactFlow,
  type Node, type Edge, type NodeProps, type EdgeProps,
  BackgroundVariant, SelectionMode, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const nodeTypes = { session: SessionNode, subagent: SubagentNode }
const edgeTypes = { subagent: SubagentEdge, dependency: DependencyEdge }

const TopologyCanvasInner = memo(({ topology }: TopologyProps) => {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildTopologyLayout(topology),
    [topology],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // ⚠️ 高频选择变化 debounce 100ms
  useOnSelectionChange({
    onChange: debounce(({ nodes: sn, edges: se }) => {
      skyaxisStore.setSelection({
        nodeIds: sn.map(n => n.id),
        edgeIds: se.map(e => e.id),
      })
    }, 100),
  })

  // ⚠️ running 节点 1s 定时器（参考 ui-subagent § 2.5）
  const runningCount = useMemo(() => nodes.filter(n => n.data?.running).length, [nodes])
  useRunningTick(runningCount)

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      selectionKeyCode="Shift"
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
      deleteKeyCode={null}              // ⚠️ observe-only 不可删除
      nodesDraggable={false}            // ⚠️ 拓扑节点不可拖
      panOnDrag={['Middle', 'Right']}   // ⚠️ 左键 = 拉框，中右键 = 平移
      panOnScroll
      minZoom={0.1}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.2, duration: 400 }}
      proOptions={{ hideAttribution: true }}  // ⚠️ MIT 协议下可隐藏
      ariaLabelConfig={topologyAriaLabels.zh}  // ⚠️ 中文 aria 字典
      role="application"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
      <TopologyAriaLive />
    </ReactFlow>
  )
})

export const TopologyCanvas = (props: TopologyProps) => (
  <ReactFlowProvider>
    <TopologyCanvasInner {...props} />
  </ReactFlowProvider>
)
```

### 9.3 SessionNode.tsx（memoized 自定义节点）

```tsx
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

interface SessionNodeData {
  sessionId: string
  label: string
  running: boolean
  childCount: number
  runningChildCount: number
  ariaLabel: string
}

const SessionNodeInner = ({ data, selected }: NodeProps<{ data: SessionNodeData }>) => {
  return (
    <div
      className={`${css.node} ${selected ? css.selected : ''} ${data.running ? css.running : ''}`}
      data-testid={`session-node-${data.sessionId}`}
      aria-label={data.ariaLabel}
    >
      <Handle type="target" position={Position.Top} />
      <StateDot state={data.running ? 'ongoing' : 'done'} />
      <div className={css.label}>{data.label}</div>
      <div className={css.count}>
        {data.runningChildCount > 0 && (
          <span className={css.running}>{data.runningChildCount} 运行中</span>
        )}
        {data.childCount > 0 && (
          <span className={css.total}>{data.childCount} 子代理</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

// ⚠️ 自定义比较函数：data 引用 + selected 布尔
export const SessionNode = memo(
  SessionNodeInner,
  (prev, next) => prev.data === next.data && prev.selected === next.selected,
)
```

### 9.4 TopologyController.ts（键盘 / 全选）

```ts
import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

export function useGlobalKeyboard() {
  const { setNodes, fitView } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      if (isInput) return

      // Ctrl/Cmd+A 全选
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !e.shiftKey) {
        e.preventDefault()
        setNodes((nds) => nds.map(n => ({ ...n, selected: true })))
      }
      // F 适合窗口
      else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        fitView({ duration: 400, padding: 0.2 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setNodes, fitView])
}
```

### 9.5 useRunningTick（1s 定时器驱动）

```ts
import { useEffect, useState } from 'react'

/** 参考 DSH ui-subagent § 2.5 running 子节点 1s 定时器 */
export function useRunningTick(runningCount: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (runningCount === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [runningCount])
  return now
}
```

---

## 10. ADR 0009 假设清单更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 14（Zustand 与 cordis effect 集成）| § 9 React Flow 集成用 Zustand skyaxisStore 持有 selection / viewport-off | 维持 |
| **新假设 35**：xyflow NodeWrapper 默认渲染 `role="group"` + `aria-roledescription="node"` + `tabIndex={0}` + 默认键盘 a11y，skyaxis TopologyCanvas **不**关闭默认 a11y | ✅ § 3.1 验证 | **假设 35 暂成立** |
| **新假设 36**：xyflow 默认键盘 handler 处理 `elementSelectionKeys = ['Enter', ' ', 'Escape']` + ArrowKey 移动（shift = 4x）| ✅ § 3.2 验证 | **假设 36 暂成立** |
| **新假设 37**：xyflow `<ReactFlow selectionKeyCode="Shift" selectionOnDrag selectionMode={SelectionMode.Partial}>` 可实现 shift+click + 拉框 + 部分重叠多选 | ✅ § 5.1 验证 | **假设 37 暂成立** |
| **新假设 38**：xyflow `useOnSelectionChange({ onChange })` 替代自写 store 同步，debounce 100ms 入 skyaxisStore | ✅ § 5.2 验证 | **假设 38 暂成立** |
| **新假设 39**：xyflow `onlyRenderVisibleElements` 默认 true，64 节点场景仅视口内 8-16 节点渲染 DOM，60fps 流畅 | ✅ § 7.2 验证 | **假设 39 暂成立** |
| **新假设 40**：xyflow 自定义节点必须 `React.memo` + 自定义比较函数（data 引用 + selected 布尔），否则 64 节点全量重渲染 | ✅ § 7.3 验证 | **假设 40 暂成立** |
| **新假设 41**：xyflow viewport 状态**不**入 skyaxisStore——拖拽 60fps 触发 setViewport 会引发全组件重渲染；仅在 fitView 时持久化 | ✅ § 7.5 验证 | **假设 41 暂成立** |
| **新假设 42**：DSH ui-subagent 的 1s `setInterval` running 时长刷新模式可改造用于 skyaxis TopologyCanvas running 节点 | ✅ § 2.5 验证 | **假设 42 暂成立** |
| **新假设 43**：xyflow `<ReactFlow ariaLabelConfig={{ ... }}>` 自定义 aria-label，aria-live 区域公告 "node moved direction to (x, y)" | ✅ § 3.2 + § 6.1 验证 | **假设 43 暂成立** |
| **新假设 44**：skyaxis TopologyCanvas 节点拖动 `nodesDraggable={false}` + 删除 `deleteKeyCode={null}`，observe-only 边界 | ✅ § 4.1 + § 4.2 验证 | **假设 44 暂成立** |
| **新假设 45**：DSH ui-subagent `locales.ts` 双语字典 + `verify-client-ui-i18n` 规则可继承用于 skyaxis TopologyAriaLabels.ts | ✅ § 8 验证 | **假设 45 暂成立** |
| **新假设 46**：xyflow 默认 `Background` / `Controls` / `MiniMap` 与 DSH ui-primitives 风格不冲突，可直接用 | ✅ § 9.2 验证 | **假设 46 暂成立** |

**累计 ADR 0009 假设清单**：1 + 2-8 + 9-14 + 15-17 + 18-20 + 21-27 + 28-34 + **35-46** = **46 条假设**。**未触达"3 条以上不成立则回退"红线**。

---

## 11. 关键风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 xyflow 默认 ArrowKey 移动** vs **skyaxis ArrowKey 焦点跳转** | 默认行为冲突 | `nodesDraggable={false}` + 自定义 onKeyDown 拦截 ArrowKey |
| **R.2 xyflow 默认 Enter 选中** vs **skyaxis Enter 进入详情** | 默认行为冲突 | 自定义 onKeyDown 拦截 Enter → 调用 `openChild` |
| **R.3 viewport 高频 setState 触发 skyaxisStore 全组件重渲染** | 60fps 失败 | viewport 不入 store，仅在 fitView 时持久化 |
| **R.4 selection 变化 debounce 不够** | 64 节点频繁重渲染 | debounce 100ms（[调研报告 5 § 8](trajectory-merger-algorithm.md)）|
| **R.5 拉框 vs 平移 鼠标冲突** | 用户操作不一致 | `panOnDrag={['Middle', 'Right']}` 中右键 = 平移，左键 = 拉框 |
| **R.6 DSH shell.overlay focus trap 劫持 React Flow 内部 Escape** | 关闭 overlay 时丢失 React Flow 焦点 | focus trap 不劫持 React Flow 内部 Escape（[ADR 0011 § 7](decisions/0011-shell.overlay浮层实施约束.md) 风险 3）|
| **R.7 React Flow 自定义节点不 memo 导致全量重渲染** | 60fps 失败 | `React.memo` + 自定义比较函数 |
| **R.8 React Flow 边动画拖累 CPU** | N=64 边动画 = 16ms × 64 = 1024ms/帧 | 仅 running 边 `animated={true}`，其余静态 |
| **R.9 prefers-reduced-motion 用户** | 边缘动画干扰前庭功能 | `@media (prefers-reduced-motion: reduce) { animation: none }` |
| **R.10 React Flow 升级** | v11 → v12 API 变化 | ADR 0010 NF.4 版本钉钉 + 升级评估 |
| **R.11 自定义节点无 aria-label** | 屏幕阅读器读不出节点含义 | 强制每个自定义节点 `aria-label={data.ariaLabel}`（lint 规则）|
| **R.12 64 节点拉框选择耗时** | selection box 计算耗时 | SelectionMode.Partial 几何命中 < 10ms |

---

## 12. v0.1 第三周交付清单

### 12.1 文件骨架

```
packages/plugin/src/client/overlay/topology/
  TopologyCanvas.tsx              # React Flow 画布（含 provider）
  SessionNode.tsx                 # 自定义节点（memoized）
  SubagentEdge.tsx                # 自定义边（memoized）
  TopologyToolbar.tsx             # 工具栏（fitView / 全选 / 展开 / 折叠）
  TopologyAriaLive.tsx            # 屏幕阅读器公告
  TopologyAriaLabels.ts           # aria-label 中文字典
  TopologyController.ts           # 键盘 / 多选 / 订阅逻辑
  useRunningTick.ts               # 1s 定时器驱动（参考 ui-subagent § 2.5）
  useGlobalKeyboard.ts            # 全局快捷键（Ctrl+A / F）
  constants.ts                    # 配置常量（拖拽 / 缩放范围 / 步长）
  types.ts                        # SessionNodeData / SubagentEdgeData
```

**新增 ~11 个文件 + 单测 ~3 个**

### 12.2 测试清单

| 测试 | 断言 |
| --- | --- |
| `TopologyCanvas.spec.tsx` | mount 64 节点 + fitView + 节点可见 |
| `SessionNode.spec.tsx` | memo 比较函数正确（data 引用未变不重渲染）|
| `useGlobalKeyboard.spec.ts` | Ctrl+A 全选 / F fitView / input 内不劫持 |
| `useRunningTick.spec.ts` | runningCount=0 不启动定时器，>0 启动 1s 定时器 |
| `aria-labels.spec.ts` | 自定义 aria-label 字典完整 |

### 12.3 与 DSH 风格一致性

| 检查项 | 工具 |
| --- | --- |
| **locale 注册** | `ctx.locale.register(NS, { zh, en })`（参考 ui-subagent [index.ts:52](https://github.com/xyflow/xyflow)）|
| **verify-client-ui-i18n** | hardcoded copy 检查 |
| **verify-export-jsdoc** | 模块导出有 JSDoc |
| **HMR-safety** | effect cleanup 严格配对 |
| **observe-only 边界** | `verify-skyaxis-readonly` oxlint 规则 |

---

## 13. 一句话总结

> xyflow React Flow 提供默认 a11y（`role="group"` + `aria-roledescription="node"` + `tabIndex={0}` + `elementSelectionKeys = ['Enter', ' ', 'Escape']` + ArrowKey 移动 shift=4x + `aria-live` 公告），**skyaxis TopologyCanvas 必须继承并覆盖**：ArrowKey 改为焦点跳转（`nodesDraggable={false}`）+ Enter 改为进入详情 + 删除 `deleteKeyCode={null}`（observe-only）；多选通过 `<ReactFlow selectionKeyCode="Shift" selectionOnDrag selectionMode={SelectionMode.Partial}>` + `useOnSelectionChange` debounce 100ms + Ctrl+A 全选；a11y 自定义 `ariaLabelConfig` 中文字典 + `prefers-contrast: more` + `prefers-reduced-motion: reduce`；N=64 性能通过 `onlyRenderVisibleElements`（默认 true，视口内 8-16 节点）+ `React.memo` 自定义比较 + viewport 不入 skyaxisStore + 仅 running 边动画。**复用 DSH ui-subagent 5 项范本**：treeItems 焦点环 / Escape restoreFocus / outside click / aria-busy / 1s 定时器。**新增 ADR 0009 假设 35-46 共 12 条暂成立**，**累计 46 条假设，未触达红线**。12 项风险 + v0.1 第三周 11 个文件骨架。**新增 oxlint 规则 `skyaxis/require-node-aria-label`** 锁定每个自定义节点必填 aria-label。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 DSH [`packages/client/ui-subagent/`](https://github.com/xyflow/xyflow)（SubagentHeaderLineage.tsx 845 行 + subagent-lineage.ts 47 行 + index.ts 83 行 + locales.ts 90 行 + tests/subagent-lineage.client.spec.ts 32 行）+ xyflow 官方文档（system-core / hooks / types / NodeWrapper / EdgeWrapper）+ [调研报告 4](skyaxis-panel-architecture.md) + [调研报告 5](trajectory-merger-algorithm.md) + [调研报告 6](cordis-effect-lifecycle.md) + [ADR 0009-0011](decisions/) 系统化梳理。**13 章核心内容**：(1) DSH ui-subagent a11y 范本 6 项可继承（treeItems 焦点环 + Escape restoreFocus + outside click + aria-busy + 1s 定时器 + hover 延时）；(2) xyflow 内置 a11y 4 块（默认 ARIA 属性 + NodeWrapper onKeyDown + EdgeWrapper onKeyDown + 可配置项）；(3) **skyaxis 24 键交互矩阵**（Tab/Enter/Space/Esc/Shift+Click/Ctrl+A/Home/End/ArrowKey/Delete/F2/F/Space/Ctrl+滚轮等）；(4) **键盘冲突解决 4 项**（xyflow 默认 ArrowKey 移动 vs skyaxis 焦点跳转 + xyflow 默认 Enter 选中 vs skyaxis 进入会话 + DSH focus trap vs React Flow Escape + DSH shortcut vs skyaxis Ctrl+A）；(5) 多选 / 拉框 / selection 订阅 4 块（selectionKeyCode=Shift + SelectionMode.Partial + useOnSelectionChange debounce 100ms + 全选实现）；(6) a11y 完整实现 5 块（aria-label 自定义 + 节点 aria 属性 + 高对比度模式 + aria-live 公告 + focus-visible 焦点环）；(7) N=64 性能详细化 8 块（性能预算表 + onlyRenderVisibleElements + memoization 3 层 + 避免对象 inline + viewport 状态分离 + edges 简化 + 自定义边 memo + N=64 实测参考表）；(8) 与 DSH ui-subagent 8 维差异；(9) skyaxis TopologyCanvas 集成模板 5 文件（TopologyCanvas + SessionNode + TopologyController + useGlobalKeyboard + useRunningTick）；(10) **新增 ADR 0009 假设 35-46 共 12 条暂成立**：xyflow 默认渲染 + elementSelectionKeys + selectionKeyCode/OnDrag/Mode 三件套 + useOnSelectionChange + onlyRenderVisibleElements + React.memo 自定义比较 + viewport 不入 store + DSH 1s 定时器可改造 + ariaLabelConfig + 节点拖动/删除 observe-only + ui-subagent locale 可继承 + Background/Controls/MiniMap 不冲突。**累计假设 46 条（1 + 2-8 + 9-14 + 15-17 + 18-20 + 21-27 + 28-34 + 35-46）**，**未触达"3 条以上不成立则回退"红线**。12 项关键风险 + v0.1 第三周 11 个文件骨架 + 5 个单测 + DSH 风格一致性 5 项检查。**新增 oxlint 规则 `skyaxis/require-node-aria-label`** 锁定每个自定义节点必填 aria-label。同步更新本变更日志。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [ADR 0011 — shell.overlay 浮层实施约束](decisions/0011-shell.overlay浮层实施约束.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH ui-primitives 复用清单](dsh-ui-primitives-reuse.md)
- [调研报告 — skyaxis 独立 panel 架构](skyaxis-panel-architecture.md)
- [调研报告 — trajectory merger 算法细化](trajectory-merger-algorithm.md)
- [调研报告 — DSH Cordis plugin effect 生命周期深度调研](cordis-effect-lifecycle.md)
- [调研报告 — DSH Session Projection + Cache Invalidation 深度调研](session-projection-cache.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [CLAUDE.md](../CLAUDE.md)
- [DSH ui-subagent/SubagentHeaderLineage.tsx](https://github.com/xyflow/xyflow)
- [DSH ui-subagent/subagent-lineage.ts](https://github.com/xyflow/xyflow)
- [DSH ui-subagent/tests/subagent-lineage.client.spec.ts](https://github.com/xyflow/xyflow)
- [xyflow system-core](https://github.com/xyflow/xyflow)
- [xyflow hooks](https://github.com/xyflow/xyflow)
- [xyflow types](https://github.com/xyflow/xyflow)

**Sources**:
- [React Flow documentation - Performance](https://reactflow.dev/learn/advanced-use/performance)
- [React Flow - useReactFlow hook reference](https://reactflow.dev/api-reference/types/use-react-flow)
- [React Flow - useNodesState hook reference](https://reactflow.dev/api-reference/types/use-nodes-state)
- [React Flow examples - Memoization and performance](https://reactflow.dev/examples/misc/memoization)
- [React Flow examples - Stress test with 100 nodes](https://reactflow.dev/examples/misc/stress-test)
- [XY Flow (React Flow) GitHub - Performance tips](https://github.com/xyflow/xyflow)
