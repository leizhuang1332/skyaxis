# skyaxis 独立 panel 架构详细设计 — 调研报告

| 字段 | 值 |
| --- | --- |
| **调研目标** | 在 DSH 已有的 slot / dock / sidebar-right / main panel 4 套挂入机制下，给 skyaxis 选 1 个挂入位置 + 详细架构设计 |
| **覆盖** | DSH UI 挂入机制盘点（slot / dock / main / rightbar / header）/ skyaxis 挂入点 4 候选对照 / 独立 store + navigation 设计 / 与 DSH ui-subagent 差异 / ADR 0009 假设验证 |
| **调研对象** | [`deepseek-harness/packages/client/`](../deepseek-harness/packages/client/) 17 个 ui-* 包 + `vendor/cordis/` slots 实现 + `packages/client/ui-layout/` + `packages/client/ui-dockkit/`，只读访问 |
| **日期** | 2026-09-19 |
| **前置调研** | [research/dsh-consume-map.md](dsh-consume-map.md) / [research/dsh-workspace-integration.md](dsh-workspace-integration.md) / [research/dsh-ui-primitives-reuse.md](dsh-ui-primitives-reuse.md) |

---

## 1. 调研范围与方法

### 1.1 范围

锁定 skyaxis 在 DSH Web profile 内**怎么挂入**，覆盖：

- DSH 4 套挂入机制盘点（slot / dock / main / rightbar / header corner）
- skyaxis 挂入点 4 候选对照（main panel / rightbar tab / conversation header corner / 独立声明新 slot）
- 独立 store + navigation 架构设计
- 与 DSH ui-subagent（slot 内嵌型）的差异分析

**不**研究：

- 拓扑图 React Flow 内部（已锁 [ADR 0010](decisions/0010-技术选型-MVP实施期.md)）
- 6 只读服务消费细节（已锁 [research/dsh-consume-map.md](dsh-consume-map.md)）

### 1.2 方法

只读访问 17 个 `packages/client/ui-*/` 包的 `index.ts` + `AppFrame.tsx` + `service.ts` + `DockSurface.tsx` + ui-dockkit 整套 contract。提取 4 套挂入机制的入口、声明形态、scope 生命周期、navigation 模型。

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| [`packages/client/ui-layout/src/client/index.ts`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts) | Frame 4 套子 slot 声明（sidebar / main / rightbar / shell.overlay）+ ILayout |
| [`packages/client/ui-layout/src/client/AppFrame.tsx`](../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx) | 三列布局 + main panel renderSlot('main', {entryKey: panelId}) |
| [`packages/client/ui-layout/src/client/service.ts`](../deepseek-harness/packages/client/ui-layout/src/client/service.ts) | `ILayout.selectPanel(panelId)` / `openRightbar(track, fullscreen)` |
| [`packages/client/ui-subagent/src/client/index.ts`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts) | **slot 内嵌型范本**（conversation.session.header.lineage + composer）|
| [`packages/client/ui-sidebar-right/src/client/index.ts`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts) | **rightbar 2 阶段注册**范本（tab type → tab body）|
| [`packages/client/ui-dockkit/src/contract/types.ts`](../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts) | Dock 完整数据模型（SplitNode / PaneNode / TabRecord / LayoutOp）|
| [`packages/client/ui-dockkit/src/contract/adapter.ts`](../deepseek-harness/packages/client/ui-dockkit/src/contract/adapter.ts) | DockIntents 净手势契约 |
| [`packages/client/ui-slots/src/index.ts`](../deepseek-harness/packages/client/ui-slots/src/index.ts) | SlotMap / SlotEntryDef / GlobalStandardProps 三大声明合并接口 |

---

## 2. DSH 4 套 UI 挂入机制盘点

### 2.1 顶层骨架：`root` slot + 4 子 slot

[ui-layout/index.ts:122-170](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L122-L170) 声明：

```ts
// 4 个 root-scoped 子 slot（声明 = 排他渲染权）
'root' slot {
  children: {
    'sidebar':     { kind: 'single';  scope: 'root' },     // 左列
    'main':        { kind: 'keyed';   scope: 'root' },     // 中列（按 panelId 切换）
    'rightbar':    { kind: 'single';  scope: 'root' },     // 右列
    'shell.overlay': { kind: 'list'; scope: 'root' },     // 全屏浮层
  }
}
```

**关键事实**：

- `main` 是 **keyed**（按 MainPanelId 路由，候选 = `conversation` + 任意注册的 panelId）
- `sidebar` / `rightbar` 是 **single**（每列单 occupant）
- `shell.overlay` 是 **list**（additive，多 entry 共存）

### 2.2 机制 A：conversation 内的 session-scoped slot

**代表**：[ui-subagent/index.ts:65-81](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts#L65-L81)：

```ts
// 1. conversation header 内的 subagent lineage 入口
ctx.slots.inject(
  'conversation.session.header.lineage',
  () => ctx.slots.register({
    name: 'conversation.session.header.lineage',
    locale: NS,
    inject: catalogActions,
  }, SubagentHeaderLineage),
)
// 2. conversation composer 的 read-only takeover
ctx.slots.inject(
  'conversation.composer',
  () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -10,
    locale: NS,
    select: selectReadOnlySubagent,
  }, SubagentReadOnlyComposer),
)
```

**特点**：

- 注入 `conversation.*` 命名的子 slot（在 conversation 内部）
- **scope = session**：每个 session 一份实例
- **生命周期绑定 session**：session 切走 → effect cleanup → 子 slot 销毁
- **缺点**：嵌入 conversation header，不独立（ADR 0009 9.2 已否决）

### 2.3 机制 B：main panel 全局切换

[ui-layout/service.ts:28-52](../deepseek-harness/packages/client/ui-layout/src/client/service.ts#L28-L52)：

```ts
interface ILayout {
  selectPanel(panelId: MainPanelId | null): void  // 切换中央面板
  beginNavigation(): AbortSignal                    // 异步 navigation 取消信号
  toggleSidebar(): void
  openRightbar(track: boolean, fullscreen: boolean): void
  closeRightbar(): void
}
```

[AppFrame.tsx:40-44](../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx#L40-L44)：

```ts
function MainPanel({ usePanelInfo, renderSlot }: ...) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}
```

**机制**：注册到 `main` slot 带 `key`，调用 `ctx.layout.selectPanel(panelId)` 切换。

**特点**：

- 占用整列中央，**conversation 必须让位**
- 全局 panel（不绑定 session）
- 适合"工具型"面板（如 ui-deliverables / ui-jobs 等的 panel 模式）

### 2.4 机制 C：rightbar 多 tab

[ui-sidebar-right/index.ts:148-198](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L148-L198)：

```ts
// 1. 注册 rightbar 整体（owner）
ctx.slots.inject('rightbar', function* () {
  yield ctx.slots.register({ name: 'rightbar', children: {
    'rightbar.session': { kind: 'single', scope: 'session' },
  }}, RightbarRoot)
  yield ctx.slots.register({ name: 'rightbar.session', ..., store, ... }, RightbarSeat)
})

// 2. 注册每个 tab type（guide / documentpreview / ...）
const tabs = new SidebarRightTabRegistry(ctx)
tabs.register(guideDefinition(t))
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab', key: GUIDE_ID, ...
}, GuideBody))
```

**2 阶段注册**：

1. **Stage 1**：`tabs.register(definition)` → tab 类型入注册表 `ctx.sidebarRightTabs`
2. **Stage 2**：`ctx.slots.inject('sidebar.right.pane.tab', ...)` → 用同一 `key` 在 keyed slot 注册 tab body

**特点**：

- session-scoped store（每 session 一份）
- 同一 session 内多 tab 切换
- 支持 dockkit（split / float / resize / undo）
- 用户使用：`ctx.sidebarRight.openTab('skyaxis.tab.skyaxis', { sessionId, params })`
- **con 候选**：会话专属；skyaxis 拓扑视图要 cross-session 时不合适

### 2.5 机制 D：conversation header corner（ExpandButton 范本）

[ui-sidebar-right/index.ts:174-178](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L174-L178)：

```ts
const disposeExpand = ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
  name: 'conversation.session.header.corner',
  locale: NS,
  store,
}, ExpandButton))
```

**特点**：

- 在 conversation header 角落加一个按钮
- 与 rightbar **共享 store**：按钮只问"是否展开" + "请展开"
- **con 候选**：skyaxis 不应嵌入 conversation（ADR 0009 9.2）

### 2.6 4 套机制对照矩阵

| 机制 | 入口 slot | scope | 占用列 | session 绑定 | 典型代表 | 与 ADR 0009 9.2 冲突？ |
| --- | --- | --- | --- | --- | --- | --- |
| **A. conversation 内 session slot** | `conversation.session.header.*` / `conversation.composer` | session | 嵌 conversation | ✅ | ui-subagent | ❌ **冲突**（嵌入） |
| **B. main panel** | `main` (keyed) | root | 占中列 | ❌ | ui-deliverables / ui-jobs | ⚠️ 占中列 = 看不见 conversation |
| **C. rightbar tab** | `rightbar` → `sidebar.right.pane.tab` | session | 右列 | ✅ | ui-sidebar-documentpreview | ⚠️ session-scoped store 强绑定 |
| **D. header corner button** | `conversation.session.header.corner` | session | 嵌 conversation | ✅ | ExpandButton | ❌ **冲突**（嵌入） |

---

## 3. skyaxis 挂入点 4 候选对照

### 3.1 候选 P1：main panel（全局 panelId）

**形态**：skyaxis 注册到 `main` slot 带 `key: 'skyaxis.topology'`，调用 `ctx.layout.selectPanel('skyaxis.topology')` 切换。

**架构**：

```
┌────────────────────────────────────────────────────────────┐
│  sidebar  │  main panel (key=skyaxis.topology)             │
│           │  ┌─────────────────────────────────────────┐    │
│  Settings │  │ skyaxis topology / 多 root 并列画布    │    │
│  Plugins  │  │ React Flow + 6 只读服务消费              │    │
│  ...      │  │                                          │    │
│           │  └─────────────────────────────────────────┘    │
│           │  (conversation 必须让位)                          │
└────────────────────────────────────────────────────────────┘
```

**优点**：

- 全局 panel（不绑 session）
- 大画布空间（整列中央）
- ADR 0009 9.2 "独立 panel" 满足（不嵌入 conversation）
- DSH 已验证（ui-deliverables / ui-jobs / ui-plan 都用此模式）

**缺点**：

- 占用中列 = 用户看不到 conversation（切换有成本）
- 需要 sidebar 加 skyaxis 入口（依赖 sidebar 包的注册机制）

**MVP 适用性**：⚠️ 中。**适用场景 C**（多 session 总览——切到 skyaxis 总览模式），**不适用 A/B/D/D1/D2**（需边看 conversation 边看 skyaxis）

### 3.2 候选 P2：rightbar tab（ui-sidebar-right 2 阶段）

**形态**：skyaxis 注册 `tabs.register(skyaxisDefinition)`，加 tab body 到 `sidebar.right.pane.tab`。

**架构**：

```
┌─────────────────────────────────────────────────────────────┐
│  sidebar  │  conversation     │  rightbar                   │
│           │  ┌──────────────┐ │  ┌─skyaxis─┬─docs─┬─traj──┐ │
│  Settings │  │ turn 1       │ │  │ topology│ file │ search │ │
│  Plugins  │  │ turn 2       │ │  │ (tab)   │ (tab)│ (tab)  │ │
│  ...      │  │ ...          │ │  │         │      │        │ │
│           │  └──────────────┘ │  └─────────┴──────┴────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**优点**：

- 与 conversation **并列**（不切换 = 不打断）
- session-scoped（每个 session 一份 skyaxis 拓扑视图）
- 自动复用 dockkit 的 split / float / resize / undo

**缺点**：

- session 绑定：跨 session 拓扑视图（ADR 0009 SUB.1 多 root 并列）需要每个 session 自己一份？或者 session 0 = 全局视图
- 右列宽度有限（DSH 默认 ~300-400px），大画布（拓扑图）受限
- 依赖 ui-sidebar-right 完整注册（增加绑定复杂度）

**MVP 适用性**：⚠️ 中。**适用 A/D1/D2**（与 conversation 并列看），**不适用 C/B**（多 session 总览需要全宽）

### 3.3 候选 P3：shell.overlay 全屏浮层

**形态**：skyaxis 注册到 `shell.overlay`（list 类型，additive），渲染 `<SkyaxisOverlay>` 浮层按钮 + 全屏弹层。

**架构**：

```
┌─────────────────────────────────────────────────────────────┐
│  sidebar  │  conversation                                   │
│           │  ┌──────────────┐                                │
│  Settings │  │ turn 1       │  ┌─[skyaxis overlay button]─┐  │
│  Plugins  │  │ turn 2       │  │  浮层图标（always-on-top）│  │
│  Skyaxis  │  │ ...          │  └──────────────────────────┘  │
│           │  └──────────────┘                                │
│           │  全屏浮层打开：                                        │
│           │  ┌──────────────────────────────────────┐        │
│           │  │  skyaxis topology 全屏画布              │        │
│           │  └──────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**优点**：

- 完全独立（不嵌入、不占列）
- shell.overlay 已经被设计为"additive seat for a frame-wide surface"（[ui-layout/index.ts:85-91](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L85-L91)）
- 可与 conversation 并存
- 与 ADR 0009 9.2 完全对齐

**缺点**：

- 需要自写浮层生命周期（与 DSH 全屏切换协调）
- 与 dockkit 的 split / float 模式不兼容（shell.overlay 不走 dockkit）
- 浮层打开时 conversation 看不见（与 P1 类似的"切换成本"）

**MVP 适用性**：✅ 高。**适用 SUB 全屏拓扑 + 多 session 总览 C**。

### 3.4 候选 P4：自声明新 root slot（修改 AppFrame）

**形态**：skyaxis 在 `cordis.patch.yml` 里 patch `root` slot 的 children，添加 `skyaxis: { kind: 'single', scope: 'root' }`，然后注册自己到该 slot。

**架构**：

```
┌─────────────────────────────────────────────────────────────┐
│  sidebar  │  conversation     │  skyaxis     │  rightbar    │
│           │                   │  (新列)      │               │
│           │  ┌─────────────┐  │  ┌────────┐ │  ┌──────────┐ │
│           │  │ turn 1      │  │  │ skyaxis│ │  │ docs     │ │
│           │  │ turn 2      │  │  │ panel  │ │  │ search   │ │
│           │  └─────────────┘  │  └────────┘ │  └──────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**优点**：

- 完全独立（独立列）
- 与 conversation / rightbar **三者并列**
- 最符合 ADR 0009 9.2 "独立 panel"

**缺点**：

- ⚠️ **修改 DSH Frame 的 slot 声明**：必须在 cordis.patch.yml 中 patch `root` slot 的 children
- 需要 `ctx.slots.inject('root', () => ctx.slots.register({...children: {skyaxis: ...}}, ...))` 替代原 AppFrame —— **与 ui-layout 提供的 root slot 冲突**
- `verify-cordis-config.ts:140-150` 会校验"row id 不能重复"——'root' 已在 ui-layout 注册，patch 替换 = 等同于重写 AppFrame
- 风险大：DSH 升级时 AppFrame 变化会让 skyaxis 失效

**MVP 适用性**：❌ 不推荐。**违反 ADR 0010 NF.4（DSH 版本钉钉代价）**。

### 3.5 4 候选对照矩阵

| 候选 | 入口 | 架构复杂度 | 与 conversation 并存 | 跨 session | ADR 0009 9.2 对齐 | 风险 | MVP 推荐 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1 main panel** | `main` (keyed) | 低 | ❌ 切换 | ✅ | ⚠️ 占中列 | 低 | ⚠️ 仅 C 场景 |
| **P2 rightbar tab** | `rightbar` 2 阶段 | 中 | ✅ | ⚠️ session-scoped | ✅ 嵌入右列 | 中 | ⚠️ A/D1/D2 场景 |
| **P3 shell.overlay** | `shell.overlay` (list) | 中 | ✅ + 全屏切换 | ✅ | ✅ 完全独立 | 低 | ✅ **MVP 主推** |
| **P4 自声明 root slot** | 替换 `root` slot children | 高 | ✅ | ✅ | ✅ | **高（DSH 升级失效）** | ❌ 不推荐 |

### 3.6 决策：MVP 主推 **P3 shell.overlay** + 辅助 **P2 rightbar tab**

**MVP 推荐组合**：

- **P3 shell.overlay** = skyaxis 的 **主入口**，全屏浮层用于 SUB.1 拓扑视图 / 场景 C 多 session 总览
- **P2 rightbar tab** = skyaxis 的 **辅助入口**，与 conversation 并列，用于 SUB.5 read-only session event 时间线

**核心理由**：

- **shell.overlay 是 DSH 已定义的"additive seat"**（[ui-layout/index.ts:85-91](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L85-L91) 注释明确），设计意图就是"frame-wide surface of your own"
- **rightbar 与 ui-sidebar-right 已有完整 2 阶段注册**（[ui-sidebar-right/index.ts:148-198](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L148-L198)），skyaxis 复用 dockkit 的 split / float / undo
- **不修改 DSH Frame**（避免 P4 的 DSH 升级失效风险）
- **不嵌入 conversation**（满足 ADR 0009 9.2）
- **跨 session**：P3 shell.overlay 不绑 session；P2 rightbar tab 可接受 session-scoped（A/D1/D2 场景本身就 per-session）

---

## 4. 独立 store + navigation 架构设计

### 4.1 整体架构图

```
                    ┌─────────────────────────────────────────────┐
                    │           skyaxis plugin (apply)            │
                    ├─────────────────────────────────────────────┤
                    │                                              │
                    │  ┌─────────────────┐  ┌─────────────────┐   │
                    │  │  skyaxisStore   │  │  skyaxisOverlay │   │
                    │  │  (Zustand)      │  │  Store          │   │
                    │  │                 │  │  (浮层状态)       │   │
                    │  │  - roots[]      │  │  - open/close   │   │
                    │  │  - selectedRoot │  │  - mode         │   │
                    │  │  - filter       │  │                 │   │
                    │  └────────┬────────┘  └────────┬────────┘   │
                    │           │                    │            │
                    │           └─────────┬──────────┘            │
                    │                     │                       │
                    │  ┌──────────────────┴──────────────────┐    │
                    │  │  6 只读服务订阅（observe-only）         │    │
                    │  │  sessions / subagents / sessionQuery  │    │
                    │  │  sessionProjections / projectionCache │    │
                    │  │  agents                                │    │
                    │  └──────────────────────────────────────┘    │
                    │                     │                       │
                    └─────────────────────┼───────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
              ▼                           ▼                           ▼
     ┌────────────────┐         ┌────────────────┐         ┌────────────────┐
     │  P3 主入口      │         │  P2 辅助入口    │         │  navigation    │
     │  shell.overlay │         │  rightbar tab  │         │  controller    │
     │                │         │                │         │                │
     │  全屏浮层       │         │  dockkit tab   │         │  ctx.skyaxis   │
     │  topology 画布 │         │  trajectory   │         │  .navigate()   │
     │  React Flow    │         │  时间线        │         │  .openTab()    │
     └────────────────┘         └────────────────┘         └────────────────┘
```

### 4.2 skyaxisStore（Zustand 主 store）

来源：[ADR 0010 B 类 Zustand 锁定](decisions/0010-技术选型-MVP实施期.md)。

```ts
// packages/plugin/src/client/state/skyaxisStore.ts
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export interface SkyaxisState {
  // 数据层（observe-only）
  roots: RootTopology[]              // 多 root 并列（SUB.1）
  catalogState: 'loading' | 'ready' | 'error'  // SUB.4
  selectedRootId: SessionId | null
  
  // UI 层
  panelMode: 'topology' | 'trajectory' | 'overview'  // panel 内部 view 切换
  filter: { tags?: string[]; status?: SubagentStatus[] }
  
  // actions
  setRoots: (roots: RootTopology[]) => void
  selectRoot: (id: SessionId | null) => void
  setPanelMode: (mode: PanelMode) => void
  setFilter: (filter: Partial<Filter>) => void
}

export const useSkyaxisStore = create<SkyaxisState>()(subscribeWithSelector(/* ... */))
```

**关键设计**：

- **不绑 session**（与 P3 shell.overlay 一致；多 session 全局视图）
- **订阅 6 只读服务**（observe-only，参考 [research/dsh-consume-map.md § 5](dsh-consume-map.md)）
- **selector 订阅**（Zustand middleware `subscribeWithSelector`）→ React Flow 节点 1s tick 用 selector 减少 re-render

### 4.3 navigation controller（ctx.skyaxis）

**不依赖 main panel / rightbar**——自己声明 `ctx.skyaxis` service。

```ts
// packages/plugin/src/client/service.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    skyaxis: ISkyaxisNavigator
    skyaxisOverlay: ISkyaxisOverlayController  // 浮层专用
    skyaxisTab: ISkyaxisTabController           // rightbar tab 专用
  }
}

interface ISkyaxisNavigator {
  // shell.overlay 主入口
  openTopology(): void
  openOverview(): void
  close(): void
  
  // rightbar tab 辅助入口
  openTab(sessionId: SessionId): void
  closeTab(sessionId: SessionId): void
}
```

**注册**：

```ts
// packages/plugin/src/client/index.ts
const skyaxis: ISkyaxisNavigator = { ... }
const disposeSkyaxis = ctx.reflect.provide('skyaxis', skyaxis)
const disposeOverlay = ctx.reflect.provide('skyaxisOverlay', { ... })
const disposeTab = ctx.reflect.provide('skyaxisTab', { ... })

ctx.effect(() => () => {
  void disposeSkyaxis()
  void disposeOverlay()
  void disposeTab()
}, 'skyaxis: navigation controllers')
```

### 4.4 shell.overlay 注册（P3 主入口）

```ts
// packages/plugin/src/client/index.ts
ctx.effect(() => {
  // shell.overlay 是 list 类型，additive 注册即可
  const disposeButton = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'skyaxis.overlay.button',
    locale: NS,
    inject: (): SkyaxisOverlayInjected => ({
      // 通过 skyaxisOverlay service 控制浮层
      onClick: () => ctx.skyaxisOverlay.toggle(),
    }),
  }, SkyaxisOverlayButton))
  
  // 全屏浮层本体（不挂 slot，自己控制 DOM）
  const overlay = new SkyaxisOverlay(ctx)
  const disposeOverlay = overlay.mount(document.body)
  
  return () => {
    disposeButton()
    disposeOverlay()
  }
}, 'skyaxis: shell.overlay entry')
```

**overlay 实现**：

```ts
// packages/plugin/src/client/overlay/SkyaxisOverlay.tsx
export class SkyaxisOverlay {
  mount(root: HTMLElement): () => void {
    const reactRoot = createRoot(root)
    const render = () => reactRoot.render(<OverlaySurface ctx={this.ctx} />)
    return this.ctx.effect(() => {
      render()
      return () => reactRoot.unmount()
    }, 'skyaxis: overlay mount'), () => reactRoot.unmount()
  }
}
```

### 4.5 rightbar tab 注册（P2 辅助入口）

复用 ui-sidebar-right 2 阶段：

```ts
// packages/plugin/src/client/index.ts
import { tabDefinition, type SkyaxisTabInjected } from './tabs/trajectory-tab/definition.ts'

// Stage 1: 注册 tab 类型
const tabs = ctx.sidebarRightTabs
const disposeType = tabs.register(tabDefinition(ctx.locale.bind(NS)))

// Stage 2: 注册 tab body
const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'skyaxis.trajectory',
  inject: (): SkyaxisTabInjected => ({
    hooks: { /* subscribe to skyaxisStore */ },
  }),
}, TrajectoryTabBody))

ctx.effect(() => () => {
  disposeBody()
  disposeType()
}, 'skyaxis: rightbar tab')
```

### 4.6 与 DSH ui-subagent 的差异

| 维度 | DSH ui-subagent（机制 A）| skyaxis（机制 P3 + P2）|
| --- | --- | --- |
| **挂入位置** | `conversation.session.header.lineage` / `conversation.composer` | `shell.overlay` + `sidebar.right.pane.tab` |
| **scope** | session-scoped | root-scoped（overlay）+ session-scoped（tab）|
| **是否嵌入 conversation** | ✅ 嵌入 | ❌ 独立 |
| **store 来源** | 直接 `ctx.sessions`（DSH own）| 自建 Zustand `skyaxisStore` |
| **跨 session** | ❌ 单 session | ✅ overlay 多 root；tab 单 session |
| **ADR 0009 9.2 对齐** | ❌（subagent 嵌入 header 是有意的；skyaxis 不应如此） | ✅ 独立 panel |
| **navigation** | 无（slot 在 session 内自带）| 自建 `ctx.skyaxis.navigate()` |
| **locales** | `ctx.locale.register(NS, { zh, en })` | 同 ui-subagent 模式 |
| **slots.inject 用法** | 单次 inject | 多次 inject（overlay + tab）|
| **生命周期** | session dispose | session dispose（tab）/ 全局 dispose（overlay）|

---

## 5. ADR 0009 假设清单验证

### 5.1 假设覆盖度更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 1（形态 B patch overlay）| （无新增）| 维持 [research/dsh-workspace-integration.md](dsh-workspace-integration.md) |
| 假设 2（6 只读服务）| （无新增）| 维持 [research/dsh-consume-map.md](dsh-consume-map.md) |
| 假设 3（observe-only 集成）| （无新增）| 维持 |
| **新假设 11**：DSH shell.overlay slot 可作为独立 panel 入口 | ✅ 已确认（[ui-layout/index.ts:85-91](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L85-L91) 设计注释明确为"additive seat for frame-wide surface"） | **假设 11 暂成立** |
| **新假设 12**：ui-sidebar-right 2 阶段注册可被 skyaxis 复用 | ✅ 已确认（[ui-sidebar-right/index.ts:148-198](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L148-198) 完整 2 阶段 API） | **假设 12 暂成立** |
| **新假设 13**：skyaxis 不需修改 DSH Frame root slot | ✅ 选定 P3+P2 组合避开 P4，避免 DSH 升级失效 | **假设 13 暂成立** |
| **新假设 14**：独立 store + navigation 与 DSH session/locale/resources 兼容 | ⚠️ 待 v0.1 实施期验证（Zustand 与 cordis effect 集成细节） | **待验证** |

### 5.2 累计 ADR 0009 假设

- 假设 1：形态 B patch overlay 可行 → ✅ 假设基础已建
- 假设 2-8：[research/dsh-consume-map.md § 6.1](dsh-consume-map.md) 维持状态
- 假设 9 / 10：[research/dsh-ui-primitives-reuse.md](dsh-ui-primitives-reuse.md) 暂成立
- 假设 11 / 12 / 13：本调研暂成立
- 假设 14：待 v0.1 实施期验证

**红线检查**：3 条以上不成立则回退。当前所有假设暂成立或未触达，**未触达红线**。

---

## 6. 关键风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 shell.overlay 与 dockkit 不兼容** | 全屏浮层不能用 dockkit 的 split / float | 自写浮层生命周期；或选 P2 rightbar tab 走 dockkit |
| **R.2 rightbar tab 的 session-scoped store 不适合跨 session 拓扑** | SUB.1 多 root 并列需要全局视图 | SUB.1 放 P3 overlay；P2 tab 仅承载 SUB.5 session event 时间线 |
| **R.3 Zustand 与 cordis effect 集成** | skyaxisStore 订阅 6 只读服务时，cleanup 不彻底可能内存泄漏 | 用 `ctx.effect` 包裹 subscription，dispose 时 unsub |
| **R.4 shell.overlay 已有占用** | DSH 内可能有其他 plugin 占 shell.overlay | 验证 DSH web-app 默认 `shell.overlay` 列表；skyaxis 用 unique name `skyaxis.overlay.button` |
| **R.5 DSH 升级 AppFrame.tsx 子 slot 变化** | skyaxis 依赖 4 子 slot 名称不变 | ADR 0010 风险 1 已锁 DSH 版本钉钉 |
| **R.6 locales 未注册** | skyaxis UI 文本会渲染 raw key | R.8 同 [research/dsh-ui-primitives-reuse.md § 8](dsh-ui-primitives-reuse.md) |
| **R.7 main panel 切换时 conversation 状态丢失** | 如果 skyaxis 在某些场景用 P1 main panel，session 状态可能丢 | MVP 锁定 P3+P2 不碰 main；后续如需 P1 单独评估 |
| **R.8 SkyaxisOverlay 自写 DOM 卸载顺序** | React 18 concurrent root 与 cordis effect dispose 时序 | 用 `ctx.effect` 包裹 createRoot/unmount，测试验证 |

---

## 7. 后续动作（v0.1 实施期第一周 UI 落地）

1. **cordis.patch.yml 加 4 行**：
   - 注册 `skyaxis.overlay.button` 到 `shell.overlay`
   - 声明 `ctx.skyaxis` / `ctx.skyaxisOverlay` / `ctx.skyaxisTab` service
2. **src/client/index.ts 改造**：
   - `inject` 列表加 `shell.overlay` 引用（实际上通过 `ctx.slots.inject('shell.overlay', ...)`）
   - `apply` 函数加 3 个 controller 注册 + 2 个 effect（overlay + tab）
3. **src/client/state/skyaxisStore.ts**：Zustand store 6 只读服务订阅
4. **src/client/overlay/SkyaxisOverlay.tsx**：全屏浮层 + React Flow 拓扑图
5. **src/client/tabs/trajectory-tab/**：rightbar tab body
6. **i18n**：新建 `skyaxis.zh.json` / `skyaxis.en.json`
7. **vitest 测试**：覆盖
   - skyaxisStore 与 6 只读服务集成
   - navigation controller open/close 行为
   - overlay mount/unmount 不泄漏

---

## 8. 一句话总结

> DSH 4 套挂入机制盘点完成；skyaxis MVP 锁定 **P3 shell.overlay + P2 rightbar tab** 双入口组合：shell.overlay 承载 SUB.1 拓扑视图 + 场景 C 多 session 总览（全屏 + 跨 session），rightbar tab 承载 SUB.5 session event 时间线（与 conversation 并列 + session-scoped）；**不修改 DSH Frame**（避 P4 DSH 升级失效风险）；**不嵌入 conversation**（满足 ADR 0009 9.2）；独立 Zustand store + 自建 `ctx.skyaxis` navigation；新增 ADR 0009 假设 11 / 12 / 13 暂成立，假设 14 待 v0.1 实施期验证。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 `packages/client/` 17 个 ui-* 包 + `ui-layout/` + `ui-sidebar-right/` + `ui-dockkit/contract/` + `ui-subagent/` + `AppFrame.tsx` + `service.ts` + `ui-slots/src/index.ts` 源码逐条落地。覆盖：DSH 4 套挂入机制盘点（slot 内嵌 / main panel / rightbar 2 阶段 / header corner）；skyaxis 挂入 4 候选对照矩阵；MVP 锁定 **P3 shell.overlay + P2 rightbar tab** 组合；独立 Zustand store + 自建 navigation controller 架构；与 DSH ui-subagent 8 维差异分析；新增 ADR 0009 假设 11 / 12 / 13 暂成立 + 假设 14 待验证；8 项关键风险 + v0.1 第一周 7 步落地任务。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH ui-primitives 复用清单](dsh-ui-primitives-reuse.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [核心画像 A 的 5 个场景剧本](../users/persona-a-scenarios.md)
- [CLAUDE.md](../CLAUDE.md)
- [`packages/client/ui-layout/src/client/index.ts`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts)
- [`packages/client/ui-layout/src/client/AppFrame.tsx`](../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx)
- [`packages/client/ui-sidebar-right/src/client/index.ts`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts)
- [`packages/client/ui-subagent/src/client/index.ts`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts)
- [`packages/client/ui-dockkit/src/contract/types.ts`](../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts)
