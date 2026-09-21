# DeepSeek Harness — Web UI 页面 ↔ Slot 槽位 标注图

> 调研对象：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) `@master`
> Slot 注册表实现：`packages/client/ui-slots/src/index.ts` (`SlotCore`)
> 渲染机制：`renderSlot('slot.name', ownerProps, opts?)` / `renderSlotChain('slot.name', ownerProps, opts?)`

图例：
- 蓝色块 = 静态布局（shell 自带 DOM / 容器）
- 黄色块 = `single` 槽（最多 1 个 occupant）
- 绿色块 = `list` 槽（多个 occupant 顺序叠加）
- 紫色块 = `keyed` 槽（按 key 派发，每个 key 一个 occupant）
- 红色块 = `chain` 槽（按 selector 路由，首个非 null 命中者当选）
- 标签格式：`slot.name` — `kind/scope` — 注册者包

---

## 总览：整个 Web 应用 = 1 个 `root` slot

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  root  (single/root)  ← packages/client/ui-renderer                       │
│  → occupants: AppFrame  (packages/client/ui-layout/src/client/AppFrame.tsx) │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 图 1：AppFrame 三栏布局（root → sidebar | main | rightbar + shell.overlay）

文件：`packages/client/ui-layout/src/client/AppFrame.tsx`

```
╔═══════════════════════════════════════════════════════════════════════════════════╗
║ shell.overlay  (list/root) ───────────────────────  浮在所有列之上、默认透传点击  ║
║   ↳ AppFrame.tsx:203                                                                ║
╠═════════════╦═════════════════════════════════════╦═══════════════════════════════╣
║             ║                                     ║                               ║
║   sidebar   ║   main  (keyed/root)                 ║   rightbar  (single/root)     ║
║  (single)   ║   ↳ AppFrame.tsx:42                  ║   ↳ AppFrame.tsx:232          ║
║             ║                                     ║                               ║
║ ┌─────────┐ ║ entryKey='conversation'              ║ ┌───────────────────────────┐ ║
║ │ 左导航列 │ ║   → ConversationPanel                ║ │ 右栏（仅 conversation      │ ║
║ │          │ ║                                     ║ │   activePanelId === null   │ ║
║ │ 详见图 2 │ ║   entryKey='plugins'                 ║ │   时才显示，见图 6）        │ ║
║ │          │ ║   → PluginManagerPage               ║ │                           │ ║
║ │          │ ║     详见图 8                        ║ │                           │ ║
║ └─────────┘ ║                                     ║ └───────────────────────────┘ ║
║             ║                                     ║                               ║
╠═════════════╩═════════════════════════════════════╩═══════════════════════════════╣
║ shell.overlay 浮层：终端清理失败提示等（id=terminal-cleanup → ui-sidebar-terminal）  ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
```

---

## 图 2：SidebarRoot 左导航列（`sidebar` slot 内部）

文件：`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`

```
╔══════════════════════════════════════════════════╗
║ sidebar  (single/root) ← ui-layout              ║
║ → SidebarRoot (ui-sidebar)                       ║
╠══════════════════════════════════════════════════╣
║ ┌──────────────────────────────────────────────┐ ║
║ │ 顶部品牌行                                    │ ║
║ │                                              │ ║
║ │  ▣ sidebar.brand.mark  (single/root)          │ ║  ← SidebarRoot.tsx:181/220
║ │      → ui-brand-official                     │ ║     (展开态 24px + 折叠态 24px)
║ │  ▤ sidebar.brand.name  (single/root)         │ ║  ← SidebarRoot.tsx:223
║ │      → ui-brand-official                     │ ║     (仅展开态)
║ └──────────────────────────────────────────────┘ ║
║                                                  ║
║ ┌──────────────────────────────────────────────┐ ║
║ │ ▣ sidebar.toggle.badge (single/root)         │ ║  ← SidebarRoot.tsx:186
║ │      → DesktopUpdateBadge (ui-settings-general) ║   折叠按钮内的连接/更新状态徽标
║ └──────────────────────────────────────────────┘ ║
║                                                  ║
║ ┌──────────────────────────────────────────────┐ ║
║ │ 全局面板图标行（垂直排列）                      │ ║
║ │                                              │ ║
║ │  ▤ sidebar.panellist (list/root)             │ ║  ← SidebarRoot.tsx:71
║ │      ↳ id='plugins'                          │ ║     (按 only={id} 过滤渲染)
║ │        → PluginsPanelIcon                    │ ║
║ │          (ui-plugin-manager)                  │ ║
║ └──────────────────────────────────────────────┘ ║
║                                                  ║
║ ┌──────────────────────────────────────────────┐ ║
║ │ sidebar.workspaces (single/root)             │ ║  ← SidebarRoot.tsx:272
║ │   → WorkspaceBrowser (ui-workspace)          │ ║     工作区/会话列表 + 对话框
║ │                                              │ ║     内含目录选择入口：
║ │      ▣ sidebar.workspaces.directoryFlow      │ ║  ← ui-workspace
║ │          (single/root)                       │ ║     (browse / native)
║ └──────────────────────────────────────────────┘ ║
║                                                  ║
║                                                  ║
║ ┌──────────────────────────────────────────────┐ ║
║ │ 底部固定行                                     │ ║
║ │                                              │ ║
║ │  ▤ sidebar.footer.action (list/root)         │ ║  ← SidebarRoot.tsx:281
║ │      ↳ id='cordis'                           │ ║
║ │        → CordisPanel (ui-cordis)              │ ║     打开动态插件面板
║ │                                              │ ║
║ │  ▣ sidebar.settings (single/root)             │ ║  ← SidebarRoot.tsx:284
║ │      → SettingsTrigger                       │ ║     详见图 7
║ │        (ui-settings-general)                  │ ║
║ └──────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════╝
```

---

## 图 3：Main 中央面板 — Conversation 模式（`main` slot, entryKey='conversation'）

文件：`packages/client/ui-conversation/src/client/skeleton/`

```
╔══════════════════════════════════════════════════════════════════╗
║ main (keyed/root)  ← ui-layout                                 ║
║   entryKey='conversation' → ConversationPanel                  ║
║     → renderSlot('main.conversation') → ConversationMainPanel  ║
╠══════════════════════════════════════════════════════════════════╣
║  main.conversation (single/session-maybe) ← ui-conversation   ║
║    → ConversationMainPanel.tsx                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ┌────────────────────────────────────────────────────────────┐ ║
║  │ conversation.session.header (single/session)                │ ║  ← ConvMain:45
║  │   → SessionHeader (ui-conversation)                         │ ║     (详见图 4)
║  └────────────────────────────────────────────────────────────┘ ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐ ║
║  │  renderFactorySlot('conversation.content', …)              │ ║  ← ConvMain:46
║  │  factory 内部渲染：                                          │ ║     (详见图 5)
║  │    ↳ ConversationContent (ui-conversation)                  │ ║
║  └────────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 图 4：SessionHeader（`conversation.session.header` 内部）

文件：`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`

```
╔════════════════════════════════════════════════════════════════════════════╗
║ conversation.session.header  (single/session) ← ui-conversation           ║
║   → SessionHeader                                                          ║
╠════════════════════════════════════════════════════════════════════════════╣
║ ┌────────────────────────────────────────────────────────────────────────┐ ║
║ │ leading │                title cluster              │ utilities │ cor ║ ║
║ │ 槽位   │                                              │ 槽位     │ 槽 ║ ║
║ │       │                                              │         │ 位 ║ ║
║ │◀──────▶│◀──────────────────────────────────────────▶│◀───────▶│◀──▶║ ║
║ │       │                                              │         │    ║ ║
║ │▣ leading (single/session)                             │▤ util.  │▣ c ║ ║
║ │  ui-sidebar/HeaderLeadingControls                     │ ui-open-│ si ║ ║
║ │  (macOS 折叠后显示：边栏展开+新建会话)                  │  in-app │ de ║ ║
║ │  ← Session.tsx:74                                    │ ←:133  │ ba ║ ║
║ │                                                      │        │ r- ║ ║
║ │         ┌─────────────────────────────────────────┐  │        │ ri ║ ║
║ │         │ 面包屑导航 (ancestry)                   │  │        │ gh ║ ║
║ │         │  ▣ lineage (single/session)             │  │        │ t/ ║ ║
║ │         │     → ui-subagent/SubagentHeaderLineage │  │        │ Ex ║ ║
║ │         │     ← Session.tsx:107,115               │  │        │ pa ║ ║
║ │         │     (最后一个 crumb 渲染；fallback=默认  │  │        │ nd ║ ║
║ │         │      按钮；非 subagent crumb 渲染 null)  │  │        │ Bu ║ ║
║ │         └─────────────────────────────────────────┘  │        │ tt ║ ║
║ │                                                      │        │ on ║ ║
║ │         ┌─────────────────────────────────────────┐  │        │    ║ ║
║ │         │ ▤ header.actions (list/session)          │  │        │←:1 ║ ║
║ │         │     ↳ id='schedule-catalog'             │  │        │ 38 ║ ║
║ │         │       → ui-schedule/ScheduleCatalogAction│  │        │    ║ ║
║ │         │     ↳ id='job-list'                     │  │        │    ║ ║
║ │         │       → ui-jobs/JobListAction            │  │        │    ║ ║
║ │         │     ← Session.tsx:129                    │  │        │    ║ ║
║ │         └─────────────────────────────────────────┘  │        │    ║ ║
║ └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║   ┌────────────────────────────────────────────────────────────────────┐   ║
║   │  View Tabs（按 session.view 渲染；空时不显示）                        │   ║
║   │    conversation.view (list/session) ← ui-chat (id='chat')           │   ║
║   │                                    ← ui-trajectory (id='trajectory') │   ║
║   │    (切换 Tab 不换 slot；Chat 与 Trajectory 在同一个 list 槽里)       │   ║
║   └────────────────────────────────────────────────────────────────────┘   ║
╚════════════════════════════════════════════════════════════════════════════╝
```

---

## 图 5：ConversationContent（factory `conversation.content` 渲染产物）

文件：`packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx`

> 此处分两种 phase：
> - **hero phase**（新会话/空白会话）：品牌 + 工作区选择 + agent-preset 全屏居中
> - **active phase**（已有会话）：会话视图 + composer（input.dock + input.bar）

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ factory: 'conversation.content'  ← ui-conversation                          ║
║   scope: session-maybe                                                       ║
║   渲染于 ConversationMainPanel（详见图 3）                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  scrollBody（数据相位：hero ↔ active）                                        ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │                                                                        │ ║
║  │  ▣ conversation.session  (single/session) ← ui-conversation           │ ║  ← Content.tsx:9
║  │      → ConversationSession (内含 header 见图 4)                        │ ║     (Views slot:
║  │        默认 Views = ConversationSessionView                            │ ║      ui-conversation 提供)
║  │      内部：conversation.view (list/session)                             │ ║
║  │        ↳ id='chat'       → ui-chat/ChatView (含图 9)                   │ ║
║  │        ↳ id='trajectory' → ui-trajectory/TrajectoryView (含图 10)       │ ║
║  │                                                                        │ ║
║  │  ──── hero phase 时此处为空 ────                                         │ ║
║  │                                                                        │ ║
║  │                                                                        │ ║
║  └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │  composerSeat（粘性底栏；hero 时居中、active 时贴底）                    │ ║
║  │                                                                        │ ║
║  │  ▣ conversation.hero.brand.mark  (single/root)                         │ ║  ← EmptyHero.tsx:148
║  │      → ui-brand-official（仅 hero phase，34px）                          │ ║
║  │                                                                        │ ║
║  │  hero phase：                                                          │ ║
║  │    ┌────────────────────────────────────────────────────────────────┐  │ ║
║  │    │  ▣ conversation.hero.workspace  (single/root)                  │  │ ║  ← Content.tsx:113
║  │    │      → WorkspacePicker (ui-workspace)                          │  │ ║
║  │    │      内部子槽：                                                │  │ ║
║  │    │      ▣ conversation.hero.workspace.directoryFlow (single/root)  │  │ ║  ← ui-workspace
║  │    │         → ui-directory-picker-browse 或 ui-directory-picker-   │  │ ║     (browse/native 二选一)
║  │    │            native                                             │  │ ║
║  │    │                                                                │  │ ║
║  │    │  ▣ conversation.hero.agentPreset (single/session-maybe)         │  │ ║  ← Content.tsx:126
║  │    │      → AgentPresetControl (ui-agent-preset)                    │  │ ║
║  │    └────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                        │ ║
║  │  ▤ conversation.input.dock (list/session)                              │ ║  ← Content.tsx:161
║  │      ↳ id='todo'    → TodoPanel (ui-conversation)                      │ ║
║  │      ↳ id='queue'   → QueueDock (ui-conversation)                      │ ║
║  │      (active phase 显示在 composer 上方)                                │ ║
║  │                                                                        │ ║
║  │  ╔══════════════════════════════════════════════════════════════════╗ │ ║
║  │  ║ renderSlotChain('conversation.composer', chain) ← ui-conversation║ │ ║  ← Content.tsx:166
║  │  ║   chain 路由优先级：                                                ║ │ ║     (overlay=true)
║  │  ║     ┌─ ui-approval/ApprovalComposer      (priority=0, default)  ║ │ ║
║  │  ║     ├─ ui-user-questions/QuestionComposer (priority=0, default)  ║ │ ║
║  │  ║     └─ ui-subagent/SubagentReadOnlyComposer (priority=-10)      ║ │ ║     (subagent 只读时抢断)
║  │  ║                                                                  ║ │ ║
║  │  ║  fallback (全部 decline 时显示)：                                  ║ │ ║
║  │  ║   ▣ conversation.composer.bar (single/session-maybe)              ║ │ ║  ← Content.tsx:140
║  │  ║     → InputBar (ui-conversation)                                  ║ │ ║     内含子槽见 图 5.1
║  │  ╚══════════════════════════════════════════════════════════════════╝ │ ║
║  └────────────────────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 图 5.1：InputBar 内部子槽（`conversation.composer.bar` occupant）

文件：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ InputBar — conversation.composer.bar  (single/session-maybe)               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │  ▤ conversation.input.overlay  (list/session)                          │ ║  ← InputBar.tsx:373
║  │      ↳ ui-message-feedback/MessageFeedbackOverlay                      │ ║     浮在 textarea 上方
║  └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │  ▣ conversation.input.attachments  (single/session-maybe)              │ ║  ← InputBar.tsx:376
║  │      → AttachmentRail (ui-attachment)                                  │ ║     草稿附件轨道 + 拖放
║  └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌─────────────────── textarea ────────────────────┐                       ║
║  │                                                 │                       ║
║  └─────────────────────────────────────────────────┘                       ║
║                                                                            ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │ tool row（垂直居中一行）                                                │ ║
║  │                                                                        │ ║
║  │  ◀─left─────────────▶◀──── center ────▶◀─────── right ──────────────▶  │ ║
║  │                                                                        │ ║
║  │  ▤ conversation.input.left   (list/session)                             │ ║  ← InputBar.tsx:438
║  │      ↳ 附件按钮、上下文计数等（内置）                                    │ ║
║  │                                                                        │ ║
║  │                ▣ conversation.input.plan       (single/session)         │ ║  ← InputBar.tsx:434
║  │                    → PlanControl (ui-plan)                              │ ║
║  │                                                                        │ ║
║  │                ▣ conversation.input.permission (single/session)         │ ║  ← InputBar.tsx:433
║  │                    → PermissionControl (ui-permission-presets)          │ ║
║  │                                                                        │ ║
║  │                ▣ conversation.input.model      (single/session)         │ ║  ← InputBar.tsx:444
║  │                    → ModelSelector (ui-model-selection)                 │ ║
║  │                                                                        │ ║
║  │                ▤ conversation.input.right  (list/session)               │ ║  ← InputBar.tsx:443
║  │                    ↳ 发送按钮等（内置）                                 │ ║
║  └────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌────────────────────────────────────────────────────────────────────────┐ ║
║  │  ▤ conversation.composer.dock (list/session)                            │ ║  ← InputBar.tsx:486
║  │      (composer 下方的 ambient 条；外部插件可在此追加内容)                  │ ║
║  └────────────────────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 图 6：RightbarRoot → RightbarSeat 右栏（仅 conversation 模式显示）

文件：`packages/client/ui-sidebar-right/src/client/`

```
╔══════════════════════════════════════════════════════════════════════════════╗
║ rightbar  (single/root) ← ui-layout                                          ║
║   → RightbarRoot（仅 activePanelId === null 即 conversation 模式显示）       ║
║     RightbarRoot.tsx:17                                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ ┌──────────────────────────────────────────────────────────────────────────┐ ║
║ │ SessionProvider（包入当前 session scope）                                   │ ║
║ │                                                                          │ ║
║ │  ▣ rightbar.session (single/session) ← ui-sidebar-right                 │ ║  ← RightbarRoot.tsx:17
║ │     → RightbarSeat                                                       │ ║     内含子槽：
║ └──────────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║   ┌────────────────────────────────────────────────────────────────────┐   ║
║   │  Tab 内容区（每个 tab 按 definition.id / tab.kind 路由）              │   ║
║   │                                                                    │   ║
║   │  ▣ sidebar.right.pane.tab  (keyed/session) ← ui-sidebar-right     │   ║  ← SidebarRight.tsx:197
║   │      key='guide'             → ui-sidebar-right/GuideBody (图 6.1)  │   ║     (按 entryKey 派发)
║   │      key='text-preview'      → ui-sidebar-documentpreview           │   ║
║   │      key='files'             → ui-sidebar-files                     │   ║
║   │      key='terminal'          → ui-sidebar-terminal                  │   ║
║   │      key='browser'           → ui-sidebar-browser                   │   ║
║   │      key='subagentchat'      → ui-subagent/SubagentChat             │   ║     内部声明 sidebar.chat.conversation
║   │      key='changes-review'    → ui-deliverables                      │   ║
║   │      key='plan-preview'      → ui-plan                              │   ║
║   │                                                                     │   ║
║   │  ▣ sidebar.right.pane.tab.title  (keyed/session) ← 同上各包           │   ║  ← SidebarRight.tsx:197
║   │      (每个 tab 标题，与 .tab 一一对应、key 集合相同)                   │   ║     标签上显示的 chip 文字
║   │                                                                     │   ║
║   │  ▤ sidebar.right.tab.menu.item  (list/session)                       │   ║  ← SidebarRight.tsx:322
║   │      ↳ kit 自带 layout 动作；外部追加                                    │   ║     tab 的菜单尾部项
║   └────────────────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 图 6.1：GuideBody（`sidebar.right.tab.guide`）

文件：`packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx`

```
╔════════════════════════════════════════════════════════════╗
║ GuideBody（key='guide' tab 内容）                          ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  renderSlotChain('sidebar.right.tab.guide', {})             ║  ← GuideBody.tsx:102
║   chain 路由：selector(owner) 首个非 null 命中者             ║     (默认 = 自带 guide)
║                                                            ║
║  fallback（全部 decline 时显示）：                          ║
║   ┌────────────────────────────────────────────────────┐   ║
║   │  ▣ sidebar.right.tab.guide.entry (keyed/session)    │   ║  ← GuideBody.tsx:90
║   │      key='terminal' → ui-sidebar-terminal           │   ║
║   │      (默认注册的引导条目；可被其他插件扩展)            │   ║
║   └────────────────────────────────────────────────────┘   ║
╚════════════════════════════════════════════════════════════╝
```

### 图 6.2：Document Preview（`key='text-preview'` 内层）

文件：`packages/client/ui-sidebar-documentpreview/src/client/TextPreview.tsx`

```
╔════════════════════════════════════════════════════════════╗
║ TextPreview（key='text-preview' tab 内容）                  ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  ▣ sidebar.right.tab.document  (keyed/session)              ║  ← TextPreview.tsx:351
║   key='markdown'   → ui-sidebar-documentpreview/markdown   ║
║   key='text'       → .../text                              ║
║   key='code'       → .../code                              ║
║   key='html'       → .../html                              ║
║   key='image'      → .../image                             ║
║   key='pdf'        → .../pdf                               ║
║   key='office'     → .../office  (内部还有子槽 ↓)           ║
║                                                            ║
║     Office 文档内部：                                       ║
║       ▣ sidebar.right.tab.document.office.pdf              ║  ← OfficeBody.tsx:89
║          (keyed/session) ← ui-sidebar-documentpreview/office║   PDF 转换结果专用槽
╚════════════════════════════════════════════════════════════╝
```

---

## 图 7：Settings 模态面板（点击 sidebar.settings 触发）

文件：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

> 触发器：侧栏底部 `sidebar.settings` slot（详见图 2）→ SettingsTrigger → 打开 SettingsRoot 模态

```
╔════════════════════════════════════════════════════════════════════╗
║ SettingsRoot（modal 浮层）                                          ║
╠════════════════════════════════════════════════════════════════════╣
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │ ▣ settings.trigger  (single/root) ← ui-settings-general       │  ║  ← SettingsRoot.tsx:228
║  │   → SettingsTriggerRow                                          │  ║     侧栏底按钮本身（已标在图2）
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  模态打开后：                                                       ║
║  ┌────────────┬───────────────────────────────────────────────────┐ ║
║  │  左导航列  │  内容区                                             │ ║
║  │            │                                                   │ ║
║  │  ▤ settings.section  (list/root) ← ui-settings-*              │ ║  ← SettingsRoot.tsx:101
║  │     ↳ id='general' (默认)         → GeneralSection           │ ║     (按 only={active} 过滤)
║  │       (含子槽)                                                    │ ║
║  │     ↳ id='models' (order=10)      → ui-settings-models        │ ║
║  │       子槽:                                                       │ ║
║  │         ▣ settings.models.provider-card (keyed/root)           │ ║  ← models section 内
║  │         ▤ settings.models.footer         (list/root)           │ ║
║  │     ↳ id='plugins' (order=15)     → ui-settings-plugins       │ ║
║  │       子槽:                                                       │ ║
║  │         ▤ settings.plugins.tab (list/root)                     │ ║
║  │           ↳ id='all' (order=10)                                │ ║
║  │             → ui-settings-plugin-inventory                     │ ║
║  │     ↳ id='agent-preset'           → ui-agent-preset            │ ║
║  │     ↳ id='unarchive-sessions'     → ui-settings-unarchive-     │ ║
║  │                                    sessions                    │ ║
║  │            │                                                   │ ║
║  └────────────┴───────────────────────────────────────────────────┘ ║
║                                                                    ║
║  面板标题栏（任何 section 都共享）：                                  ║
║   ┌────────────────────────────────────────────────────────────┐   ║
║   │  ▣ settings.header (single/root) ← ui-settings-general     │   ║  ← SettingsRoot.tsx:76
║   │     → SettingsTitle                                          │   ║
║   │  ▤ settings.action (list/root)  ← 各 section 头部动作          │   ║  ← SettingsRoot.tsx:94
║   │  ▣ settings.close   (single/root) ← ui-settings-general       │   ║  ← SettingsRoot.tsx:97
║   │     → 关闭按钮的隐藏文本                                        │   ║
║   └────────────────────────────────────────────────────────────┘   ║
║                                                                    ║
║  GeneralSection（id='general'）内部：                              ║
║   ┌────────────────────────────────────────────────────────────┐   ║
║   │  ▤ settings.general.item (list/root)                        │   ║  ← GeneralSection.tsx:17
║   │     ↳ id='locale'             → client/locale               │   ║
║   │     ↳ id='theme' (×2)         → ui-theme                    │   ║
║   │     ↳ id='composer-enter'      → ui-conversation             │   ║
║   │     ↳ id='permission-presets' → ui-permission-presets       │   ║
║   │     ↳ id='models-extras'      → ui-settings-models           │   ║
║   └────────────────────────────────────────────────────────────┘   ║
║                                                                    ║
║  模态层之上（首启引导，独立弹窗）：                                  ║
║   ▤ settings.onboarding (list/root) ← ui-settings-models           ║  ← SettingsRoot.tsx:254
║     ↳ id='welcome-notice'    (order=-100) → WelcomeNotice           ║
║     ↳ id='deepseek-official' (order=0)    → DeepSeekOnboarding      ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 图 8：Main 中央面板 — Plugins 模式（`main` slot, entryKey='plugins'）

文件：`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx`

```
╔════════════════════════════════════════════════════════════════════╗
║ main (keyed/root)                                                   ║
║   entryKey='plugins' → PluginManagerPage                            ║
╠════════════════════════════════════════════════════════════════════╣
║  列表视图（view='list'）                                              ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  ▤ plugins.item  (list/root) ← ui-settings-plugins           │  ║  ← PluginManagerPage.tsx:341
║  │      ↳ id='shell'             → ui-settings-plugins           │  ║     (按 only={id} 过滤渲染
║  │      ↳ id='agent-loop'        → ui-settings-plugins           │  ║      在 CardHead summary)
║  │      ↳ id='subagent+model-selection' → ui-settings-plugins     │  ║
║  │      ↳ id='web-search'        → ui-settings-plugins           │  ║
║  │   (各插件的"卡片头部一句话摘要"扩展)                               │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  详情视图（view='page'）                                              ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  ▤ plugins.item  (list/root)  ← 同上                          │  ║  ← PluginManagerPage.tsx:363
║  │      (插件详情页 body，按 only={item.id} 派发)                  │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  Bundle 详情页（每个 bundle）：                                       ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  ▣ plugins.bundle.config  (keyed/root) ← bundle 提供方          │  ║  ← PluginManagerPage.tsx:470
║  │      entryKey = <bundle 包名>                                   │  ║     (在 description 和 rows 间)
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  Row 详情页（每个 bundle 内的某行）：                                  ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  ▣ plugins.row.config  (keyed/root) ← row 提供方               │  ║  ← PluginManagerPage.tsx:390/393
║  │      entryKey = '<pkg>#<row id>'                                │  ║     (summary + page 两个视图)
║  └──────────────────────────────────────────────────────────────┘  ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## 图 9：Chat 视图（`conversation.view` entryKey='chat'）

文件：`packages/client/ui-chat/src/client/`

```
╔════════════════════════════════════════════════════════════════════════════╗
║ conversation.view (list/session) — id='chat'                              ║
║   → ChatView (ui-chat)                                                     ║
╠════════════════════════════════════════════════════════════════════════════╣
║  对话流（按 ChatNodeKind 顺序渲染节点）                                      ║
║                                                                            ║
║  ▣ conversation.chat.node  (keyed/session) ← ui-chat                       ║  ← ChatNodeSeat.tsx:137
║      按 entryKey = ChatNodeKind 派发：                                       ║
║      ┌─────────────────────────────────────────────────────────────────┐   ║
║      │ key='user'               → UserMessageNodeView                  │   ║
║      │ key='steering'           → UserMessageNodeView                  │   ║
║      │ key='context'            → ContextMessageNodeView               │   ║
║      │ key='system-prompt'      → SystemPromptNodeView                 │   ║
║      │ key='assistant-step'     → AssistantNodeView                    │   ║
║      │ key='command'            → CommandNodeView (含子槽 ↓)            │   ║
║      │ key='manual-compaction'  → ManualCompactionNodeView             │   ║
║      │ key='compaction'         → CompactionNodeView                   │   ║
║      │ key='model-retry'        → RetryNodeView                        │   ║
║      │ key='turn-error'         → TurnErrorNodeView                    │   ║
║      │ key='turn-max-tokens'    → TurnMaxTokensNodeView                │   ║
║      │ key='turn-process'       → TurnProcessNodeView                  │   ║
║      │ key='turn-tail'          → TurnTailNodeView (含子槽 ↓)          │   ║
║      │ key='unknown'            → UnknownNodeView                      │   ║
║      └─────────────────────────────────────────────────────────────────┘   ║
║                                                                            ║
║  command 节点内：                                                          ║
║   ▣ conversation.chat.commandview  (keyed/session) ← ui-tool/toolviews    ║  ← CommandNodeView.tsx:18
║      (按 tool 命令名派发；ask_user_question 等)                             ║
║                                                                            ║
║  turn-tail 节点（每轮结束处）：                                              ║
║   ┌────────────────────────────────────────────────────────────────────┐  ║
║   │  ▤ conversation.chat.turnTail (list/session)                       │  ║  ← TurnTailNodeView.tsx:26
║   │      ↳ id='deliverables' → ui-deliverables/DeliverablesTail       │  ║
║   │      ↳ id='plan-tail'     → ui-plan/PlanTail                       │  ║
║   │  ▤ conversation.chat.assistant-actions (list/session)               │  ║  ← TurnTailNodeView.tsx:36
║   │      ↳ id='message-feedback' → ui-message-feedback                 │  ║
║   └────────────────────────────────────────────────────────────────────┘  ║
║                                                                            ║
║  任何带图片的 tool 调用（与 node 并列显示）：                                ║
║   ┌────────────────────────────────────────────────────────────────────┐  ║
║   │  ▣ conversation.message.images (single/session) ← ui-attachment    │  ║  ← ChatView.tsx:300
║   │     → ImageGallery                                                  │  ║     一组持久化图片
║   │  ▣ conversation.approval.detail (single/session) ← ui-chat         │  ║  ← ChatView apply
║   │     → 审批节点的详情扩展（tool 调用上下文）                            │  ║
║   └────────────────────────────────────────────────────────────────────┘  ║
╚════════════════════════════════════════════════════════════════════════════╝
```

---

## 图 10：Trajectory 视图（`conversation.view` entryKey='trajectory'）

文件：`packages/client/ui-trajectory/src/client/TrajectoryView.tsx`

```
╔══════════════════════════════════════════════════════════════════╗
║ conversation.view (list/session) — id='trajectory'              ║
║   → TrajectoryView (ui-trajectory)                               ║
╠══════════════════════════════════════════════════════════════════╣
║  轨迹记录（每轮 steps/ledger）                                     ║
║                                                                  ║
║   ▣ conversation.trajectory.images (single/session) ← ui-attach  ║  ← TrajectoryView.tsx:141
║     → ImageGallery (与 Chat 共享同一 attachment 实现)              ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 图 11：Tool 调用渲染（任何 chat/trajectory 节点内部）

> Tool 由 `tool.call.toolview` keyed 槽统一派发；图片型 tool 额外走 `tool.call.images`

```
╔══════════════════════════════════════════════════════════════════════╗
║ 在 ChatNode / Trajectory 节点内的 Tool 行（每条 tool call 一个）          ║
╠══════════════════════════════════════════════════════════════════════╣
║  ▣ tool.call.toolview  (keyed/session)                              ║
║      按 wire tool name 派发：                                          ║
║      ┌────────────────────────────────────────────────────────────┐  ║
║      │ bash           → ui-tool/BashRow                          │  ║
║      │ edit           → ui-tool/FileMutationRow                  │  ║
║      │ write          → ui-tool/FileMutationRow                  │  ║
║      │ read           → ui-tool/ReadRow                          │  ║
║      │ read_image     → ui-tool/ReadImageRow                     │  ║
║      │ grep           → ui-tool/SearchRow                        │  ║
║      │ glob           → ui-tool/SearchRow                        │  ║
║      │ todo_write     → ui-tool/TodoRow                          │  ║
║      │ web_search     → ui-tool/WebRow                           │  ║
║      │ web_fetch      → ui-tool/WebRow                           │  ║
║      │ ask_user_question → ui-tool/AskQuestionRow                │  ║
║      │ skill          → ui-skill                                 │  ║
║      │ present        → ui-deliverables/PresentRow               │  ║
║      │ cordis_define  → ui-cordis                                │  ║
║      └────────────────────────────────────────────────────────────┘  ║
║                                                                      ║
║  image-bearing tool 行（如 read_image / present）内部：               ║
║   ▣ tool.call.images  (single/session) ← ui-attachment               ║
║     → ImageGallery（通过 toolview owner 提供的 loader 加载）          ║
║                                                                      ║
║  Cordis 工具行（cordis_define）内部：                                  ║
║   ▣ tool.view.cordis (keyed/session) ← dynamic package (key='self') ║
║     → 动态 package 注册的业务视图；Guard 自动把 'self' 绑到当前        ║
║       pluginId / packageId / pluginRunId                              ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 附录：所有 slot 一览（去重 ≈ 50 个 SlotMap key + 1 个 Factory）

| 序号 | Slot key | kind / scope | 注册者（按顺序） | 渲染位置（行号） |
|---|---|---|---|---|
| 1 | `root` | single/root | （内置种子；不可注册） | `AppFrame.tsx:196` 起整页 |
| 2 | `sidebar` | single/root | `ui-sidebar/SidebarRoot` | `AppFrame.tsx:196` |
| 3 | `main` | keyed/root | `key='conversation'` → `ui-conversation/ConversationPanel`；`key='plugins'` → `ui-plugin-manager/PluginManagerPage` | `AppFrame.tsx:42` |
| 4 | `rightbar` | single/root | `ui-sidebar-right/RightbarRoot` | `AppFrame.tsx:232` |
| 5 | `shell.overlay` | list/root | `id='terminal-cleanup'` → `ui-sidebar-terminal` | `AppFrame.tsx:203` |
| 6 | `sidebar.brand.mark` | single/root | `ui-brand-official` | `SidebarRoot.tsx:181/220` |
| 7 | `sidebar.brand.name` | single/root | `ui-brand-official` | `SidebarRoot.tsx:223` |
| 8 | `sidebar.toggle.badge` | single/root | `ui-settings-general/DesktopUpdateBadge` | `SidebarRoot.tsx:186` |
| 9 | `sidebar.panellist` | list/root | `id='plugins'` → `ui-plugin-manager` | `SidebarRoot.tsx:71` |
| 10 | `sidebar.workspaces` | single/root | `ui-workspace` | `SidebarRoot.tsx:272` |
| 11 | `sidebar.workspaces.directoryFlow` | single/root | `ui-directory-picker-{browse,native}` | `ui-workspace` 内部 |
| 12 | `sidebar.settings` | single/root | `ui-settings-general/SettingsTrigger` | `SidebarRoot.tsx:284` |
| 13 | `sidebar.footer.action` | list/root | `id='cordis'` → `extensions/ui-cordis/CordisPanel` | `SidebarRoot.tsx:281` |
| 14 | `main.conversation` | single/session-maybe | `ui-conversation/registerConversationRoot` | `ConversationPanel.tsx:11` |
| 15 | `conversation.session.header` | single/session | `ui-conversation/registerConversationHeader/SessionHeader` | `ConversationMainPanel.tsx:45` |
| 16 | `conversation.session.header.lineage` | single/session | `ui-subagent/SubagentHeaderLineage` | `ConversationSession.tsx:107/115` |
| 17 | `conversation.session.header.leading` | single/session | `ui-sidebar/HeaderLeadingControls` | `ConversationSession.tsx:74` |
| 18 | `conversation.session.header.actions` | list/session | `id='schedule-catalog'` → `ui-schedule`；`id='job-list'` → `ui-jobs` | `ConversationSession.tsx:129` |
| 19 | `conversation.session.header.utilities` | list/session | `ui-open-in-app` | `ConversationSession.tsx:133` |
| 20 | `conversation.session.header.corner` | single/session | `ui-sidebar-right/ExpandButton` | `ConversationSession.tsx:138` |
| 21 | `conversation.session` | single/session | `ui-conversation/ConversationSession` | `ConversationContent.tsx:9` |
| 22 | `conversation.view` | list/session | `id='chat'` → `ui-chat/ChatView`；`id='trajectory'` → `ui-trajectory/TrajectoryView` | `ConversationSession.tsx`（tabs 区） |
| 23 | `conversation.composer` | chain/session | `ui-approval/ApprovalComposer`；`ui-user-questions/QuestionComposer`；`ui-subagent/SubagentReadOnlyComposer`（priority=-10） | `ConversationContent.tsx:166` |
| 24 | `conversation.composer.bar` | single/session-maybe | `ui-conversation/InputBar` | `ConversationContent.tsx:140` |
| 25 | `conversation.input.dock` | list/session | `id='todo'` → `TodoPanel`；`id='queue'` → `QueueDock` | `ConversationContent.tsx:161` |
| 26 | `conversation.input.overlay` | list/session | `ui-message-feedback` | `InputBar.tsx:373` |
| 27 | `conversation.input.attachments` | single/session-maybe | `ui-attachment` | `InputBar.tsx:376` |
| 28 | `conversation.input.permission` | single/session | `ui-permission-presets` | `InputBar.tsx:433` |
| 29 | `conversation.input.plan` | single/session | `ui-plan` | `InputBar.tsx:434` |
| 30 | `conversation.input.model` | single/session | `ui-model-selection` | `InputBar.tsx:444` |
| 31 | `conversation.input.left` | list/session | （内置 UI：附件按钮、上下文计数等） | `InputBar.tsx:438` |
| 32 | `conversation.input.right` | list/session | （内置 UI：发送按钮等） | `InputBar.tsx:443` |
| 33 | `conversation.composer.dock` | list/session | （外部插件可追加） | `InputBar.tsx:486` |
| 34 | `conversation.hero.brand.mark` | single/root | `ui-brand-official` | `EmptyHero.tsx:148` |
| 35 | `conversation.hero.workspace` | single/root | `ui-workspace/WorkspacePicker` | `ConversationContent.tsx:113` |
| 36 | `conversation.hero.workspace.directoryFlow` | single/root | `ui-directory-picker-{browse,native}` | `ui-workspace` 内部 |
| 37 | `conversation.hero.agentPreset` | single/session-maybe | `ui-agent-preset` | `ConversationContent.tsx:126` |
| 38 | `conversation.chat.node` | keyed/session | 见 图 9 | `ChatNodeSeat.tsx:137` |
| 39 | `conversation.chat.commandview` | keyed/session | `ui-tool/toolviews/*`（按 tool 命令名） | `CommandNodeView.tsx:18` |
| 40 | `conversation.chat.turnTail` | list/session | `id='deliverables'` / `id='plan-tail'` | `TurnTailNodeView.tsx:26` |
| 41 | `conversation.chat.assistant-actions` | list/session | `id='message-feedback'` | `TurnTailNodeView.tsx:36` |
| 42 | `conversation.approval.detail` | single/session | `ui-chat`（默认） | `ChatView apply` |
| 43 | `conversation.message.images` | single/session | `ui-attachment` | `ChatView.tsx:300` |
| 44 | `conversation.trajectory.images` | single/session | `ui-attachment` | `TrajectoryView.tsx:141` |
| 45 | `rightbar.session` | single/session | `ui-sidebar-right/RightbarSeat` | `RightbarRoot.tsx:17` |
| 46 | `sidebar.right.pane.tab` | keyed/session | 见 图 6 | `SidebarRight.tsx:197` |
| 47 | `sidebar.right.pane.tab.title` | keyed/session | 同上各包 | `SidebarRight.tsx:197` |
| 48 | `sidebar.right.tab.menu.item` | list/session | kit 自带 + 外部追加 | `SidebarRight.tsx:322` |
| 49 | `sidebar.right.tab.guide` | chain/session | （默认自带 guide） | `GuideBody.tsx:102` |
| 50 | `sidebar.right.tab.guide.entry` | keyed/session | `key='terminal'` → `ui-sidebar-terminal` | `GuideBody.tsx:90` |
| 51 | `sidebar.right.tab.document` | keyed/session | 见 图 6.2 | `TextPreview.tsx:351` |
| 52 | `sidebar.right.tab.document.office.pdf` | keyed/session | `ui-sidebar-documentpreview/office` | `OfficeBody.tsx:89` |
| 53 | `settings.trigger` | single/root | `ui-settings-general/SettingsTriggerRow` | `SettingsRoot.tsx:228` |
| 54 | `settings.header` | single/root | `ui-settings-general/SettingsTitle` | `SettingsRoot.tsx:76` |
| 55 | `settings.action` | list/root | 各 section 头部动作 | `SettingsRoot.tsx:94` |
| 56 | `settings.close` | single/root | `ui-settings-general/SettingsCloseLabel` | `SettingsRoot.tsx:97` |
| 57 | `settings.section` | list/root | `id='models'`/`'plugins'`/`'agent-preset'`/`'unarchive-sessions'`/`'general'` | `SettingsRoot.tsx:101` |
| 58 | `settings.plugins.tab` | list/root | `id='all'` → `ui-settings-plugin-inventory` | `PluginsSettingsSection.tsx` |
| 59 | `settings.onboarding` | list/root | `id='welcome-notice'`/`'deepseek-official'` → `ui-settings-models` | `SettingsRoot.tsx:254` |
| 60 | `settings.general.item` | list/root | `id='locale'`/`'theme'`/`'composer-enter'`/`'permission-presets'`/`'models-extras'` | `GeneralSection.tsx:17` |
| 61 | `settings.models.provider-card` | keyed/root | 各 provider | `ModelsSection` 内部 |
| 62 | `settings.models.footer` | list/root | 各 provider | `ModelsSection` 内部 |
| 63 | `plugins.item` | list/root | `id='shell'`/`'agent-loop'`/`'subagent+model-selection'`/`'web-search'` → `ui-settings-plugins` | `PluginManagerPage.tsx:341/360/363` |
| 64 | `plugins.bundle.config` | keyed/root | 各 bundle 提供方 | `PluginManagerPage.tsx:470` |
| 65 | `plugins.row.config` | keyed/root | 各 row 提供方 | `PluginManagerPage.tsx:390/393` |
| 66 | `tool.call.toolview` | keyed/session | 见 图 11 | 各 ChatNode / Trajectory 节点内 |
| 67 | `tool.call.images` | single/session | `ui-attachment` | 各 image-bearing toolview 内 |
| 68 | `tool.view.cordis` | keyed/session | dynamic package（Guard 绑 `key='self'`） | `CordisRunRow.tsx:120` |
| 69 | `sidebar.chat.conversation` | single/session | `ui-subagent/SubagentChatConversation` | `ui-subagent/sidebar-chat` 内部 |
| — | **Factory `conversation.content`** | session-maybe | `ui-conversation/registerConversationContent` | `ConversationMainPanel.tsx:46` |
