# ADR 0001 — 单 session 可视化 v0.1：任务图 + Subagent 子树

- **状态**：接受（2026-09-21）
- **决策者**：skyaxis 团队
- **背景起点**：项目当前为骨架状态；`src/client/index.ts` 已 `inject: ['locale', 'slots']`，并已在 `conversation.view` slot 注册 `task-graph` 视图（id=`task-graph`，order=30），但 `src/client/task-graph/view.tsx` 仅渲染"任务图 / Task Graph — 待实现"占位文本。`docs/decisions/` 在 commit `2eb85ef` 后被清空，本 ADR 是该目录的首份决策记录。

---

## 一、背景

### 1.1 DSH 原生会话视图（已存在，不重复实现）

DSH 在 `conversation.view` slot 已提供两个并列视图，且围绕 session header 与 chat 节点提供了完整插槽系统（详见 [docs/slot槽位对照图/dsh-slot-ui-map.md](../slot槽位对照图/dsh-slot-ui-map.md)）：

- **chat 视图**：线性对话流
- **trajectory 视图**：节点 + 图片，按时间线性排列
- **`tool.call.toolview`**（keyed by 工具名）：每个工具类型的卡片
- **`conversation.session.header.lineage`**：父子 session 链路（面包屑）
- **`conversation.chat.turnTail`**：每个 turn 末尾的接力点
- **`conversation.approval.detail`**：审批节点详情
- **`rightbar.session` 内的 `sidebar.right.pane.tab`**：文档预览 / 引导

**所有这些视图按"时间线性"组织**——这是 DSH 的核心盲点：会话内的"任务结构"和"agent 拓扑"无法被一眼看清。

### 1.2 DSH 做不到 / 没暴露的事

| 能力 | DSH 现状 | 备注 |
| --- | --- | --- |
| 任务 DAG（"现在到哪一步 / 下一步是什么"） | 无 | trajectory 只给节点时间线 |
| Subagent 父子关系可视化 | 无 | subagent 在 trajectory 中按时间平铺 |
| 任务完成度（progress） | 无 | DSH 没有"任务完成百分比"概念 |
| 失败/卡点 elevation | 无 | 失败仅是 toolview 内的状态 |
| 时间成本聚合 | 无 | trajectory 不显示节点耗时 |
| 跨节点聚合（读了 file X 几次） | 无 | 无聚合视图 |

### 1.3 skyaxis 已有半成品

- `src/client/task-graph/register.ts`：注册 `task-graph` 视图进 `conversation.view`，id 稳定为 `task-graph`，中英文 label 已配置。
- `src/client/task-graph/view.tsx`：stub，仅显示占位。
- `src/client/task-graph/dictionary.ts`：i18n 词典。
- host 入口 `src/index.ts`：仍为空（`apply(ctx)` no-op，`inject: []`）。

### 1.4 用户痛点回扣

按 [users/personas.md](../users/personas.md) 核心画像 A（AI 重度多 session 用户，3-5 session 并行，session 间有依赖），单 session 内最高频的两个痛点：

- **看不清"现在到哪一步"**：AI 把复杂任务切成多步调用，chat/trajectory 都是线性的，老王要靠脑补拼出任务结构。
- **看不到 subagent 父子关系**：subagent 报错时，老王不知道是哪个 subagent、谁 spawn 的、为什么失败。

---

## 二、决策

**单 session 可视化 v0.1 范围确定为两项：**

1. **任务图（Task DAG）**——把 trajectory 的线性节点重构成结构化任务视图，挂在 `task-graph` 视图上（沿用现有注册）。
2. **Subagent 子树**——在任务图里把 subagent 作为一种特殊节点类型，呈现父子关系与聚合状态。

**两者合并在同一个 `task-graph` 视图内**，不另开新视图。

---

## 三、理由

### 3.1 为什么是这两项

| 候选 | 是否进 v0.1 | 理由 |
| --- | --- | --- |
| 任务 DAG | ✅ 是 | 命中"现在到哪一步"痛点；架构（slot/register/dictionary）已就位；数据全部从 trajectory 拿，不需新接 DSH API |
| Subagent 子树 | ✅ 是 | 命中"subagent 报错看不到根因"痛点；与任务图共用一个画布；DSH 完全没暴露这部分 UI |
| 失败/卡点 elevation | ❌ 推迟 | 可由任务图节点状态自然承载，独立做反而割裂；v0.2 跟进 |
| 时间成本聚合 | ❌ 推迟 | 数据现成（trajectory 时间戳），但价值密度低，叠加在 v0.2 |
| 跨节点工具 / 文件频率聚合 | ❌ 推迟 | 与任务图正交，独立价值但 v0.1 不阻塞核心痛点 |

### 3.2 为什么两者合并在同一视图

- task-graph 视图已经注册并占位，合并实现零额外架构成本。
- Subagent 子树本质是任务图的"特殊节点类型"——独立成视图会割裂结构感。
- 用户视角："这个 session 内的所有执行结构"是一个心智模型，拆开反而需要切换。

### 3.3 渲染形态

v0.1 用**画布**渲染任务图与 subagent 子树，技术选型与备选/弃选理由详见 §四。

---

## 四、技术选型：React Flow + Dagre

### 4.1 选型结论

v0.1 任务图与 subagent 子树的画布渲染采用：

- **`@xyflow/react` v12.x**——画布与节点渲染
- **`@dagrejs/dagre`**——DAG 自动布局

### 4.2 评估矩阵（按五个维度）

| 维度 | React Flow | Cytoscape.js | AntV X6 |
| --- | --- | --- | --- |
| 技术成熟度 | ✅ v12 自 2024 末稳定，无 breaking change | ✅ 10+ 年图论标杆 | ⚠️ 中高（5+ 年） |
| 社区活跃度 | ✅✅ npm 周下载 280 万+ | ⚠️ 中（科研为主） | ⚠️ 中高（中文为主） |
| 开源项目使用广度 | ✅✅ Apache Superset / Temporal / Replit / Langflow 等 | ⚠️ 多用于网络拓扑 / 图论 | ⚠️ 多用于国内中后台 |
| DSH 适配 | ✅✅ React 18 原生；节点 = React 组件 | ❌ Canvas + 命令式 API，需 wrapper | ⚠️ 需 `@antv/x6-react-shape` wrapper |
| 易维护 | ✅✅ MIT、TypeScript 一流、文档极好 | ⚠️ API 学习曲线陡 | ⚠️ 英文社区小、issue 解决慢 |
| 自定义节点能力 | ✅✅ 自由渲染 React 组件 | ❌ 自己 Canvas 渲染 | ⚠️ 需 wrapper |
| 内置布局算法 | ❌ 需外部库 | ✅✅ 20+ 内置 | ✅ 内置多种 |
| Bundle 体积（gzip） | ~100KB + 布局库 | ~200KB | ~300KB |

### 4.3 候选与弃选理由

**采用：React Flow + Dagre**

- React 18 与 DSH 技术栈原生契合，节点即 React 组件可自由接入 `--skyaxis-*` CSS 变量
- 280 万 npm 周下载、Apache Superset / Temporal / Replit 等大型项目实证
- v12.x 稳定无 breaking change，长期维护风险低
- Dagre 对树状 / 浅 DAG 足够（v0.1 两位数节点）

**弃选：Cytoscape.js**

- 命令式 API + Canvas 渲染，与 React 18 / DSH 技术栈不契合
- 千节点级性能对 v0.1 过度设计
- React 集成需 wrapper，社区维护较弱

**弃选：AntV X6**

- Bundle 最大（~300KB gzip）
- DSH 是国际化项目，X6 英文社区小，issue 与文档检索体验差

**弃选：自研 SVG / Canvas**

- 维护成本高
- DSH 已在 React 生态，从零搭画布基座不划算

### 4.4 Bundle 影响

```
@xyflow/react         ~70-100KB gzip
@dagrejs/dagre        ~25-35KB gzip
合计 ~100-130KB gzip（inline 进 lib/client.js）
```

DSH 的 `shared/tsdown.client.ts` 默认 `noExternal` 全 inline（除 module table 条目），`@xyflow/react` 与 `@dagrejs/dagre` 不在 `CLIENT_EXTERNALS` 中，会自动 inline。`lib/client.js` 从当前 ~25KB 膨胀到 ~300-400KB 区间，DSH web 可接受（DSH 自身已在加载十几个 `@deepseek-ai/*` 模块）。

### 4.5 关键依赖

新增到 `package.json`：

```json
"dependencies": {
  "@xyflow/react": "^12.10.4",
  "@dagrejs/dagre": "^1.1.4"
}
```

需要同步加入 `tsdown.config.ts` 的 `libExternal` 列表（这两个包在 host 端不会被用到，但保持显式声明以便审计）。

---

## 五、v0.1 设计要点

### 5.1 任务图节点类型（最小集合）

```
Root (session 根)
├── Step（AI 拆出的任务步骤，可推断自 assistant message 或工具调用序列）
│   ├── Tool Call（leaf 节点，对应 trajectory 里的 tool_call）
│   └── Approval（对应 trajectory 里的 approval 节点）
└── Subagent（特殊节点：作为 step 的 child，承载 subagent 内部 trajectory）
    └── Sub-Step（同 Step 的语义，但作用域在 subagent 内）
```

### 5.2 节点状态（最小集合）

每个节点渲染时携带：

- `pending`（未开始）/ `running`（进行中）/ `done`（完成）/ `failed`（失败）/ `waiting`（等用户输入）

状态来源：从 trajectory 节点的当前状态 + tool_call 返回值推断。

### 5.3 数据来源

v0.1 **不要求 AI 显式产出结构化任务**——全部从 trajectory 现有数据推断：

- Step 边界：assistant message 的 `text` 字段启发式分段（"接下来我会..." / "第 X 步"）。
- 父子关系：trajectory 节点的相邻关系 + session_id（subagent 通过 `parentSessionId` 关联）。
- 状态：trajectory node 当前 status + tool_call result。

如推断效果不达预期，v0.2 再考虑 AI 显式协议（增加 system prompt / 命令）。

### 5.4 渲染位置

仅一个视图：`conversation.view` slot 的 `task-graph` entry（id=`task-graph`，order=30，沿用 [src/client/task-graph/register.ts](../../src/client/task-graph/register.ts)）。

不修改其他 slot（不抢 header / turn tail / tool call card）。

---

## 六、Out of Scope（v0.1 不做）

- 失败/卡点作为独立 elevation 视图
- 时间成本聚合（节点耗时 / session 总耗时）
- 工具 / 文件频率聚合
- 跨 session 视图（多 session 总览、依赖图）—— 留给后续 ADR
- 编辑/标注任务结构的能力（v0.1 只读）
- 任务图导出 / 持久化（v0.1 视图层内存渲染）

---

## 七、验证

### 6.1 跑通判据

- 启用 skyaxis 插件后，DSH web 的 conversation view tab 出现"任务图"标签，点击可进入。
- 进入任务图：能看到 session 内步骤的树状结构，每个节点带状态颜色。
- 若 session 含 subagent：subagent 作为子树呈现，状态聚合（"X running / Y done / Z failed"）。
- 节点 hover / click：能看到该节点对应的 trajectory 上下文（链接或 inline 展开）。

### 6.2 不通过判据（v0.1 不要求）

- 不要求 AI 产出结构化任务
- 不要求 pan-zoom / 画布交互
- 不要求性能在百节点量级流畅

---

## 八、影响

### 8.1 文件改动

| 文件 | 改动 |
| --- | --- |
| `src/client/task-graph/view.tsx` | stub → 实质实现（任务树 + subagent 子树渲染） |
| `src/client/task-graph/`（新文件） | 新增：节点推断逻辑（trajectory → task node tree）+ 节点状态计算 |
| `src/client/task-graph/dictionary.ts` | 扩展：新增节点状态 / subagent 文案（如需） |
| `package.json` | 新增 `dependencies`：`@xyflow/react`、`@dagrejs/dagre` |
| `tsdown.config.ts` | `libExternal` 列表新增上述两个包 |

### 8.2 架构影响

- 不新增 DSH API 依赖（沿用 `dsh-client-store` / `dsh-api-session-controller` 已暴露的 trajectory 数据）。
- 不修改 `cordis.patch.yml` / `package.json#dsh.client`。
- 新增 2 个 npm 依赖：`@xyflow/react`（画布）+ `@dagrejs/dagre`（DAG 布局）。详见 §四。

### 8.3 后续 ADR 候选

- v0.2 范围（失败 elevation / 时间聚合 / 跨节点聚合）
- AI 显式任务协议（如果 v0.1 推断效果不达标）
- 跨 session 视图（多 session 总览 + session 间依赖）

---

## 九、修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-21 | 初版。`docs/decisions/` 在 `2eb85ef` 清空后的首份 ADR（编号从 0001 重新起算）；锁定 v0.1 范围 = 任务图（DAG）+ Subagent 子树，合并在 `task-graph` 视图内。 |
| 2026-09-21 | 追加 §四"技术选型：React Flow + Dagre"。原 §3.3"不做画布"反向为"用画布"（指向 §四）；新增 §四 评估矩阵与弃选理由；新增 2 个 npm 依赖：`@xyflow/react`、`@dagrejs/dagre`。 |