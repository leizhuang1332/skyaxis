# DSH ui-primitives 复用清单细化 — 调研报告

| 字段 | 值 |
| --- | --- |
| **调研目标** | 把 MVP 6 场景 + ADR 0009 SUB + 6 NF 横切关注点的 UI 需求，逐项映射到 DSH ui-primitives 具体组件，给出"直接复用 / 自写 / 不需要"的明确决策 |
| **覆盖** | ui-primitives 全量组件盘点（73 行导出）+ MVP 场景 × 组件映射矩阵 + 复用风险 |
| **调研对象** | [`deepseek-harness/packages/client/ui-primitives/](../deepseek-harness/packages/client/ui-primitives/)`（v0.1.5-rc.2），只读访问 |
| **日期** | 2026-09-19 |
| **前置调研** | [research/dsh-consume-map.md](dsh-consume-map.md) / [research/dsh-workspace-integration.md](dsh-workspace-integration.md) |

---

## 1. 调研范围与方法

### 1.1 范围

**只盘点 UI 组件复用**，**不**讨论：

- 状态管理（Zustand 已在 [ADR 0010](decisions/0010-技术选型-MVP实施期.md) 锁定）
- 拓扑图库（React Flow 已在 ADR 0010 锁定）
- DSH 6 只读服务消费路径（已在 [research/dsh-consume-map.md](dsh-consume-map.md)）

### 1.2 方法

逐行读 [`packages/client/ui-primitives/src/index.ts`](../deepseek-harness/packages/client/ui-primitives/src/index.ts)（73 行全量 export），按**类别**（状态 / 交互 / 容器 / 品牌 / 图标 / 内容 / Hooks / Utilities）分组；对照 [docs/scope/mvp-features.md](../scope/mvp-features.md) 的 40 个功能点 + [docs/users/persona-a-scenarios.md](../users/persona-a-scenarios.md) 的 5 个剧本 + [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 的 SUB.1-SUB.6，做"组件 × 场景"二维矩阵。

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| [`packages/client/ui-primitives/src/index.ts`](../deepseek-harness/packages/client/ui-primitives/src/index.ts) | 73 行全量 export 一手清单 |
| [docs/scope/mvp-features.md](../scope/mvp-features.md) | 40 个功能点 + A / B / C / D / D1 / D2 / SUB / NF 八组 |
| [docs/users/persona-a-scenarios.md](../users/persona-a-scenarios.md) | 5 个剧本对应场景的 UI 需求 |
| [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) | SUB.1-SUB.6 拓扑视图需求 |
| [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md) | React Flow / Zustand 锁定；本调研仅锁定 ui-primitives 这一类 |

---

## 2. DSH ui-primitives 全量组件盘点

按类别整理（73 行 export → 约 60 个原子 + 13 个 utilities + 4 个 hooks）：

### 2.1 状态类（5 个）

| 组件 | 类型 / 状态 | 用途 |
| --- | --- | --- |
| `StateDot` | `<StateDotState>` | 单圆点状态指示（运行/错误/空闲） |
| `ConnectionIndicator` | `<ConnectionIndicatorState>` | 连接状态（DSH web-specific，skyaxis 可能不用） |
| `Pill` | （无类型 export） | 胶囊标签 |
| `Tag` | `<TagTone>` | 带 tone 的小标签 |
| `Toast` | （无类型 export） | 顶部短暂通知 |

### 2.2 交互类（9 个 + 1 hook）

| 组件 / Hook | 类型 | 用途 |
| --- | --- | --- |
| `Button` | `<ButtonVariant>` | 通用按钮（多 variant） |
| `Input` | （无类型 export） | 文本输入 |
| `Switch` | （无类型 export） | 开关切换 |
| `Menu` | `<MenuEntry, MenuItem, MenuSeparator, MenuLabel>` | 下拉菜单 |
| `Tooltip` | `<TooltipSide>` | 悬浮提示 |
| `HoverCard` | （无类型 export） | 悬浮卡片 |
| `Modal` | （无类型 export） | 模态对话框 |
| `DisclosureRow` | `<DisclosureRowProps>` | 可展开 / 收起行 |
| `useDismissOnOutsidePointer` | hook | 点击外部自动关闭 |
| `RiskConfirmation` | `<RiskConfirmationProps>` | 风险确认弹窗（skyaxis 可能不用） |
| `OnboardingSurface` | （无类型 export） | 新手引导面板 |

### 2.3 容器类（1 个 + 2 hooks）

| 组件 / Hook | 类型 | 用途 |
| --- | --- | --- |
| `DisclosureRow` | （已在交互类）| |
| `useAnchoredMaxHeight` | hook | 锚定最大高度（避免超出视口）|
| `useAnchoredPosition` | `<AnchoredPositionOptions>` | 锚定定位（Tooltip / HoverCard 用） |

### 2.4 品牌类（3 个）

| 组件 | 类型 / 常量 | 用途 |
| --- | --- | --- |
| `FishLogo` | `FISH_LOGO_PATH, FISH_LOGO_VIEWBOX` | DSH 鱼形 logo（skyaxis 可选） |
| `BrandWordmark` | `<BrandWordmarkProps>` | DSH 品牌字标 |
| `projectUserText` | （util） | 用户/项目名称占位文本 |

### 2.5 图标类（4 个 + 图标集合）

| 组件 / 工具 | 类型 | 用途 |
| --- | --- | --- |
| `ReferenceIcon` | `<ReferenceIconKind, ReferenceIconProps>` | 引用源图标（文件/web/git） |
| `LinkIcon` | `<LinkIconKind, LinkIconProps>` + `classifyLinkPath` | 链接类型图标 |
| `FileTypeIcon` | `<CodeFileType, FileType, FileTypeIconProps, FileTypeKind, FileTypeProjectContext>` + `classifyFileType, fileExtension` | 文件类型图标（按扩展名分类）|
| `icons` 集合 | （`export * from './icons/index.tsx'`）| 全套 UI 图标（按需 import） |

### 2.6 内容类（10 个 + utilities）

| 组件 / 工具 | 类型 | 用途 |
| --- | --- | --- |
| `JsonTree` | `<JsonTreeProps, JsonTreeLabels>` | JSON 树形渲染 |
| `TerminalBlock` | `<TerminalBlockProps, TerminalBlockLabels>` | 终端输出块 |
| `ReadBlock` | `<ReadBlockProps, ReadBlockLine, ReadBlockLabels>` | 文件读取块 |
| `DiffBlock` | `<DiffBlockProps, DiffHunk, DiffBlockLabels>` + `diffTotals, DEFAULT_DIFF_MAX_LINES` | 代码 diff 块 |
| `SearchBlock` | `<SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch, SearchBlockLabels>` | 搜索结果块 |
| `WebBlock` | `<WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView, WebBlockLabels>` | Web 搜索/抓取块 |
| `CodeBlock` | `<CodeBlockProps>` | 通用代码块 |
| `JsonBlock` | （无类型 export） | JSON 代码块 |
| `MarkdownText` | `<MarkdownCodeLabels, MarkdownFileMentions, MarkdownLabels, MarkdownPathImages>` | Markdown 渲染 |
| `extractMarkdownPlainText` | `<MarkdownPlainTextMode, MarkdownPlainTextOptions>` | 提取 markdown 纯文本 |

### 2.7 Utilities（6 个）

| 工具 | 类型 | 用途 |
| --- | --- | --- |
| `fileSizeText` | （util）| 文件大小文本（如 "1.2 KB"）|
| `writeClipboard` | （util）| 写入剪贴板 |
| `relativeTime` | `<RelativeTime, RelativeTimeUnit>` + `rankByName` | 相对时间（"3 分钟前"）|

---

## 3. MVP 场景 × ui-primitives 映射矩阵

> 图例：✅ **直接复用** | 🛠 **复用 + 包装** | ✍️ **自写** | ❌ **不需要**

### 3.1 场景 A：单 session 内进度可视化

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **A.1** Session 元数据视图 | 列表 / 卡片 + 状态点 | `StateDot` + `Pill` + `DisclosureRow` | ✅ 直接复用 |
| **A.2** Task 自动抽取 | Task 列表 / 树 | `DisclosureRow`（嵌套做树）| 🛠 复用 + 包装成 TaskTreeNode |
| **A.3** 单 session 进度可视化 | 进度条 | （ui-primitives 无 ProgressBar）| ✍️ 自写（基于 React Flow node height 或简单 div） |
| **A.3** | 时间线 | （ui-primitives 无 TimelineRail）| ✍️ 自写（基于 React Flow 横向 layout） |
| **A.4** Session 详情面板 | 点击展开 | `DisclosureRow` + `HoverCard` | ✅ 直接复用 |
| **A.5** Subagent Tree 自动展开（场景 A 补强） | Subagent tree | `DisclosureRow`（嵌套多级）+ `StateDot` | 🛠 复用 + 包装成 SubagentTreeNode |

**场景 A 自写清单**：ProgressBar / TimelineRail / TaskTreeNode / SubagentTreeNode（仅是 DisclosureRow 的语义包装）

**场景 A 复用总计**：✅ 4 个直接复用 + 🛠 2 个包装 + ✍️ 2 个自写

### 3.2 场景 B：跨 session 产出聚合

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **B.1** 跨 session Decision 聚合 | Decision 列表 | `DisclosureRow` + `Pill`（标签）+ `relativeTime` | ✅ 直接复用 |
| **B.2** 跨 session Snippet 聚合 | Snippet 列表（含代码片段） | `DisclosureRow` + `CodeBlock` + `Pill` | ✅ 直接复用 |
| **B.3** 跨 session 时间线 | 多 root 时间线 | `DisclosureRow`（按 session 折叠）+ `relativeTime` | 🛠 复用 + 包装成 TimelineGroup |
| **B.4** 跨 session 导出（可选） | 导出按钮 + Toast | `Button` + `Toast` + `writeClipboard` | ✅ 直接复用 |

**场景 B 复用总计**：✅ 3 个直接复用 + 🛠 1 个包装 + ✍️ 0 个自写

### 3.3 场景 C：多 session 总览

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **C.1** Session 列表 | 列表渲染 | `DisclosureRow` | ✅ 直接复用 |
| **C.2** Session 状态卡片 | 卡片含 status / task / 进度 | `StateDot` + `Pill` + 自写 ProgressBar | 🛠 复用状态，✍️ 自写进度条 |
| **C.3** Session 过滤 | 标签 / 状态 / 时间过滤 | `Menu` + `Switch` + 自写 FilterChip | 🛠 复用 Menu，✍️ 自写 FilterChip |
| **C.4** Session 搜索 | 搜索输入 | `Input` + `Button` | ✅ 直接复用 |

**场景 C 自写清单**：ProgressBar / FilterChip

**场景 C 复用总计**：✅ 2 个直接复用 + 🛠 2 个包装（含 1 个自写） + ✍️ 2 个自写

### 3.4 场景 D：session 决策 / 代码片段归档

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **D.1** Decision 主动标记 | 标记按钮 + Dialog | `Button` + `Modal` + `Input` | ✅ 直接复用 |
| **D.2** Snippet 主动标记 | 标记按钮 + snippet 选择 | `Button` + `Menu` + `Modal` | ✅ 直接复用 |
| **D.3** 标签系统 | Tag 编辑 | `Tag` + `Input` | ✅ 直接复用 |
| **D.4** 全文搜索 | 搜索结果 + 命中高亮 | `Input` + `SearchBlock`（**复用！**）| ✅ 直接复用 |
| **D.5** 标签过滤 | 标签过滤 | `Menu`（多选）+ `Tag` | ✅ 直接复用 |

**场景 D 复用总计**：✅ 5 个直接复用 + 🛠 0 个包装 + ✍️ 0 个自写（**复用率最高**）

### 3.5 场景 D1：session 内 task DAG

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **D1.1** Task 依赖推断 | （后台计算，无 UI）| — | ❌ 不需要 |
| **D1.2** Task DAG 可视化 | 拓扑图（React Flow） | 自写 TopologyCanvas | ✍️ 自写（React Flow 包装） |
| **D1.3** Task 节点 hover | 悬浮详情 | `HoverCard` + `MarkdownText`（读 trajectory）| ✅ 直接复用 |
| **D1.4** Subagent Tree × Task DAG 双视图联动（场景 D1 补强） | 视图切换 + 联动高亮 | `Button`（切换）+ `StateDot` | ✅ 直接复用 |

**场景 D1 自写清单**：TopologyCanvas（React Flow 包装，覆盖 SUB.2 / D1.2 / D2.2 三个图）

**场景 D1 复用总计**：✅ 2 个直接复用 + 🛠 0 个包装 + ✍️ 1 个自写

### 3.6 场景 D2：session 间依赖

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **D2.1** SessionDependency 自动推断 | （后台计算，无 UI）| — | ❌ 不需要 |
| **D2.2** Session 依赖图可视化 | 拓扑图（React Flow） | 同 D1.2 自写 TopologyCanvas | ✍️ 自写（共用同一 TopologyCanvas） |
| **D2.3** 手动声明 Session 依赖 | 手动添加按钮 + Modal | `Button` + `Modal` + `Menu` | ✅ 直接复用 |
| **D2.4** Subagent 父子关系"实线"展示（场景 D2 补强） | 边样式区分 | （React Flow edge style 自写）| ✍️ 自写（边样式） |

**场景 D2 复用总计**：✅ 1 个直接复用 + 🛠 0 个包装 + ✍️ 1 个自写（边样式与 TopologyCanvas 一体）

### 3.7 SUB：Subagent 拓扑（ADR 0009 拆解）

| 功能点 | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **SUB.1** 拓扑视图 | 多 root 并列画布 | 同 TopologyCanvas | ✍️ 自写（共用） |
| **SUB.2** 节点状态机 | running / settled | `StateDot`（running / settled）| ✅ 直接复用 |
| **SUB.3** 节点 metadata | mode / label / hasChildren / activity / 活跃 duration | `Pill` + `relativeTime` + `Tooltip` | ✅ 直接复用 |
| **SUB.4** Catalog refresh + retry | loading / ready / error 三态 | `StateDot` + `Button` + `Toast` | ✅ 直接复用 |
| **SUB.5** Read-only session event 时间线 | trajectory merger 视图 | `DisclosureRow`（按 turn 折叠）+ `relativeTime` + `MarkdownText` | ✅ 直接复用 |
| **SUB.6** 独立 panel 架构 | 独立 store + navigation | `Button`（导航）+ `DisclosureRow` | ✅ 直接复用 |

**SUB 复用总计**：✅ 6 个直接复用 + 🛠 0 个包装 + ✍️ 0 个自写（TopologyCanvas 在 SUB.1 已计入 D1.2）

---

## 4. NF 横切关注点 × ui-primitives

| NF | UI 需求 | ui-primitives 组件 | 决策 |
| --- | --- | --- | --- |
| **NF.1** 集成形态 B | 无 UI；--patch 加载 | — | ❌ 不需要 |
| **NF.2** observe-only | 无 UI；oxlint 规则 | — | ❌ 不需要 |
| **NF.3** 5 分钟跑起来 | README 截图 | `MarkdownText` 渲染 README | 🛠 复用（可选） |
| **NF.4** DSH 版本钉钉 | 无 UI | — | ❌ 不需要 |
| **NF.5** 纯本地 + 单端 | 无 UI | — | ❌ 不需要 |
| **NF.6** MIT 开源免费 | LICENSE 文件 + About 页 | `MarkdownText` 渲染 LICENSE | 🛠 复用（可选） |

**NF 自写清单**：无；ui-primitives 在 NF 维度几乎零贡献。

---

## 5. 全局映射汇总

### 5.1 按场景

| 场景 | ✅ 直接复用 | 🛠 复用 + 包装 | ✍️ 自写 | ❌ 不需要 | 复用率（✅ + 🛠） |
| --- | --- | --- | --- | --- | --- |
| **A** 单 session 进度可视化 | 4 | 2 | 2 | 0 | 75% |
| **B** 跨 session 聚合 | 3 | 1 | 0 | 0 | 100% |
| **C** 多 session 总览 | 2 | 2 | 2 | 0 | 50% |
| **D** 决策 / 片段归档 | 5 | 0 | 0 | 0 | 100% |
| **D1** task DAG | 2 | 0 | 1 | 1 | 67% |
| **D2** session 间依赖 | 1 | 0 | 1 | 1 | 50% |
| **SUB** Subagent 拓扑 | 6 | 0 | 0 | 0 | 100% |
| **NF** 横切 | 0 | 2 | 0 | 4 | 100% |
| **总计** | **23** | **7** | **6** | **6** | **76%（30/40）** |

### 5.2 按组件

| ui-primitives 组件 | 复用场景 | 复用次数 |
| --- | --- | --- |
| `DisclosureRow` | A.1/A.2/A.4/A.5 / B.1/B.2/B.3 / C.1 / D.4 / SUB.5/SUB.6 | **10** |
| `Button` | B.4 / C.4 / D.1/D.2 / D2.3 / SUB.4/SUB.6 | **7** |
| `StateDot` | A.1/A.5 / C.2 / D1.4 / SUB.2/SUB.4 | **6** |
| `Pill` | A.1 / B.1/B.2 / C.2 / SUB.3 | **5** |
| `relativeTime` | B.1/B.3 / SUB.3/SUB.5 | **4** |
| `Modal` | D.1/D.2 / D2.3 | **3** |
| `Input` | C.4 / D.1/D.3 | **3** |
| `Menu` | C.3 / D.2/D.5 / D2.3 | **4** |
| `CodeBlock` | B.2 | **1** |
| `SearchBlock` | D.4 | **1** |
| `Tag` | D.3/D.5 | **2** |
| `HoverCard` | A.4 / D1.3 | **2** |
| `MarkdownText` | D1.3 / SUB.5 / NF.3 | **3** |
| `Tooltip` | SUB.3 | **1** |
| `Switch` | C.3 | **1** |
| `Toast` | B.4 / SUB.4 | **2** |
| `writeClipboard` | B.4 | **1** |
| `JsonTree` / `TerminalBlock` / `ReadBlock` / `DiffBlock` / `WebBlock` / `JsonBlock` | — | **0**（skyaxis 不直接渲染） |
| `FishLogo` / `BrandWordmark` / `ReferenceIcon` / `LinkIcon` / `FileTypeIcon` / `icons` / `ConnectionIndicator` / `RiskConfirmation` / `OnboardingSurface` / `projectUserText` / `fileSizeText` / `extractMarkdownPlainText` / hooks | — | **0**（可选；skyaxis 不必复用） |
| **`StateDot` 是否覆盖 `ConnectionIndicator`** | skyaxis 自己状态机用 StateDot 足够；不用 ConnectionIndicator | 0 |

**核心组件 Top 5**：`DisclosureRow`（10）/ `Button`（7）/ `StateDot`（6）/ `Pill`（5）/ `relativeTime`（4）—— 复用频次集中。

---

## 6. 自写组件清单（不直接复用）

| 自写组件 | 用途 | 复用场景 | 优先级 |
| --- | --- | --- | --- |
| **ProgressBar** | 单 session 进度可视化（[mvp-features A.3](../scope/mvp-features.md)） | A.3 / C.2 | P0（v0.1） |
| **TimelineRail** | 时间线可视化 | A.3 / B.3 | P0（v0.1） |
| **TopologyCanvas** | 拓扑图（React Flow 包装） | D1.2 / D2.2 / SUB.1 | P0（v0.1） |
| **TaskTreeNode** | 任务树节点（A.2 / A.5 的 DisclosureRow 语义包装） | A.2 / A.5 | P1（v0.1） |
| **SubagentTreeNode** | Subagent 树节点（A.5 补强） | A.5 | P1（v0.1） |
| **FilterChip** | 过滤标签（C.3） | C.3 | P2（v0.2） |
| **EdgeStyle**（TopologyCanvas 子件） | subagent 父子"实线"vs 手动"虚线"区分 | D2.4 | P1（v0.2） |
| **TimelineGroup** | 多 session 时间线分组（B.3 包装） | B.3 | P2（v0.2） |

**自写总数**：8 个组件 / 工具类，覆盖 MVP 6 场景 + ADR 0009 SUB 的所有"自写"位。

---

## 7. 不需要组件的清单

| ui-primitives 组件 | 不复用原因 |
| --- | --- |
| `JsonTree` | skyaxis 不直接渲染 JSON 树（trajectory 由 DSH 渲染） |
| `JsonBlock` | 同上 |
| `TerminalBlock` | skyaxis 不直接渲染 terminal（trajectory 由 DSH 渲染） |
| `ReadBlock` | 同上 |
| `DiffBlock` | 同上 |
| `WebBlock` | 同上 |
| `SearchBlock` | **skyaxis 全文搜索（D.4）复用**；其他场景不用 |
| `ConnectionIndicator` | DSH web-specific；skyaxis 状态机用 `StateDot` 足够 |
| `RiskConfirmation` | skyaxis 不做风险确认流 |
| `OnboardingSurface` | skyaxis 不做新手引导（MVP 假设用户已熟悉 DSH） |
| `FishLogo` / `BrandWordmark` | skyaxis 自己的视觉（不在 skyaxis brand scope） |
| `ReferenceIcon` / `LinkIcon` / `FileTypeIcon` | skyaxis 不渲染 reference / link / file |
| `icons` 全集 | 仅按需（如果未来需要 close / expand 等基础图标） |
| `fileSizeText` / `extractMarkdownPlainText` | skyaxis 自身不展示文件大小 / 提取纯文本 |
| `useAnchoredMaxHeight` / `useAnchoredPosition` / `useDismissOnOutsidePointer` | skyaxis 自己的菜单 / 浮层自己控制定位（可用可不用） |

**"不需要"总数**：16 个组件 + 3 个 hook + 4 个 utility = 23 个

---

## 8. 复用风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 主题 token 不匹配** | ui-primitives 用 `--dsw-*` CSS tokens；skyaxis 独立运行时无该 tokens | skyaxis 必须运行在 DSH web profile 内；独立 demo 用 CSS variable fallback |
| **R.2 DSH 升级时组件行为变化** | ui-primitives 组件 props / 行为变化 | skyaxis 自写组件用 swr 模式包一层；升级前跑回归 |
| **R.3 自写组件 vs 复用组件视觉割裂** | 用户感知"skyaxis 不是 DSH 一部分" | 自写组件全部用 `var(--dsw-*)` 主题 token；设计前先看 ui-primitives 视觉规范 |
| **R.4 TaskTreeNode / SubagentTreeNode 与 DisclosureRow 嵌套深度** | DisclosureRow 嵌套过深（如 > 5 层）性能下降 | v0.1 子阶段先压平到 3 层；v0.2 改用 React Flow 做树 |
| **R.5 SearchBlock 不支持 skyaxis 全文检索格式** | skyaxis 的 Decision / Snippet 索引与 DSH 搜索不通用 | skyaxis 自写 SkyaxisSearchBlock（包装 SearchBlock props）|
| **R.6 缺 ProgressBar / TimelineRail** | ui-primitives 不含，skyaxis 必自写 | 列 § 6 P0 自写清单 |
| **R.7 行为缺失（如 Button loading state）** | 复用时遇到 ui-primitives 没暴露的状态 | 复用 + 包装（🛠）清单 § 3 已覆盖 |
| **R.8 i18n locale 未声明** | DSH ui-subagent 注册 zh / en 字典；skyaxis 必须注册自己的字典 | v0.1 实施期新建 `skyaxis.zh.json` / `skyaxis.en.json` 并通过 `ctx.locale.register(NS, ...)` 注册 |

---

## 9. 假设覆盖度更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 1（形态 B patch overlay）| （无新增） | 维持 [research/dsh-workspace-integration.md § 3.5](dsh-workspace-integration.md) |
| **新假设 9**：ui-primitives 组件足够支撑 MVP 6 场景 | ✅ 23 + 7 复用 + 6 自写 = 36 项 UI 需求全覆盖（仅 4 项 NF 横切无关） | **假设 9 暂成立**，待 v0.1 实施期验证 |
| **新假设 10**：自写组件不超过 8 个 | ✅ § 6 列出 8 个自写组件；其中 3 个 P0（v0.1）/ 3 个 P1（v0.2）/ 2 个 P2 | **假设 10 暂成立** |

---

## 10. v0.1 实施期第一周 UI 落地任务

按 § 6 P0 自写清单 + § 3 场景 A 复用：

1. **复用优先**（导入即用）：
   - `DisclosureRow` / `Button` / `StateDot` / `Pill` / `relativeTime`
2. **自写 P0**：
   - `ProgressBar`（A.3 / C.2）
   - `TimelineRail`（A.3 / B.3）
   - `TopologyCanvas`（React Flow 包装，D1.2 / D2.2 / SUB.1 共用）
3. **自写 P1**（v0.1 末尾）：
   - `TaskTreeNode`（DisclosureRow 包装）
   - `SubagentTreeNode`（DisclosureRow 包装）
4. **i18n 注册**：`skyaxis.zh.json` / `skyaxis.en.json`（R.8）
5. **主题 token fallback**：skyaxis 独立 demo 用 CSS variable fallback（R.1）

---

## 11. 一句话总结

> DSH ui-primitives 73 行 export → MVP 6 场景 + ADR 0009 SUB + 6 NF 的 40 项 UI 需求中 **23 直接复用 + 7 包装复用 = 76% 复用率**，自写仅需 8 个组件（3 P0 / 3 P1 / 2 P2）；top 5 核心组件为 `DisclosureRow`（10）/ `Button`（7）/ `StateDot`（6）/ `Pill`（5）/ `relativeTime`（4）。**新假设 9 / 10 暂成立**（待 v0.1 实施期验证）。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 [`packages/client/ui-primitives/src/index.ts`](../deepseek-harness/packages/client/ui-primitives/src/index.ts) 73 行全量 export 盘点，按状态 / 交互 / 容器 / 品牌 / 图标 / 内容 / Hooks / Utilities 八类别分组；与 [docs/scope/mvp-features.md](../scope/mvp-features.md) 40 个功能点 + [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) SUB.1-SUB.6 做"组件 × 场景"二维矩阵。落地 ✅ 直接复用 23 / 🛠 包装复用 7 / ✍️ 自写 8 / ❌ 不需要 23 项决策；top 5 核心组件清单；8 项复用风险；v0.1 第一周 5 步落地任务。新增 2 条 ADR 0009 假设（假设 9 / 10）待 v0.1 实施期验证。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH Sub-Agent 深度调研](research/0009-dsh-subagent-reference.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [核心画像 A 的 5 个场景剧本](../users/persona-a-scenarios.md)
- [CLAUDE.md](../CLAUDE.md)
- [`packages/client/ui-primitives/src/index.ts`](../deepseek-harness/packages/client/ui-primitives/src/index.ts)
