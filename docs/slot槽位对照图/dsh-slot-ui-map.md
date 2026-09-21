# deepseek-harness Slot ↔ UI 位置对照图

> 数据出处：
> - 注册表：`@deepseek-ai/dsh-cordis-client-runner` 的 `CLIENT_SLOT_API`
> - 渲染位：`renderSlot()` / `renderSlotChain()` 在 `client-ui-layout / client-ui-sidebar / client-ui-conversation / client-ui-chat / client-ui-tool / client-ui-sidebar-right / client-ui-settings-*` 中的调用位置

> 图例：
> - `[name]` = `single` 槽位
> - `[name]⋮` = `list` 槽位
> - `[name]🔑` = `keyed` 槽位
> - `[name]⛓` = `chain` 槽位
> - `(session)` / `(root)` = 作用域
> - `▸` = "被这里渲染"

---

## 0. 顶层骨架（`AppFrame`）

```
┌───────────────────────────────────────────────────────────────────────────┐
│ `root` (single, root) ▸ 由 ui-layout 的 AppFrame 占用                       │
│ ┌─────────────┬──────────────────────────────────────┬─────────────────┐   │
│ │             │                                      │                 │   │
│ │  左侧栏     │           中部主区                   │   右侧栏        │   │
│ │             │                                      │                 │   │
│ │ `sidebar`   │   `main` (keyed, root)              │ `rightbar`      │   │
│ │ (single,    │   ▸ entryKey = activePanelId         │ (single, root)  │   │
│ │  root) ▸    │     │                                │ ▸               │   │
│ │  ui-sidebar │     ├─ "conversation" →              │                 │   │
│ │             │     │   `main.conversation`          │                 │   │
│ │             │     │    (single, root)              │                 │   │
│ │             │     └─ (其它面板预留)                │                 │   │
│             │                                      │                 │   │
│ ┌───────────┴─────────────────────────────────────────┴───────────────┐ │
│ │ `shell.overlay` (list, root) ▸ 整页浮层（点击穿透到默认）            │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 1. 左侧栏：`sidebar` 内部

```
`sidebar` (single, root) ▸ ui-sidebar/SidebarRoot
┌────────────────────────────────┐
│ logoRow（顶部品牌）              │
│  ┌──────────────────────────┐  │
│  │ [sidebar.brand.mark]      │ ← 单槽 logo 图标（折叠时变 railMark）
│  │ [sidebar.brand.name]      │ ← 单槽 品牌名（折叠时为空）
│  └──────────────────────────┘  │
│ ┌────────────────────────────┐  │
│ │ ＋ 新会话按钮（不可插槽）     │  │
│ └────────────────────────────┘  │
│ panelList（导航面板列）           │
│  ┌──────────────────────────┐  │
│  │ [sidebar.panellist]⋮      │ ← 列表槽：每个面板一项（keyed by panel id）
│  │  ▸ conversation            │    渲染为图标按钮（折叠时仅图标，展开时图标+文字）
│  │  ▸ workflow                 │    包含 panelGlyph
│  │  ▸ …                       │  │
│  └──────────────────────────┘  │
│ regionArea                      │
│  ┌──────────────────────────┐  │
│  │ [sidebar.workspaces]      │ ← 工作区列表 + 当前路径
│  │  └─ [sidebar.workspaces   │    ↳ 目录选择流（Hero 视角复用同一目录流入口）
│  │      .directoryFlow]      │
│  └──────────────────────────┘  │
│ footArea（底部）                 │
│  ┌──────────────────────────┐  │
│  │ [sidebar.footer.action]⋮  │ ← 列表槽：底部操作按钮（更新、技能…）
│  │ [sidebar.settings]        │ ← 单槽：齿轮 / 设置入口（点击展开设置面板）
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

---

## 2. 主区：`main` → `main.conversation`（活动面板为 conversation 时）

```
`main` 🔑(root) ▸ AppFrame/MainPanel — 按 activePanelId 选择 entry
└─ key="conversation" → `main.conversation` (single, root)
   └─ ui-conversation/ConversationRoot（data-phase="hero" | "active" | "settling"）
```

### 2.1 顶部 Session Header（仅 sessionId 存在时）

```
[data-phase="active"] 时：
┌─────────────────────────────────────────────────────────────────┐
│ Header（`conversation.session.header` 被渲染的容器）              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ titleCluster（左）：                                         │ │
│  │  [conversation.session.header.lineage] (single)             │ │
│  │   └ 面包屑 / 父子会话链路                                    │ │
│  │                                                            │ │
│  │ headerActions（右）：                                         │ │
│  │  [conversation.session.header.actions]⋮ (list, id 寻址)      │ │
│  │   └ 收藏 / 分享 / 重命名 / …                                 │ │
│  │ headerUtilities（更右）：                                    │ │
│  │  [conversation.session.header.utilities]⋮ (list)            │ │
│  │   └ 导出 / 计划 / 主题切换 / …                                │ │
│  │ headerCorner（最右）：                                       │ │
│  │  [conversation.session.header.corner] (single)              │ │
│  │   └ 右侧栏开关 / 全屏切换                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 中部对话体

```
┌─────────────────────────────────────────────────────────────────┐
│ `conversation.session` (single, session) — 整条 session 主体     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ scrollBody                                                 │  │
│  │                                                            │  │
│  │ [conversation.view]⋮ (list) — 视图切换                    │  │
│  │  ┌────────────────────────────────────────────────────┐   │  │
│  │  │ 默认 "chat" 视图：                                  │   │  │
│  │  │                                                    │   │  │
│  │  │  对话节点区（按 turn 分组，每 turn 末尾接 chain）     │   │  │
│  │  │  ┌──────────────┐                                   │   │  │
│  │  │  │ User message  │                                   │   │  │
│  │  │  ├──────────────┤                                   │   │  │
│  │  │  │ [conversation.chat.node]🔑 (keyed)               │   │  │
│  │  │  │  ─ 由 chat 节点遍历，逐项 renderSlot             │   │  │
│  │  │  │                                                 │   │  │
│  │  │  │   ┌───────────────────────────────────────┐    │   │  │
│  │  │  │   │ 助手消息内（图像型 Tool）：              │    │   │  │
│  │  │  │   │  [conversation.message.images]         │    │   │  │
│  │  │  │   ├───────────────────────────────────────┤    │   │  │
│  │  │  │   │ Tool 调用卡片：                         │    │   │  │
│  │  │  │   │  [tool.call.toolview]🔑 (keyed by 工具)│    │   │  │
│  │  │  │   │   ├─ [tool.call.images] (single)       │    │   │  │
│  │  │  │   │   └─ 自定义 toolview 子组件              │    │   │  │
│  │  │  │   ├───────────────────────────────────────┤    │   │  │
│  │  │  │   │ 审批条（如有）：                          │    │   │  │
│  │  │  │   │  [conversation.approval.detail]        │    │   │  │
│  │  │   │   ├───────────────────────────────────────┤    │   │  │
│  │  │  │   │ 助手消息下方操作行：                      │    │   │  │
│  │  │  │   │  [conversation.chat.assistant-actions]⋮ │   │   │  │
│  │  │  │   │   └ 复制 / 反馈 / 重生 …               │    │   │  │
│  │  │  │   └───────────────────────────────────────┘    │   │  │
│  │  │  └────────────────────────────────────────────┘   │   │  │
│  │  │                                                        │   │  │
│  │  │  每 turn 末尾（一次 chain 接力）：                     │   │  │
│  │  │  [conversation.chat.turnTail]⛓ (chain)              │   │  │
│  │  │   ├─ [conversation.chat.commandview]🔑 (keyed)        │   │  │
│  │  │   │    └ 由 CommandView 调度的命令视图              │   │  │
│  │  │   └─ …其它 chain 接续项                              │   │  │
│  │  │                                                        │   │  │
│  │  │ 备选 "trajectory" 视图（替换 scrollBody 内容）：        │   │  │
│  │  │  [conversation.trajectory.images] (single)            │   │  │
│  │  │   └ 轨迹节点 + 图片画廊                              │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 底部输入复合区（`conversation.composer` chain）

```
┌─────────────────────────────────────────────────────────────────┐
│ composerSeat                                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ `conversation.composer` ⛓(chain)                         │ │
│  │  ├─ (链上各 entry：依次 renderSlotChain)                    │ │
│  │  │   ├─ [conversation.composer.dock]⋮ (list) — 顶部 dock │ │
│  │  │   ├─ [conversation.input.overlay]⋮ (list) — 覆盖层    │ │
│  │  │   │   └─ 命令面板 / 提示 / 输入触发…                  │ │
│  │  │   └─ fallback → `conversation.composer.bar`           │ │
│  │  │                                                        │ │
│  │  │ `conversation.composer.bar` (single)                  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │  │ inputBox                                        │ │ │
│  │  │  │  [conversation.input.left]⋮    （左装饰按钮组）  │ │ │
│  │  │  │  [conversation.input.plan]      （Plan 按钮）    │ │ │
│  │  │  │  [conversation.input.attachments]（附件触发）    │ │ │
│  │  │  │   ─── textbox ───                            ─── │ │ │
│  │  │  │  [conversation.input.right]⋮   （右装饰按钮组）  │ │ │
│  │  │  │  [conversation.input.model]     （模型选择）    │ │ │
│  │  │  └─────────────────────────────────────────────────┘ │ │
│  │  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

> 注：当 `data-phase="hero"`（无 session）时，bar 上方还会渲染 Hero 区，见 §2.4。

### 2.4 Hero 区（`data-phase="hero"`，首屏无 session 时）

```
HeroShell（居中品牌区）
┌──────────────────────────────────────────────┐
│  [conversation.hero.brand.mark]  ◀─── 鱼形 LOGO（中央）  │
│  ────────── "DeepSeek Harness" + Preview 标签 ───
│
│  heroWorkspaceRow（工作区选择行）
│  ┌────────────────────────────────────────┐  │
│  │ WorkspaceChip  │  [conversation.hero   │  │
│  │  （不可插槽）   │   .workspace]        │  │
│  │                │  └─ 选 workspace 下拉  │  │
│  └────────────────────────────────────────┘  │
│       └─ [conversation.hero.workspace       │
│            .directoryFlow] ◀── 目录选择流     │
│
│  composerStack（同上，但 disabled、占位 "选择一个目录…"）
│   [conversation.hero.agentPreset] ◀── Agent 预设展示卡
└──────────────────────────────────────────────┘
```

---

## 3. 右侧栏：`rightbar` 内部

```
`rightbar` (single, root) ▸ AppFrame 右栏
└─ 整页 SessionProvider 包装 → `rightbar.session` (single, session)
   ┌────────────────────────────────────────────┐
   │  Tab 栏（横向 tabs）                        │
   │  ┌──────────────────────────────────────┐  │
   │  │ [sidebar.right.pane.tab]🔑 (keyed)   │  │
   │  │  └─ entry.key = tab id               │  │
   │  │     ├─ title: [sidebar.right.pane    │  │
   │  │     │      .tab.title]🔑 (keyed)     │  │
   │  │     └─ body:  [sidebar.right.tab     │  │
   │  │             .document]🔑 文档预览    │  │
   │  │             └─ 文档子组件            │  │
   │  │             ────── 或 ──────          │  │
   │  │             [sidebar.right.tab       │  │
   │  │              .guide]⛓ (chain)        │  │
   │  │             ├─ 引导 / FAQ 入口        │  │
   │  │             └─ 后续 chain 接力       │  │
   │  │                                       │  │
   │  │  Tab 三点菜单（按下时弹出）：           │  │
   │  │  [sidebar.right.tab.menu.item]⋮       │  │
   │  │   └─ 重命名 / 关闭 / 固定…           │  │
   │  └──────────────────────────────────────┘  │
   └────────────────────────────────────────────┘
```

---

## 4. 设置面板（覆盖层，由 `sidebar.settings` 触发）

```
settings overlay（独立覆盖整页）
┌─────────────────────────────────────────────────────────┐
│  [settings.trigger] ◀── 触发位（实际挂在 sidebar 底部）  │
│                                                         │
│  模态对话框（settings trigger 打开时挂载）                │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 顶部 header                                         │ │
│  │  [settings.header]  (single)                        │ │
│  │   ├─ logo / 标题                                     │ │
│  │  [settings.action]⋮ (list, id)                      │ │
│  │   └─ "导入设置" / "重置" / …                         │ │
│  │  [settings.close] (single)                            │ │
│  │   └─ 关闭按钮                                         │ │
│  ├───────────────────────────────────────────────────┤ │
│  │ 侧栏分页                                             │ │
│  │  [settings.section]⋮ (list, only=active)              │ │
│  │   ├─ 通用     → active="general"                     │ │
│  │   │   └─ [settings.general.item]⋮ (list)             │ │
│  │   │       ├─ 语言                                     │ │
│  │   │       ├─ 主题                                     │ │
│  │   │       └─ 快捷键                                   │ │
│  │   ├─ 模型                                              │ │
│  │   │   ├─ [settings.models.provider-card]🔑 (keyed)   │ │
│  │   │   │   └─ DeepSeek / OpenAI / Anthropic …          │ │
│  │   │   └─ [settings.models.footer]⋮ (list)            │ │
│  │   ├─ 插件                                              │ │
│  │   │   ├─ [settings.plugins.tab]⋮ (list, only)         │ │
│  │   │   │   ├─ "已安装"                                  │ │
│  │   │   │   └─ "市场"                                    │ │
│  │   │   └─ [settings.plugin.item]🔑 (keyed by ns)      │ │
│  │   │       └─ 单个插件卡片                              │ │
│  │   └─ (扩展位)                                          │ │
│  ├───────────────────────────────────────────────────┤ │
│  │ 首次启动引导                                           │ │
│  │  [settings.onboarding]⋮ (list)                       │ │
│  │   └─ 步骤条卡片                                        │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 5. `shell.overlay`（整页浮层）

```
[shell.overlay]⋮ (list, root)
└─ 全屏覆盖层（默认 click-through，entry 可声明 pointer-events）
   ├─ 全局搜索框
   ├─ 全局快捷面板
   ├─ …（任意插件挂载的全屏覆盖 UI）
```

---

## 6. 完整 Slot 索引（按位置分类）

### 6.1 顶层 / Shell
| Slot | Kind | Scope | 渲染位 | 位置用途 |
|---|---|---|---|---|
| `root` | single | root | AppFrame 根 | 整页根槽位（AppFrame 占用） |
| `shell.overlay` | list | root | `data-shell-overlay` 层 | 整页浮层 |
| `main` | keyed | root | 中部主列 | 按 `entryKey=panelId` 切换面板 |
| `main.conversation` | single | root | `main` key=conversation 时 | Conversation 面板入口 |
| `rightbar` | single | root | 右栏 | 右侧栏容器 |
| `rightbar.session` | single | session | SessionProvider 内 | 会话绑定的右侧栏 |

### 6.2 左侧栏（sidebar 树内）
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `sidebar` | single | root | 左栏根 |
| `sidebar.brand.mark` | single | root | LogoRow 左图标 |
| `sidebar.brand.name` | single | root | LogoRow 名称 |
| `sidebar.panellist` | list | root | panelList（每个 panel 一个） |
| `sidebar.workspaces` | single | root | regionArea 工作区 |
| `sidebar.workspaces.directoryFlow` | single | root | sidebar 工作区下的目录选择流 |
| `sidebar.footer.action` | list | root | 底部 footArea 按钮组 |
| `sidebar.settings` | single | root | footArea 设置入口 |

### 6.3 右侧栏（rightbar 树内）
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `sidebar.right.pane.tab` | keyed | session | 右侧 Tab（横向 tab 栏） |
| `sidebar.right.pane.tab.title` | keyed | session | Tab 标题 |
| `sidebar.right.tab.document` | keyed | session | Tab 文档预览体 |
| `sidebar.right.tab.guide` | chain | session | Tab 引导（chain） |
| `sidebar.right.tab.menu.item` | list | session | Tab 菜单项 |

### 6.4 Conversation 主面板
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `conversation.session.header` | single | session | Header 区总容器 |
| `conversation.session.header.lineage` | single | session | Header 左侧面包屑 |
| `conversation.session.header.actions` | list | session | Header 右侧主操作 |
| `conversation.session.header.utilities` | list | session | Header 工具区 |
| `conversation.session.header.corner` | single | session | Header 最右角 |
| `conversation.session` | single | session | 整个对话主体容器 |
| `conversation.view` | list | session | scrollBody 内视图切换 |
| `conversation.chat.node` | keyed | session | 对话节点（keyed by 节点 id） |
| `conversation.chat.assistant-actions` | list | session | 助手消息操作行 |
| `conversation.chat.commandview` | keyed | session | turnTail 命令视图 |
| `conversation.chat.turnTail` | chain | session | turn 末尾链式接力 |
| `conversation.message.images` | single | session | 消息内图片画廊 |
| `conversation.trajectory.images` | single | session | 轨迹视图图片画廊 |
| `conversation.approval.detail` | single | session | approval 节点详情 |
| `conversation.composer` | chain | session | 整个输入复合区 |
| `conversation.composer.bar` | single | session | 输入条（fallback） |
| `conversation.composer.dock` | list | session | 输入条顶部 dock |
| `conversation.input.attachments` | single | session | 输入条附件按钮 |
| `conversation.input.dock` | list | session | hero 时的输入条顶部 dock |
| `conversation.input.left` | list | session | 输入条左侧按钮组 |
| `conversation.input.model` | single | session | 输入条模型选择 |
| `conversation.input.overlay` | list | session | 输入条覆盖层 |
| `conversation.input.plan` | single | session | Plan 按钮 |
| `conversation.input.right` | list | session | 输入条右侧按钮组 |

### 6.5 Hero（无 session 首屏）
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `conversation.hero.brand.mark` | single | root | HeroShell 中心 logo |
| `conversation.hero.workspace` | single | root | 工作区选择按钮（chip） |
| `conversation.hero.workspace.directoryFlow` | single | root | Hero 工作区目录选择流 |
| `conversation.hero.agentPreset` | single | root | Hero 底部 Agent 预设卡 |

### 6.6 Tool Call
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `tool.call.images` | single | session | toolview 内图片画廊 |
| `tool.call.toolview` | keyed | session | 整张 tool 调用卡片（keyed by 工具名） |
| `tool.view.cordis` | keyed | session | Cordis 工具专用视图 |

### 6.7 Settings（覆盖层面板）
| Slot | Kind | Scope | 渲染位 |
|---|---|---|---|
| `settings.trigger` | single | root | sidebar 底部齿轮按钮 |
| `settings.header` | single | root | 设置弹窗顶部 |
| `settings.close` | single | root | 设置弹窗关闭 |
| `settings.action` | list | root | 设置弹窗操作按钮 |
| `settings.section` | list | root | 设置分页列表 |
| `settings.general.item` | list | root | 通用页分项 |
| `settings.onboarding` | list | root | 引导步骤卡 |
| `settings.models.provider-card` | keyed | root | 模型供应商卡（keyed by provider） |
| `settings.models.footer` | list | root | 模型页底部 |
| `settings.plugins.tab` | list | root | 插件页签 |
| `settings.plugin.item` | keyed | root | 插件条目（keyed by namespace） |

---

## 7. 总览对照矩阵（Page Region × Slot）

```
┌────────────┬────────────────────────────────────────────────────────────────────┐
│ 页面区域    │ Slot 列表                                                        │
├────────────┼────────────────────────────────────────────────────────────────────┤
│ 整页根     │ root                                                              │
│ 整页浮层   │ shell.overlay                                                     │
│ 顶部品牌   │ sidebar.brand.mark, sidebar.brand.name                            │
│ 左侧导航   │ sidebar.panellist, sidebar.workspaces,                            │
│            │ sidebar.workspaces.directoryFlow,                                │
│            │ sidebar.footer.action, sidebar.settings                          │
│ 顶栏左     │ conversation.session.header.lineage                              │
│ 顶栏右     │ conversation.session.header.actions,                             │
│            │ conversation.session.header.utilities,                            │
│            │ conversation.session.header.corner                                │
│ 对话主区   │ conversation.session, conversation.view,                         │
│            │ conversation.chat.node, conversation.chat.assistant-actions,     │
│            │ conversation.chat.commandview, conversation.chat.turnTail,       │
│            │ conversation.message.images,                                     │
│            │ conversation.trajectory.images,                                  │
│            │ conversation.approval.detail,                                    │
│            │ tool.call.images, tool.call.toolview, tool.view.cordis           │
│ 输入复合区 │ conversation.composer (chain),                                   │
│            │   ├─ conversation.composer.dock                                 │
│            │   ├─ conversation.input.overlay                                  │
│            │   └─ conversation.composer.bar →                                │
│            │      conversation.input.left, conversation.input.plan,           │
│            │      conversation.input.attachments,                             │
│            │      conversation.input.right, conversation.input.model,        │
│            │      conversation.input.dock                                     │
│ Hero 首屏  │ conversation.hero.brand.mark,                                    │
│            │ conversation.hero.workspace,                                     │
│            │ conversation.hero.workspace.directoryFlow,                       │
│            │ conversation.hero.agentPreset                                    │
│ 右栏       │ rightbar, rightbar.session,                                      │
│            │ sidebar.right.pane.tab, sidebar.right.pane.tab.title,           │
│            │ sidebar.right.tab.document, sidebar.right.tab.guide,            │
│            │ sidebar.right.tab.menu.item                                      │
│ 设置弹窗   │ settings.trigger, settings.header, settings.close,               │
│            │ settings.action, settings.section,                               │
│            │ settings.general.item, settings.onboarding,                     │
│            │ settings.models.provider-card, settings.models.footer,          │
│            │ settings.plugins.tab, settings.plugin.item                       │
└────────────┴────────────────────────────────────────────────────────────────────┘
```

---

## 8. 一图速记（ASCII 缩略图）

```
DSH Web Page
│
├─── root (single, root)
│
│   ┌────────── sidebar ──────────┐  ┌──── main ─────────────┐  ┌── rightbar ──┐
│   │ • brand.mark / .name        │  │ key=conversation       │  │               │
│   │ • panellist⋮                │  │  ▼                     │  │ rightbar.session
│   │ • workspaces                 │  │  main.conversation      │  │  ▼            │
│   │   └─ .directoryFlow          │  │   ▼                    │  │  sidebar.right.pane.tab🔑
│   │ • footer.action⋮            │  │   conv.session.header   │  │   ├ title🔑   │
│   │ • settings ─── 触发设置弹窗 ─┼──┼─→ (独立 overlay)        │  │   ├ document🔑│
│   └─────────────────────────────┘  │   │ .lineage            │  │   ├ guide⛓    │
│                                    │   │ .actions⋮           │  │   └ menu.item⋮│
│                                    │   │ .utilities⋮         │  └───────────────┘
│                                    │   │ .corner             │
│                                    │   ▼                     │
│                                    │   conv.session           │
│                                    │   └ conv.view⋮           │
│                                    │      └ chat node🔑       │
│                                    │         ├ message.images │
│                                    │         ├ tool.call.images│
│                                    │         ├ tool.call.toolview🔑│
│                                    │         ├ approval.detail│
│                                    │         └ .assistant-actions⋮
│                                    │      └ turnTail⛓         │
│                                    │         └ chat.commandview🔑
│                                    │   conv.composer⛓         │
│                                    │    ├ composer.dock⋮       │
│                                    │    ├ input.overlay⋮       │
│                                    │    └ composer.bar          │
│                                    │       ├ input.left⋮       │
│                                    │       ├ input.plan         │
│                                    │       ├ input.attachments  │
│                                    │       ├ input.right⋮       │
│                                    │       ├ input.model        │
│                                    │       └ input.dock⋮        │
│                                    └───────────────────────────┘
│
│   ┌── shell.overlay⋮ ──┐  (整页浮层，点击穿透，可声明 pointer-events)
│   └────────────────────┘
│
│   ┌── Settings 弹窗（由 sidebar.settings 触发） ──┐
│   │ settings.header / .close / .action⋮ / .section⋮ │
│   │   ├ .general.item⋮                              │
│   │   ├ .models.provider-card🔑 + .models.footer⋮   │
│   │   └ .plugins.tab⋮ + .plugin.item🔑               │
│   │ settings.onboarding⋮                            │
│   └──────────────────────────────────────────────────┘
│
│   ┌── Hero（无 session 时显示） ──────────────────────┐
│   │ hero.brand.mark / hero.workspace                 │
│   │   └ .directoryFlow                                │
│   │ hero.agentPreset                                  │
│   └───────────────────────────────────────────────────┘
```
