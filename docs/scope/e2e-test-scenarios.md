# skyaxis — 端到端测试大纲

> **本文档定义 skyaxis MVP 端到端测试的完整场景清单**。每个测试场景以 gherkin Given-When-Then 形式定义，作为 [CLAUDE.md 第 2.4 节](../CLAUDE.md) "每个 MVP 场景至少 1 个端到端测试" 的实施依据。
>
> **覆盖**：MVP 6 场景 + ADR 0009 subagent 拓扑可视化扩展 + 6 项非功能性需求 + 工程硬性约束。
>
> **测试实施位置**：`packages/plugin/tests/e2e/`（具体路径见 [§ 8 实施计划](#8-实施计划)）。
>
> **测试命令**：参考 [`v0.1-demo-verification.md` § 6.7](research/v0.1-demo-verification.md)。

---

## 1. 文档目的

- 把 MVP 6 场景 + 8 个调研报告落地设计转化为**可执行的 e2e 测试用例**
- 作为 v0.1 / v0.2 / v0.3 三个子阶段 e2e 测试编写的**统一骨架**
- 与单元测试互补：**单测**覆盖模块边界 / **e2e** 覆盖场景完整性
- 与 [`v0.1-demo-verification.md` § 6](research/v0.1-demo-verification.md) v0.1 子阶段 6 条 e2e 互补：本文档是**完整场景**清单（共 N 条），v0.1 demo 报告是**最小 6 条**必跑

---

## 2. 测试分层

| 层级 | 工具 | 覆盖 | 实施位置 | 数量预算 |
| --- | --- | --- | --- | --- |
| **单元测试** | Vitest | 模块边界 / 函数行为 / 边界条件 | `packages/plugin/src/**/*.spec.ts` | 每个文件 ≥ 3 个 it |
| **集成测试** | Vitest + cordis loader | cordis effect 链 / DSH service mock | `packages/plugin/tests/integration/*.spec.ts` | ≥ 10 个 |
| **端到端测试** | Vitest + Playwright（真实 DSH web demo）| 完整场景 / UI 交互 / 键盘 / a11y | `packages/plugin/tests/e2e/*.spec.ts` | ≥ 12 个（**MVP 6 场景 + 6 扩展**）|
| **覆盖率 gate** | `test:coverage` | 100% per-file（DSH 标准）| `pnpm run test:coverage` | 强制 |
| **a11y 测试** | axe-core / Playwright | WCAG 2.1 AA | `packages/plugin/tests/a11y/*.spec.ts` | ≥ 4 个 |
| **视觉回归** | Playwright screenshot | 关键 UI 快照 | `packages/plugin/tests/visual/*.spec.ts` | ≥ 6 个 |

---

## 3. MVP 6 场景 e2e 测试

### 3.1 E-A：单 session 内进度可视化（场景 A）

```gherkin
Feature: 单 session 内进度可视化

Scenario: A.1-A.4 — Session 视图层 + 进度可视化
  Given 用户在 DSH web 启动一个空 skyaxis session
  And conversation 中有 1 个 turn（含 3 个 tool calls）
  When 用户开启 P3 shell.overlay 拓扑视图
  Then 拓扑显示 1 root session 节点
  And SUB.5 时间线显示 1 个 turn、3 个 tool call 节点
  And Task DAG 节点状态从 pending → running → done
  When 用户点击 session 卡片
  Then Session 详情面板展开
  And 显示 status / 标签 / 创建时间 / subagent 数

Scenario: A.5 + SUB.1-SUB.6 — Subagent 拓扑纵深补强
  Given root session 已派生 3 个 subagent（其中 1 个 running）
  When 用户在 P3 overlay 查看
  Then 拓扑显示 1 root + 3 子节点
  And 1 个子节点显示 running state（StateDot="ongoing"）
  And 子节点 metadata 显示 mode（one-shot / continuable）/ label
  When 用户 hover 子节点 150ms
  Then 显示 tooltip（active duration 实时刷新 1s）
  When 用户点击 "Catalog refresh" 按钮
  Then Catalog 状态从 ready → loading → ready
  And 失败重试显示 error state + "Retry" 按钮
```

### 3.2 E-B：跨 session 产出聚合（场景 B）

```gherkin
Feature: 跨 session 产出聚合

Scenario: B.1 + B.2 — Decision / Snippet 聚合
  Given 用户历史 5 个 session
  And 跨 session 共有 3 个 Decision + 7 个 Snippet 标记
  When 用户进入 B 跨 session 聚合面板
  Then 显示 3 个 Decision 卡片 + 7 个 Snippet 卡片
  And 每个卡片显示 source session / 标签 / 时间
  When 用户按标签过滤
  Then 显示符合标签的 Decision / Snippet

Scenario: B.3 — 跨 session 时间线
  Given 5 个 session 共 20 个关键事件
  When 用户进入跨 session 时间线视图
  Then 20 个事件按 .time 全局排序
  And 同 .time 按 .seq 保序
  And 区分 session 颜色
```

### 3.3 E-C：多 session 总览（场景 C）

```gherkin
Feature: 多 session 总览

Scenario: C.1-C.4 — Session 列表 + 过滤 + 搜索
  Given 用户历史 12 个 session（status 混合：active 3 / idle 4 / done 5）
  When 用户进入 C 多 session 总览
  Then 显示 12 个 session 卡片
  And 每个卡片显示 status / 当前 task / 进度 / sub-agent 数
  When 用户按 status 过滤 active
  Then 显示 3 个 active session
  When 用户按标签 "backend" 过滤
  Then 显示符合标签的 session
  When 用户在搜索框输入 "feature-x"
  Then 显示名字含 "feature-x" 的 session
```

### 3.4 E-D：session 决策 / 代码片段归档（场景 D / v0.3）

```gherkin
Feature: session 决策 / 代码片段归档

Scenario: D.1-D.3 — Decision / Snippet 标记
  Given 用户在 conversation 中查看 1 个 turn
  When 用户右键 turn → "标记为 Decision"
  Then Decision 创建成功
  And 显示在 Decision 列表
  When 用户选中一段代码 → "标记为 Snippet"
  Then Snippet 创建成功
  And 用户添加标签 "auth" / "security"
  When 用户保存
  Then Decision / Snippet 含标签

Scenario: D.4-D.5 — 全文搜索 + 标签过滤
  Given 跨 session 共有 50 个 Decision + Snippet
  When 用户在搜索框输入 "rate-limit"
  Then 显示含 "rate-limit" 关键字的 Decision / Snippet
  When 用户按标签 "auth" 过滤
  Then 仅显示含 "auth" 标签的 Decision / Snippet
```

### 3.5 E-D1：session 内 task DAG（场景 D1 / v0.2）

```gherkin
Feature: session 内 task DAG

Scenario: D1.1-D1.3 — Task 依赖推断 + DAG 可视化
  Given session 中有 5 个 tool calls（call 1 → call 2 → call 3, call 2 → call 4, call 4 → call 5）
  When 用户进入 task DAG 视图
  Then DAG 显示 5 个节点 + 4 条边
  And 节点 hover 显示 Task 详情（耗时 / 参数 / 结果）
  And DAG 拓扑排序正确

Scenario: D1.4 — Subagent Tree × Task DAG 双视图联动
  Given session 内有 1 root + 2 subagent
  And 每个 subagent 含 2 个 task
  When 用户同时打开 Subagent Tree + Task DAG 双视图
  Then 在 Subagent Tree 选中 1 个 subagent
  And Task DAG 高亮该 subagent 的 2 个 task 节点
```

### 3.6 E-D2：session 间依赖（场景 D2 / v0.2）

```gherkin
Feature: session 间依赖

Scenario: D2.1 + D2.2 — SessionDependency 自动推断 + 可视化
  Given session A 输出被 session B 引用
  And session A 输出被 session C 引用
  When 用户进入 Session 依赖图
  Then 显示 3 个 session 节点 + 2 条边（A → B / A → C）
  And 边为实线（自动推断）

Scenario: D2.3 — 手动声明 Session 依赖
  Given session D 与 session E 无自动依赖
  When 用户在 UI 手动添加契约 "D 输入 → E 输出"
  Then 依赖图显示 1 条虚线（D → E）

Scenario: D2.4 — Subagent 父子关系"实线"展示
  Given 父子 subagent 关系
  When 用户在依赖图查看
  Then 父子关系显示为实线（区别于手动契约的虚线）
```

---

## 4. ADR 0009 subagent 拓扑 e2e 测试（v0.1 / v0.2）

### 4.1 E-SUB-1：拓扑视图渲染（[调研报告 8](research/canvas-interaction-nfr.md)）

```gherkin
Feature: 拓扑视图渲染

Scenario: 64 session 节点性能基准
  Given 64 个 session 拓扑数据
  When 用户打开 P3 overlay 拓扑视图
  Then React Flow mount 完成 < 100ms
  And fitView 自动聚焦全部节点 < 50ms
  And DOM 中仅渲染视口内节点（8-16 个）

Scenario: running 节点 1s 定时器刷新
  Given 拓扑视图打开
  And 1 个子节点显示 running
  When 用户等待 3 秒
  Then running 节点的 active duration 显示从 0s → 3s
  And 1s 精度刷新（不是 100ms 抖动）

Scenario: prefers-reduced-motion 适配
  Given 用户系统启用 prefers-reduced-motion: reduce
  When 用户打开拓扑视图
  Then 边动画关闭
  And 节点 transition 关闭
```

### 4.2 E-SUB-2：节点状态机（`running / settled`）

```gherkin
Feature: 节点状态机

Scenario: 状态机转换
  Given 1 个 session 节点
  When 该 session 进入 running
  Then 节点 StateDot 从 done → ongoing
  And 节点 aria-label 更新为 "session-x, running"
  When 该 session 转为 settled
  Then 节点 StateDot 从 ongoing → done
  And 节点 aria-label 更新为 "session-x, settled"
```

### 4.3 E-SUB-3：节点 metadata

```gherkin
Feature: 节点 metadata

Scenario: metadata 显示
  Given 1 个 subagent 节点
  When 用户查看节点
  Then 显示 mode（one-shot / continuable）
  And 显示 label / hasChildren / activity
  And 显示活跃 duration
  And duration 实时刷新（1s 精度）
```

### 4.4 E-SUB-4：Catalog refresh + retry（[调研报告 4](research/skyaxis-panel-architecture.md)）

```gherkin
Feature: Catalog refresh + retry

Scenario: 三态切换
  Given Catalog 当前 ready
  When 用户点击 "Refresh" 按钮
  Then 状态从 ready → loading
  And 500ms 后回到 ready
  And 数据更新

Scenario: error + retry
  Given Catalog 加载失败（mock 404）
  When Catalog 状态变为 error
  Then 显示 "Unable to load subagents" 错误信息
  And 显示 "Retry" 按钮
  When 用户点击 Retry
  Then 重新请求 → loading → ready
```

### 4.5 E-SUB-5：Read-only session event 时间线（[调研报告 5](research/trajectory-merger-algorithm.md)）

```gherkin
Feature: Read-only session event 时间线

Scenario: 时间线初始化
  Given session 含 50 个 events
  When 用户进入 SUB.5 时间线
  Then `ctx.sessionQuery.readSurface(id)` 返回 50 个 events
  And events 按 .time 升序
  And 显示 50 个时间线节点

Scenario: 增量更新
  Given 时间线已显示 50 个 events
  When session 新增 5 个 events
  Then `ctx.sessionProjections.onChanged` 触发
  And 时间线局部重渲染（不重建 50 个）
  And 新增 5 个事件按 .time 插入正确位置
```

### 4.6 E-SUB-6：独立 panel 架构（[调研报告 4](research/skyaxis-panel-architecture.md)）

```gherkin
Feature: 独立 panel 架构

Scenario: P3 overlay 与三列正交
  Given P3 overlay 已打开
  When 用户切换 main panel（不同 session）
  Then overlay 仍保持显示
  And overlay 内拓扑节点更新
  When 用户切换 rightbar 视图
  Then overlay 不受影响
  When 用户折叠 sidebar
  Then overlay 不受影响

Scenario: 与 dockkit 不兼容的处理
  Given DSH dockkit 在 rightbar split/float 1 个 tab
  When skyaxis P2 rightbar tab 注册
  Then skyaxis tab 出现在 rightbar tab list
  And 不参与 dockkit split/float（设计意图）

Scenario: shell.overlay ESC + restoreFocus
  Given P3 overlay 已打开（焦点在第 5 节点）
  When 用户按 ESC
  Then overlay 关闭
  And 焦点回到 trigger 按钮
  And 视觉无抖动（queueMicrotask 完成）
```

---

## 5. 6 项非功能性需求 e2e 测试

### 5.1 NF-1：性能（[调研报告 5 § 9](research/trajectory-merger-algorithm.md)）

```gherkin
Feature: 性能基准

Scenario: N=64 session 性能
  Given 64 个 session 拓扑数据
  When 首次合并 events
  Then 完成 < 500ms
  When 增量更新 1 个 event
  Then 完成 < 16ms（60fps）
  And 内存 < 50MB

Scenario: 画布拖拽流畅
  Given 拓扑视图打开
  When 用户拖拽 64 个节点连续 5 秒
  Then 平均帧率 ≥ 60fps
  And 无明显卡顿（p95 < 16ms）
```

### 5.2 NF-2：视觉一致性（DSH ui-primitives）

```gherkin
Feature: 视觉一致性

Scenario: 与 DSH 主题一致
  Given skyaxis panel 打开
  When 用户切换 DSH 主题（light / dark）
  Then skyaxis 颜色 token 跟随切换
  And `--dsh-bg-surface` / `--dsh-border-default` 等 token 一致

Scenario: 与 DSH ui-subagent 视觉对比
  Given skyaxis topology 与 DSH ui-subagent lineage
  When 视觉快照对比
  Then 间距 / 字号 / 圆角一致
```

### 5.3 NF-3：i18n（[调研报告 6 § 11](research/cordis-effect-lifecycle.md)）

```gherkin
Feature: i18n

Scenario: 中文显示
  Given DSH locale 设置为 zh
  When skyaxis panel 打开
  Then 所有用户可见文案显示中文
  And 无 hardcoded 英文字符串（verify-client-ui-i18n 通过）

Scenario: 英文显示
  Given DSH locale 设置为 en
  When skyaxis panel 打开
  Then 所有用户可见文案显示英文

Scenario: locale 切换
  Given 用户切换 zh → en
  Then skyaxis 文案立即刷新
  And 无残留中文
```

### 5.4 NF-4：DSH 版本兼容

```gherkin
Feature: DSH 版本兼容

Scenario: 钉钉版本加载
  Given DSH v0.1.5-rc.2 锁定
  When skyaxis plugin 加载
  Then 无 "deprecated API" 警告
  And 所有 6 只读服务 API 在钉钉版本可用

Scenario: DSH 升级模拟（手动）
  Given DSH commit 升级到 <新 commit>
  When skyaxis plugin 加载
  Then 加载失败 / 部分功能失效（预期）
  And 报告到 ADR 0010 升级评估清单
```

### 5.5 NF-5：可访问性（a11y / [调研报告 8 § 6](research/canvas-interaction-nfr.md)）

```gherkin
Feature: 可访问性

Scenario: Tab 焦点链
  Given P3 overlay 打开
  When 用户按 Tab
  Then 焦点到第 1 个 topology 节点
  And 焦点环显示（focus-visible）
  When 用户按 Tab 继续
  Then 焦点顺序：节点 1 → 节点 2 → ... → MiniMap → Controls
  And 无焦点陷阱（focus trap 不劫持内部 tab）

Scenario: 屏幕阅读器公告
  Given 用户用 VoiceOver / NVDA
  When 用户选中 1 个节点
  Then 屏幕阅读器读 "node selected, session-x, running"
  When 用户 ArrowKey 移动节点
  Then 屏幕阅读器读 "node moved right to position (x, y)"

Scenario: 高对比度模式
  Given 用户系统启用 prefers-contrast: more
  When skyaxis panel 打开
  Then 节点边框加粗 + 系统色（Canvas / CanvasText）
  And 边颜色增强

Scenario: 键盘 a11y 完整流程（[调研报告 8 § 6](research/canvas-interaction-nfr.md) E5）
  Given P3 overlay 拓扑视图打开
  When 用户 Tab → 焦点到第一个节点
  And 用户 ArrowDown → 焦点到下一个节点
  And 用户 Enter → 进入会话详情（P2 rightbar tab 打开）
  And 用户 Esc → 关闭 P2 tab，焦点回到 topology 节点
  And 用户 Esc → 关闭 overlay，焦点回到 trigger 按钮
  Then 焦点链：trigger → 节点 → P2 tab → 节点 → trigger
```

### 5.6 NF-6：内存与生命周期（[调研报告 6 § 14](research/cordis-effect-lifecycle.md)）

```gherkin
Feature: 内存与生命周期

Scenario: HMR-safety
  Given skyaxis plugin 已加载
  When HMR 触发 dispose → 重新 mount
  Then 旧 fiber 全部 dispose
  And DOM 节点清理（无残留）
  And cordis effect 注册项清理
  And useOnSelectionChange listener 取消
  And useRunningTick interval clear
  And 内存泄漏 < 1MB

Scenario: 多实例隔离
  Given skyaxis plugin 加载 2 次（不同 ctx）
  When 2 个 instance 同时运行
  Then instance 间无 listener 串扰
  And 各自 dispose 后清理
```

---

## 6. 工程硬性约束 e2e 测试（observe-only 边界）

```gherkin
Feature: 工程硬性约束

Scenario: verify-skyaxis-readonly oxlint 规则
  Given skyaxis 仓根 oxlint 配置含 verify-skyaxis-readonly 规则集
  When 开发者提交含 `ctx.subagents.register(...)` 的代码
  Then lint 拒绝（"observe-only violation"）
  When 开发者提交含 `ctx.sessionProjections.register(...)` 的代码
  Then lint 拒绝（"no-register-projection"）
  When 开发者提交不含 default export 的 plugin
  Then lint 拒绝（"require-named-export"）
  When 自定义节点缺 aria-label
  Then lint 拒绝（"require-node-aria-label"）

Scenario: cordis provide 重名抛错
  Given skyaxis apply() 声明 `ctx.provide('skyaxis', ...)`
  When DSH 加载时
  Then 第二次 `ctx.provide('skyaxis', ...)` 抛错（"Misconfiguration fails loud"）

Scenario: HMR-safety 严格配对
  Given skyaxis apply() 含 5 个 ctx.effect / ctx.on 注册
  When fiber dispose
  Then 5 个注册全部清除（无残留）
  And 内存引用计数下降（无循环引用）
```

---

## 7. 边界条件与错误处理 e2e

```gherkin
Feature: 边界条件与错误处理

Scenario: 空 session
  Given 1 个空 session（无 events）
  When 用户进入 SUB.5 时间线
  Then 显示 "no events" 占位
  And 不报错

Scenario: session dispose 中
  Given 用户在 SUB.5 时间线
  When session 被 dispose
  Then 时间线降级为 cold read
  And 显示 "session disposed" 提示
  And 内存清理

Scenario: 部分 session 不可读
  Given 5 个 session 中 2 个无权限读
  When 用户进入跨 session 视图
  Then 3 个 session 正常显示
  And 2 个 session 显示 "access denied" 占位
  And 总数仍显示 5（不静默隐藏）

Scenario: cycle detection fallback
  Given 拓扑数据含 1 个环（A → B → C → A）
  When 用户打开拓扑视图
  Then 不无限循环
  And 显示环检测告警
  And 渲染降级（环节点显示 "cycle" 标签）

Scenario: 时钟漂移
  Given session A 最后一个 event time = 12:00:00.500
  And session B 第一个 event time = 12:00:00.500（同 .time）
  When 跨 session 合并
  Then 按 .seq 保序（A seq 100 → B seq 0）
  And 不出现顺序错误

Scenario: turn 边界缺失
  Given 1 个 session 含 turn/start 但无 turn/end
  When 用户进入时间线
  Then 显示 in-progress turn（按 turn/start 起始 + 当前时间）
  And 不报错
```

---

## 8. 实施计划

### 8.1 文件结构

```
packages/plugin/
  src/
    client/
      overlay/
        topology/
          TopologyCanvas.tsx
          SessionNode.tsx
          SubagentEdge.tsx
          ... (10+ 文件)
      session-event/
        SessionEventTimeline.tsx
        ... (5+ 文件)
    ... (其他模块)
  tests/
    unit/                                  # 单测（每个 src 文件 ≥ 3 it）
      client/overlay/topology/TopologyCanvas.spec.tsx
      client/session-event/SessionEventTimeline.spec.tsx
      ...
    integration/                            # 集成测试（cordis loader + mock）
      cordis-effect-cleanup.spec.ts
      dsh-service-mock.spec.ts
      trajectory-merger.spec.ts
      ...
    e2e/                                    # 端到端（≥ 12 条 MVP + 扩展）
      E-A-session-timeline.spec.ts          # § 3.1
      E-B-cross-session-aggregate.spec.ts   # § 3.2
      E-C-multi-session-overview.spec.ts    # § 3.3
      E-D-decision-snippet.spec.ts          # § 3.4
      E-D1-task-dag.spec.ts                 # § 3.5
      E-D2-session-dependency.spec.ts       # § 3.6
      E-SUB-1-topology-render.spec.ts       # § 4.1
      E-SUB-2-node-state-machine.spec.ts    # § 4.2
      E-SUB-3-node-metadata.spec.ts         # § 4.3
      E-SUB-4-catalog-refresh.spec.ts       # § 4.4
      E-SUB-5-event-timeline.spec.ts        # § 4.5
      E-SUB-6-panel-architecture.spec.ts    # § 4.6
      E-NF-1-performance.spec.ts            # § 5.1
      E-NF-2-visual-consistency.spec.ts     # § 5.2
      E-NF-3-i18n.spec.ts                   # § 5.3
      E-NF-4-dsh-compat.spec.ts             # § 5.4
      E-NF-5-a11y.spec.ts                   # § 5.5
      E-NF-6-memory-lifecycle.spec.ts       # § 5.6
      E-CONSTRAINTS-observe-only.spec.ts    # § 6
      E-EDGE-boundary-conditions.spec.ts    # § 7
    a11y/                                   # a11y 专项（≥ 4 个）
      keyboard-navigation.spec.ts
      aria-labels.spec.ts
      focus-management.spec.ts
      screen-reader.spec.ts
    visual/                                 # 视觉回归（≥ 6 个）
      topology-light.spec.ts
      topology-dark.spec.ts
      timeline-light.spec.ts
      timeline-dark.spec.ts
      session-list-light.spec.ts
      session-list-dark.spec.ts
    fixtures/                               # 共享 fixture
      session-1.timeline.json
      session-2.subagent-chain.json
      session-3.mixed-status.json
      topology-64-sessions.json
      decision-snippet-corpus.json
```

### 8.2 测试框架栈

```json
{
  "devDependencies": {
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "@axe-core/playwright": "^4.10.0",
    "playwright": "^1.48.0"
  }
}
```

### 8.3 测试命令

```bash
# 单测
pnpm run test                           # 全跑
pnpm run test --watch                   # 监视模式
pnpm run test tests/unit/client/overlay # 单跑某目录
pnpm run test -t "SessionEventTimeline" # 按名称过滤

# 覆盖率（CI gate）
pnpm run test:coverage                  # 100% per-file gate

# 端到端
pnpm run test:e2e                                # 全跑（需 DEEPSEEK_API_KEY）
pnpm run test:e2e -- e2e/E-A-session-timeline    # 单跑某 e2e
DEEPSEEK_BASE_URL=... pnpm run test:e2e -t E2    # 自定义 endpoint

# a11y
pnpm run test:a11y                       # axe-core + 键盘测试

# 视觉回归
pnpm run test:visual                     # Playwright screenshot 对比
pnpm run test:visual:update              # 更新快照

# 完整 CI
pnpm run test && pnpm run test:coverage && pnpm run test:e2e && pnpm run lint && pnpm run typecheck
```

---

## 9. 测试通过条件（与 [CLAUDE.md 第 2.4 节验收标准](../CLAUDE.md) 衔接）

| 维度 | 子维度 | 通过条件 |
| --- | --- | --- |
| **功能完整性** | 6 个 MVP 场景 | E-A / E-B / E-C / E-D / E-D1 / E-D2 全过 |
| | ADR 0009 扩展 | E-SUB-1 / E-SUB-2 / E-SUB-3 / E-SUB-4 / E-SUB-5 / E-SUB-6 全过 |
| **可用性** | a11y | E-NF-5 + a11y/ 4 个全过 |
| | i18n | E-NF-3 全过 |
| | 性能 | E-NF-1 全过（< 500ms 首 / < 16ms 增量 / 60fps）|
| | 视觉 | E-NF-2 + visual/ 6 个全过 |
| **文档完整性** | README + ADR + 调研 | 全在仓 |
| **测试覆盖** | per-file 100% | `pnpm run test:coverage` 全过 |
| | 端到端 ≥ 12 个 | E-A / B / C / D / D1 / D2 + E-SUB-1-6 全过（共 12+）|
| **observe-only 边界** | oxlint + cordis 重名 + HMR-safety | E-CONSTRAINTS + 单元测试全过 |

---

## 10. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | **初版**。10 章 + 19 条 e2e 测试场景：§ 1 文档目的 / § 2 测试分层（单测 / 集成 / e2e / 覆盖率 / a11y / 视觉回归 6 层级）/ § 3 MVP 6 场景 e2e（E-A / E-B / E-C / E-D / E-D1 / E-D2 共 8 个 scenario）/ § 4 ADR 0009 subagent 拓扑 6 个 e2e（E-SUB-1-6 含 64 性能基准 + 1s 定时器 + prefers-reduced-motion + 节点状态机 + metadata + Catalog refresh + timeline 增量更新 + panel 正交 + dockkit 不兼容 + ESC restoreFocus）/ § 5 6 项非功能性需求 e2e（E-NF-1 性能 / E-NF-2 视觉 / E-NF-3 i18n / E-NF-4 DSH 兼容 / E-NF-5 a11y 含键盘 + 屏幕阅读器 + 高对比度 / E-NF-6 内存 HMR）/ § 6 工程硬性约束 e2e（observe-only 边界 + provide 重名抛错 + HMR-safety 严格配对）/ § 7 边界条件 e2e（空 session / dispose 中 / 部分不可读 / cycle detection / 时钟漂移 / turn 边界缺失）/ § 8 实施计划（文件结构 6 个目录 + Vitest + Playwright + axe-core + coverage + a11y + visual 共 19+ e2e + fixtures/ + 4 类测试命令）/ § 9 测试通过条件（功能完整性 / 可用性 / 文档完整性 / 测试覆盖 / observe-only 边界 5 维）/ § 10 修订记录。**与 [`v0.1-demo-verification.md` § 6](research/v0.1-demo-verification.md) v0.1 子阶段 6 条 e2e 互补**：本文档是**完整场景**清单（19 条），v0.1 demo 报告是**最小 6 条**必跑。同步更新本变更日志。 |

---

## 相关 ADR / 文档

- [ADR 0003 — MVP 场景清单](decisions/0003-MVP场景清单.md)
- [ADR 0008 — 每阶段验收标准](decisions/0008-每阶段验收标准.md)
- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [ADR 0011 — shell.overlay 浮层实施约束](decisions/0011-shell.overlay浮层实施约束.md)
- [MVP 功能点拆解](scope/mvp-features.md)
- [里程碑 + 通过条件](milestones/roadmap.md)
- [验收维度 4 维](milestones/acceptance.md)
- [v0.1 demo 验证报告（占位骨架）](research/v0.1-demo-verification.md)
- [调研报告 — skyaxis 独立 panel 架构](research/skyaxis-panel-architecture.md)
- [调研报告 — trajectory merger 算法细化](research/trajectory-merger-algorithm.md)
- [调研报告 — DSH Cordis plugin effect 生命周期](research/cordis-effect-lifecycle.md)
- [调研报告 — DSH Session Projection + Cache Invalidation](research/session-projection-cache.md)
- [调研报告 — 画布交互 NFR 详细化](research/canvas-interaction-nfr.md)
- [CLAUDE.md](../CLAUDE.md)
- [DSH AGENTS.md](../deepseek-harness/CLAUDE.md)
