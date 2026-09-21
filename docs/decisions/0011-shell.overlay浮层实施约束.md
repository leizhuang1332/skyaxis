# ADR 0011：shell.overlay 浮层实施约束 — P3 挂入点的工程细节

| 字段 | 值 |
| --- | --- |
| **状态** | 接受（推荐版） |
| **日期** | 2026-09-19 |
| **记录人** | Claude（基于用户授权 + DSH 仓只读调研 + ADR 0009 / 0010 / [research/skyaxis-panel-architecture.md §3.3](../research/skyaxis-panel-architecture.md) 锁定） |

---

## 背景

[ADR 0009 §9.6](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 锁定 MVP 形态 B（外部 patch overlay）+ 独立 panel 架构；[research/skyaxis-panel-architecture.md §3.6](../research/skyaxis-panel-architecture.md) 锁定 P3 shell.overlay + P2 rightbar tab 组合。

P3 主推的原因已经记录在调研报告，本 ADR **不再讨论"为什么选 P3"**，只把 P3 实施期必须解决的 3 个工程问题锁死成约束：

1. **浮层生命周期**：DSH 不提供原生浮层容器，无 overlay service / hook / focus trap 工具，skyaxis 必须自写。
2. **与 DSH 三列的关系**：shell.overlay 跟 main / rightbar / sidebar 是 sibling 还是嵌套？切换是否相互影响？
3. **与 dockkit 的关系**：shell.overlay 不在 dockkit 的 tab tree 内，dockkit 的 split/float 是否可用？MVP 怎么处理？

调研发现（[research/skyaxis-panel-architecture.md §2](../research/skyaxis-panel-architecture.md) + [DSH ui-layout/index.ts:84-91](../../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L84-L91) + [DSH ui-layout/AppFrame.tsx:200-238](../../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx#L200-L238) + [DSH ui-layout/service.ts:28-52](../../deepseek-harness/packages/client/ui-layout/src/client/service.ts#L28-L52) + [DSH ui-dockkit/contract/types.ts](../../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts)）：

- **`ILayout` 接口不含 overlay 控制方法**：只有 `selectPanel` / `beginNavigation` / `toggleSidebar` / `openRightbar` / `closeRightbar` —— shell.overlay 不在 layout store 状态树里
- **`shell.overlay` 是 root-scoped list slot**：additive，frame-wide，"above every column and outside their scroll containers"（设计注释）
- **AppFrame.tsx:230-232** 把 overlay 渲染在 `<div className={css.overlayLayer} data-shell-overlay>`，与 sidebar/main/rightbar 三列同级
- **overlay layer click-through**：空区域不挡下面的 app，entry opt-in pointer events（设计注释）
- **dockkit 全部数据模型围绕右列 docked tab tree**（`LayoutState.nodes` / `floats` / `mode` 等），不作用于 shell.overlay

**输入约束**：

- [ADR 0001 — 形态：DSH 独立插件](0001-形态-dsh插件.md)
- [ADR 0009 — subagent 拓扑可视化](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 9.2 / 9.6 / 9.7
- [ADR 0010 — 技术选型](0010-技术选型-MVP实施期.md) B 类 Zustand / React / DSH ui-primitives
- [research/skyaxis-panel-architecture.md](../research/skyaxis-panel-architecture.md) §3.3 / §3.6 / §4 / §6
- [research/dsh-consume-map.md](../research/dsh-consume-map.md) 6 只读服务消费路径
- CLAUDE.md 工程硬性约束（禁止修改 `deepseek-harness/` 源码）

---

## 决策

### 11.1 P3 shell.overlay 浮层生命周期的 5 件事

skyaxis 必须自管的浮层生命周期清单（**全部在 `ctx.effect` 内**）：

#### 11.1.1 挂载点：cordis effect + 自管 DOM 容器

```ts
// packages/plugin/src/client/overlay/SkyaxisOverlay.tsx
ctx.effect(() => {
  // 1) shell.overlay list slot additive 注册按钮
  const disposeButton = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'skyaxis.overlay.button',
    locale: NS,
  }, SkyaxisOverlayButton))

  // 2) 自管全屏浮层 DOM 容器（注意：shell.overlay 不渲染本体的位置）
  const host = document.createElement('div')
  host.setAttribute('data-skyaxis-overlay-host', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<SkyaxisOverlay ctx={ctx} />)

  return () => {
    disposeButton()
    root.unmount()
    host.remove()
  }
}, 'skyaxis: shell.overlay mount')
```

**约束**：host 容器必须挂到 `document.body` 而不是 shell.overlay slot 内的 entry——因为 list slot 的 entry 是"按钮/图标"型（badge / toast / pill），不是"全屏画布"型。本体 DOM 自行 root.unmount 清理。

#### 11.1.2 浮层开关：自声明 `ctx.skyaxisOverlay` service

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    skyaxisOverlay: ISkyaxisOverlayController
  }
}

interface ISkyaxisOverlayController {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
}
```

**约束**：

- **不**扩展 `ILayout`（[ui-layout/service.ts:28-52](../../deepseek-harness/packages/client/ui-layout/src/client/service.ts#L28-L52)），shell.overlay 不属于 layout 管辖
- service 注册用 `ctx.reflect.provide('skyaxisOverlay', ...)`，dispose 在 `ctx.effect` cleanup 中清理
- open/close 状态写 skyaxis 自建 Zustand `skyaxisStore.overlayOpen`（[research/skyaxis-panel-architecture.md §4.2](../research/skyaxis-panel-architecture.md)）

#### 11.1.3 焦点管理：自写 focus trap + ESC 关闭

```tsx
// packages/plugin/src/client/overlay/OverlaySurface.tsx
function OverlaySurface({ onClose, children }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const first = surfaceRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && surfaceRef.current) {
        trapFocus(e, surfaceRef.current)
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" ref={surfaceRef}>
      {children}
    </div>
  )
}
```

**约束**：

- `role="dialog"` + `aria-modal="true"`（a11y baseline）
- 打开时记录 `previouslyFocused`，关闭时 restore（避免 keyboard 用户失焦）
- ESC 关闭调 `ctx.skyaxisOverlay.close()`
- `trapFocus` 实现 Tab / Shift+Tab 在 surface 内循环——MVP 用 querySelectorAll 简版，复杂场景（嵌套 dialog / shadow DOM）v0.2 再考虑

#### 11.1.4 背景行为：遮罩 + 不关闭（推荐默认）

| 行为 | 实现 | MVP 选择 |
| --- | --- | --- |
| 背景可点（click-through） | overlay 不铺 backdrop | ❌（违反 a11y 焦点陷阱）|
| 背景点击关闭 | backdrop `onClick={onClose}` | ⚠️ 备选（误触风险）|
| **背景遮罩 + 不关闭** | backdrop 半透明 + ESC 关闭 | ✅ **MVP 默认** |

```tsx
// 推荐背景层
<div
  className={css.backdrop}
  onClick={e => { if (e.target === e.currentTarget) onClose() }}
  aria-hidden="true"
/>
```

**约束**：

- backdrop 用 `position: fixed; inset: 0; z-index: 1`（在 shell.overlay 层之上）
- 点击 backdrop 自身关闭（不是点击 children 关闭）—— `e.target === e.currentTarget` 判定
- backdrop 半透明黑（`rgba(0,0,0,0.4)`），与 DSH shell.overlay 默认 click-through 不冲突（DSH 默认是"无 backdrop"，skyaxis 选择有 backdrop 是 UX 增强）

#### 11.1.5 跨层协调：5 项约束

| 场景 | 期望行为 | 实现依据 |
| --- | --- | --- |
| overlay 打开时用户 `ctx.layout.selectPanel('xxx')` 切 main panel | overlay 不动；新 panel 在 main 列渲染 | AppFrame.tsx:202-238 overlay 与 main 同级 |
| overlay 打开时用户 `ctx.layout.openRightbar(true, true)` 切 rightbar fullscreen | overlay 仍在最上层 | shell.overlay 在所有列之上（AppFrame.tsx:230-232 z-index 隐式保证）|
| overlay 打开时用户 `ctx.layout.toggleSidebar()` 折叠左列 | overlay 不动 | sidebar 与 overlay 同级 |
| 用户在 sidebar 选新 session | skyaxis store 按 session 重新订阅；overlay UI 保持打开；focus trap restore 正确 | `ctx.effect` cleanup → 新 session mount |
| DSH 应用层未来引入"全屏模式" | shell.overlay 在最上层，自然覆盖 | `.overlayLayer` z-index 在最上 |

### 11.2 shell.overlay 与 DSH 三列的正交关系

```
                          DSH Frame（root slot, AppFrame.tsx）
                          ┌──────────────────────────────────────────────┐
                          │ .frame  (grid-template-columns: ...)         │
                          │  ┌─────────┬───────────┬──────────┐         │
                          │  │ sidebar │   main    │ rightbar │         │
                          │  │ (单列)  │ (keyed)   │ (单列)   │         │
                          │  └─────────┴───────────┴──────────┘         │
                          │  ┌─────────────────────────────────────┐     │
                          │  │ .overlayLayer  (shell.overlay list)│     │
                          │  │  skyaxis overlay button            │     │
                          │  │  + (本体内: 自管 DOM 挂 document.body)│  │
                          │  └─────────────────────────────────────┘     │
                          └──────────────────────────────────────────────┘
```

**约束**：

1. **shell.overlay 与三列是 sibling，不是 parent-child**：overlay 不嵌套在任何列内
2. **layout store 状态变更不影响 overlay**：`selectPanel` / `openRightbar` / `toggleSidebar` 都不触发 overlay 任何副作用
3. **overlay 开关不影响 layout store**：skyaxis 不写 `ctx.layout.*` 任何方法
4. **scope = root**：overlay 是全局单实例，不绑 session；session 切换只影响 overlay 内部数据（skyaxisStore 按 session 重新订阅 6 只读服务），不影响 overlay 本身的 mount/unmount

### 11.3 与 dockkit 不兼容的处理方案

#### 11.3.1 不兼容的事实

[DSH ui-dockkit/contract/types.ts](../../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts) 全部数据模型围绕右列 docked tab tree：

```ts
interface LayoutState {
  nodes: Record<NodeId, LayoutNode>   // SplitNode / PaneNode
  tabs: Record<TabId, TabRecord>
  rootId: NodeId
  floats: readonly PaneId[]            // ← 浮动面板栈（仅作用于右列）
  mode: DockMode                       // 'push' | 'fullscreen'（仅作用于右列 docked area）
}

type PaneHost = 'dock' | 'float'
```

[DSH ui-dockkit/contract/adapter.ts:66-97](../../deepseek-harness/packages/client/ui-dockkit/src/contract/adapter.ts#L66-L97) `DockIntents` 的 `splitPane` / `floatTab` / `unfloatPane` / `moveFloat` / `resizeFloat` 等都是右列 tab tree 的 mutators。**shell.overlay 在 AppFrame.tsx:230-232 的 `.overlayLayer` 与右列 docked tree 不在同一渲染树里**——dockkit 的所有操作对 shell.overlay **不存在可作用的表面**。

#### 11.3.2 这是设计意图，不是缺陷

[DSH ui-layout/index.ts:84-91](../../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L84-L91) 注释明确 shell.overlay 是 "frame-wide surface of your own"——**不是给 split/float 设计的**。dockkit 的 split/float 是为右列多 tab 并排 /浮出场景设计的。shell.overlay 永远单实例（同一时刻最多一个 skyaxis 全屏视图），本就在最上层——**split 和 float 对 shell.overlay 是冗余的**。

#### 11.3.3 MVP 范围内的多视图需求处理

| 需求 | 方案 | 依据 |
| --- | --- | --- |
| **SUB.1 拓扑视图**（跨 session 大画布） | P3 shell.overlay（全屏打开）| 调研报告 §3.3 |
| **SUB.5 session event 时间线**（session-scoped） | P2 rightbar tab（与 conversation 并列）| 调研报告 §3.2 |
| **同时看拓扑 + 时间线** | 同时打开 P3 overlay + P2 tab（两者 scope 独立：root / session）| P3 + P2 互补 |
| **拓扑视图左右分栏比较两个 subagent tree** | **不需要**——SUB.1 是"多 root 并列"，在一个画布里并列，不分屏 | [research/trajectory-merger-algorithm.md](../research/trajectory-merger-algorithm.md) SUB.1 设计 |
| **把 topology view 拖出来成浮窗** | **MVP 不做**——shell.overlay 本就在最上层 | 设计意图 |

→ **MVP 范围内 dockkit split/float 对 skyaxis 没有不可替代的价值**。

#### 11.3.4 未来升级路径（仅记录，MVP 不实施）

| 方案 | 代价 | 何时启用 |
| --- | --- | --- |
| **A. 把 topology view 注册成 P1 main panel** | 失去"与 conversation 并列"；占用中列 | 用户明确反馈"想边聊边看"不满足时 |
| **B. 把 topology view 注册成 P2 rightbar tab** | 受右列宽度限制（DSH 默认 300-400px）；**自动获得 dockkit split/float** | 用户想跟其它 rightbar tab 并排时 |
| **C. 自写 shell.overlay 内的 window manager** | 工程量大；与 DSH 设计哲学冲突；MVP 工期爆炸 | 不推荐，仅作记录 |

### 11.4 行为约束清单（v0.1 实施期必须满足）

| 编号 | 约束 | 验证方式 |
| --- | --- | --- |
| **C.1** | overlay mount / unmount 必须配对；`ctx.effect` cleanup 完整 | vitest：mount → dispose → DOM 无残留 |
| **C.2** | overlay 不写 `ctx.layout.*` 任何方法 | oxlint 自定义规则 + 静态扫描 |
| **C.3** | overlay 不挂载到 shell.overlay list slot 的 entry 位置（避免被 list 的层叠顺序约束） | 视觉验证：host 挂 `document.body` |
| **C.4** | 焦点陷阱：ESC 关闭 + Tab 在 surface 内循环 | vitest + a11y 工具（axe-core）|
| **C.5** | session 切换时 overlay UI 保持打开，数据按 session 重新订阅 | 集成测试 |
| **C.6** | main panel 切换 / rightbar 开关 / sidebar 折叠不影响 overlay 显隐 | 集成测试 |
| **C.7** | shell.overlay list slot 内 skyaxis entry name 必须唯一（`skyaxis.overlay.button`）| 与 DSH 默认 entries 共存验证 |
| **C.8** | overlay dispose 时必须 cleanup React 18 root + DOM 节点 + cordis effects 三类资源 | vitest：unmount → 无内存泄漏 |

### 11.5 不在 P3 范围的内容

明确**不做**（避免范围蔓延）：

- ❌ 不实现自写 window manager / 浮窗拖拽 / resize（与 DSH 设计意图冲突）
- ❌ 不修改 DSH `AppFrame.tsx` / `ui-layout/index.ts` / `service.ts`（CLAUDE.md 工程硬性约束 + ADR 0010 NF.4）
- ❌ 不扩展 `ILayout` 接口（shell.overlay 不属于 layout 管辖）
- ❌ 不写 backdrop 强制关闭（用 ESC + backdrop 点击关闭两个出口）
- ❌ 不在 MVP 处理嵌套 dialog / shadow DOM 焦点陷阱（v0.2 视需求）

---

## 后果

### 正面

1. **P3 与 DSH 三列正交**：overlay 与 main / rightbar / sidebar 互不干扰，符合 ADR 0009 §9.2 "独立 panel" 要求
2. **MVP 范围内 dockkit 不兼容不是真问题**：SUB.1 多视图需求由 P3 + P2 互补解决，MVP 不需要 split/float
3. **不修改 DSH 源码**：5 件事全部在 skyaxis plugin 内自管，避 P4 候选的 DSH 升级失效风险（[research/skyaxis-panel-architecture.md §3.4](../research/skyaxis-panel-architecture.md)）
4. **自写生命周期清单明确**：5 件事工程量可控，可独立排期与测试

### 负面

1. **5 件事工程量**：mount/unmount + focus trap + ESC + 背景行为 + 跨层协调，每件都不复杂但要写代码 + 单测
2. **测试覆盖**：overlay 与 DSH 三列的 4 种组合（main 切换 / rightbar 开关 / sidebar 折叠 / session 切换）每种都要集成测试
3. **a11y 责任**：DSH 没有焦点陷阱工具，skyaxis 要自写并维护

### 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 shell.overlay 已有占用** | DSH 内可能有其他 plugin 占 shell.overlay | 用 unique entry name `skyaxis.overlay.button`；v0.1 demo 验证 shell.overlay 默认 entries |
| **R.2 backdrop 与 DSH click-through 冲突** | 视觉割裂 | backdrop 半透明黑 + `pointer-events: none` 在最外层（仅 dialog 区域接收事件）|
| **R.3 焦点陷阱误吞 ESC** | 用户在 React Flow 节点编辑时按 ESC 误关 overlay | Tab focus trap 用 first focusable + 内部循环，不劫持 React Flow 内部 ESC 处理 |
| **R.4 React 18 concurrent root 与 cordis effect dispose 时序** | unmount 时内存泄漏 | `ctx.effect` cleanup 同步执行 `root.unmount()` + `host.remove()`；vitest 测无泄漏 |
| **R.5 DSH 升级 AppFrame.tsx 子 slot 变化** | skyaxis 依赖 4 子 slot 名称不变 | ADR 0010 NF.4 已锁 DSH 版本钉钉 `0.1.5-rc.2`（commit `fb2c4b9`）|
| **R.6 locales 未注册** | overlay 按钮/标题渲染 raw key | 复用 [research/dsh-ui-primitives-reuse.md §8](../research/dsh-ui-primitives-reuse.md) R.8 缓解 |
| **R.7 其他 plugin 也在 shell.overlay 注册 entry** | list slot 顺序竞争 | skyaxis entry 用 `priority: 0`（默认）；z-index 用 host 容器的 CSS position 保证 |

---

## 验证计划

### v0.1 实施期第一周（与 [research/skyaxis-panel-architecture.md §7](../research/skyaxis-panel-architecture.md) 同步）

1. ✅ **C.1-C.8 行为约束** 全部写 vitest case
2. ✅ **集成测试**：与 DSH web-app 默认 `shell.overlay` entries 共存
3. ✅ **a11y 验证**：axe-core 跑 overlay mount 状态，无 critical issue
4. ✅ **内存验证**：mount/unmount 100 次循环无泄漏
5. ✅ **oxlint 自定义规则**：
   - 禁止 `ctx.layout.*` 调用出现在 skyaxis overlay 相关文件
   - 禁止 `import` from `@deepseek-harness/packages/client/ui-layout`（仅允许 `ctx.layout` 类型）

### v0.1 demo 第一天必验证

- [research/skyaxis-panel-architecture.md §6 R.4](../research/skyaxis-panel-architecture.md) "shell.overlay 已有占用"——DSH web-app 默认启动后打开浏览器 console 看 `ctx.slots.entries('shell.overlay').length`

---

## ADR 0009 假设清单更新

| 假设 | 本 ADR 相关 | 状态 |
| --- | --- | --- |
| 假设 11（DSH shell.overlay slot 可作为独立 panel 入口）| ✅ 已确认（[ui-layout/index.ts:84-91](../../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L84-L91)）| **暂成立** |
| 假设 12（ui-sidebar-right 2 阶段注册可被 skyaxis 复用）| （无新增）| **暂成立** |
| 假设 13（skyaxis 不需修改 DSH Frame root slot）| ✅ 本 ADR 11.1 / 11.5 锁定"不修改 DSH AppFrame.tsx / ui-layout" | **暂成立** |
| 假设 14（独立 store + navigation 与 DSH session/locale/resources 兼容）| ⚠️ 待 v0.1 实施期验证（[research/skyaxis-panel-architecture.md §5.1](../research/skyaxis-panel-architecture.md)）| **待验证** |
| **新假设 18**：DSH `ILayout` 接口不扩展（shell.overlay 走自建 service）| ✅ [ui-layout/service.ts:28-52](../../deepseek-harness/packages/client/ui-layout/src/client/service.ts#L28-L52) 锁定接口不含 overlay 控制 | **暂成立** |
| **新假设 19**：overlay 与三列切换互不触发副作用（state 正交）| ✅ [ui-layout/AppFrame.tsx:200-238](../../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx#L200-L238) 渲染顺序保证 | **暂成立** |
| **新假设 20**：dockkit 不作用于 shell.overlay 是设计意图（[ui-layout/index.ts:84-91](../../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L84-L91) + [ui-dockkit/contract/types.ts](../../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts)）| ✅ 已确认 | **暂成立** |

**红线检查**：3 条以上不成立则回退。当前所有假设暂成立或未触达，**未触达红线**。

**累计 ADR 0009 假设**：20 条（1-20）。详见 [docs/decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md §6](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)。

---

## 后续动作

### v0.1 实施期第一周

1. **`packages/plugin/src/client/overlay/SkyaxisOverlay.tsx`**：自管 mount/unmount + cordis effect 包裹（11.1.1）
2. **`packages/plugin/src/client/overlay/OverlaySurface.tsx`**：dialog + focus trap + ESC（11.1.3）
3. **`packages/plugin/src/client/overlay/OverlayBackdrop.tsx`**：半透明 backdrop + 点击关闭（11.1.4）
4. **`packages/plugin/src/client/service.ts`**：声明 `ctx.skyaxisOverlay`（11.1.2）
5. **`packages/plugin/src/client/index.ts`**：`ctx.effect` 内 inject `shell.overlay` + mount host
6. **`scripts/verify-skyaxis-readonly.ts`**：加 3 条规则（C.2 / C.3 / C.5）
7. **`packages/plugin/tests/overlay/`**：C.1-C.8 + a11y + 内存验证

### v0.1 demo 第一天（与 [research/skyaxis-panel-architecture.md §6 R.4](../research/skyaxis-panel-architecture.md) 同步）

- 验证 DSH web-app 默认 `shell.overlay` entries 列表（假设 11 / 17 验证）
- 验证 main panel 切换不影响 overlay（C.6）

### v0.2（如需）

- 嵌套 dialog / shadow DOM 焦点陷阱（11.5 不做清单）
- 升级路径 A / B / C 视用户反馈启用

---

## 一句话总结

> P3 shell.overlay 浮层生命周期自管 5 件事（mount + 开关 service + focus trap + 背景 + 跨层协调），与 DSH 三列（main / rightbar / sidebar）正交；MVP 范围内与 dockkit 不兼容不是真问题（SUB.1 / 多 session 总览不需要 split/float）；新增 ADR 0009 假设 18 / 19 / 20 暂成立，累计 20 条假设未触达红线；不修改 DSH 源码（CLAUDE.md 工程硬性约束 + ADR 0010 NF.4）；不扩展 ILayout 接口。

---

## 相关文档

- [ADR 0009 — subagent 拓扑可视化](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](0010-技术选型-MVP实施期.md)
- [research/skyaxis-panel-architecture.md](../research/skyaxis-panel-architecture.md) §3.3 / §3.6 / §4 / §5 / §6 / §7
- [research/dsh-consume-map.md](../research/dsh-consume-map.md) 6 只读服务消费路径
- [research/dsh-workspace-integration.md](../research/dsh-workspace-integration.md)
- [research/dsh-ui-primitives-reuse.md](../research/dsh-ui-primitives-reuse.md)
- [research/trajectory-merger-algorithm.md](../research/trajectory-merger-algorithm.md)
- [CLAUDE.md](../../CLAUDE.md) 工程硬性约束 / 决策索引 / 变更日志
- [DSH ui-layout/index.ts:84-91](../../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L84-L91)
- [DSH ui-layout/AppFrame.tsx:200-238](../../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx#L200-L238)
- [DSH ui-layout/service.ts:28-52](../../deepseek-harness/packages/client/ui-layout/src/client/service.ts#L28-L52)
- [DSH ui-dockkit/contract/types.ts](../../deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts)
- [DSH ui-dockkit/contract/adapter.ts:66-97](../../deepseek-harness/packages/client/ui-dockkit/src/contract/adapter.ts#L66-L97)
- [DSH ui-sidebar-right/index.ts:148-198](../../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L148-L198)
- [DSH ui-subagent/index.ts:65-81](../../deepseek-harness/packages/client/ui-subagent/src/client/index.ts#L65-L81)