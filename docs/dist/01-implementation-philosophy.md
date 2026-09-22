# 01 实现思路：整体设计哲学、项目目标、分层架构、技术选型

> 本文档拆解 `task-dag-viewer` 的顶层设计。读完之后你应该能在脑海里画出整个插件的轮廓，知道每个模块为什么存在、彼此如何衔接。

## 1. 一句话目标

> **"不维护另一份编排数据，只把宿主平台已经拥有的会话投影重组成一张可视 DAG。"**

这个目标有三层含义：

| 层次 | 含义 | 落地表现 |
| --- | --- | --- |
| 数据来源 | 只读宿主平台既有 Session 投影，不建第二份数据库 | 没有数据库、没有 IPC、没有外部轮询 |
| 数据加工 | 把"业务事件流"折叠成"图节点/边"的不可变快照 | `src/team-projection.js` / `src/workflow-definition.js` / `src/graph-model.js` 三层纯函数流水线 |
| 数据呈现 | 把图渲染成可点击、可拖拽、可键盘操作的 DAG 画布 | `src/client.js` + `src/style.css` 的 React + SVG 实现 |

## 2. 设计哲学（五大原则）

### 原则 1：诚实 > 漂亮

界面上**不能臆造数据**。下面这些都是被反复强调的边界：

- 没有持久记录的 Provider/模型 → 展示 "Not recorded"，**绝不** 用公开模型页默认值冒充该次请求的证据。
- 思考深度若来自 Adapter 默认值 → 明确标注 `Adapter default`，**绝不** 写成 `Request config`。
- Workflow 定义丢失 → 提示 "Definition unavailable"，**绝不** 重建脚本。

> 体现这一原则的代码位置：`src/graph-model.js` 的 `agentMetrics()`、`src/reasoning-defaults.js` 的 `publicReasoningReference()`。

### 原则 2：投影边界 > 全局视图

不同来源的数据归属在不同的 Session 中：

- Agent Teams 的任务板/通信日志只存在于 **Team Lead Session**。
- Workflow 阶段分组只存在于 **发起 `workflow` 工具调用的那个 Session**。
- 普通子代理血缘通过 `origin: "subagent"` + `parentId` 追溯到当前 Session。

> 体现这一原则的代码位置：`src/client.js` `TaskDagAction` 里所有 `useSessions / useConversation / useSession` 的钩子调用，以及 `EmptyState` 引导用户打开正确的父 Session。

### 原则 3：确定性 > 性能

布局算法是**非递归、纯函数式、确定性的**。同一份输入必须产生同一份节点坐标。原因：

- 切换 Session / 刷新页面 / 重启宿主平台之后，自动布局结果要稳定可重现。
- 单元测试要求 `graphLayout(graph)` 两次调用结果完全相等（`scripts/graph-model.test.mjs` 第 247-281 行）。
- 3000 层深度的线性血缘也不能爆栈（同样是该测试）。

### 原则 4：失败可见 > 失败静默

- 异常依赖环 → 不抛错，进入"残量分量 fallback"，每个环被压平到 fallback 深度，仍然能渲染。
- Workflow 定义缺失 → 显示空状态卡片，**不**伪造脚本。
- Provider/模型未记录 → 显示 "Not recorded"，**不**猜测。

### 原则 5：Cordis 生命周期 > 自管 DOM

所有副作用（Style 标签、Locale 字典、Slot 注册、Conversation Definition 注册）都通过 `ctx.effect` 或 `ctx.slots.inject` 接入，卸载时由 Cordis 统一回收。`lib/invariant.js` 只做一件事：在 `invariants` 服务里登记自己，保证不会被错误地卸载。

## 3. 项目目标（用户视角）

| 视图 | 用户希望看到什么 | 插件提供什么 |
| --- | --- | --- |
| 总览 (Overview) | 当前 Session、子代理、Team、Workflow 全貌 | 一个对话框，三视图共享同一个节点 ID 命名空间 |
| Agent Teams | Team Lead、teammates、共享任务 DAG、通信通道 | 折叠 Team 事件 → 节点/边，通信作为可关闭的覆盖层 |
| Workflow | 持久 Workflow run、阶段分组、已启动成员 | 按 `workflow-run` Conversation Node 重建拓扑，可点击查看原始定义 |

附加能力：

- **节点交互**：点击 Agent 节点打开真实 Session；点击 Workflow run 打开定义详情；点击通信边打开最近 100 条消息时间线。
- **画布交互**：fit-to-viewport、原始尺寸画布平移、拖拽节点并同步连线。
- **分视图布局**：每个视图保留独立的手工布局；切视图不丢失。

## 4. 分层架构

整个插件分成 **7 层**，从下到上依赖关系严格单向：

```
┌──────────────────────────────────────────────────────────┐
│  L7  UI 渲染层         src/client.js (React + SVG)       │
├──────────────────────────────────────────────────────────┤
│  L6  图构建层          src/graph-model.js (buildGraph)    │
├──────────────────────────────────────────────────────────┤
│  L5  布局算法层        src/graph-model.js (graphLayout)   │
├──────────────────────────────────────────────────────────┤
│  L4  事件折叠层        src/team-projection.js            │
│                       src/workflow-definition.js         │
├──────────────────────────────────────────────────────────┤
│  L3  运行时指标投影    src/index.js (Cordis Host)        │
├──────────────────────────────────────────────────────────┤
│  L2  宿主平台投影源        useSession / useSessions /        │
│                       useConversation                   │
├──────────────────────────────────────────────────────────┤
│  L1  宿主平台 Conversation  Chat / workflow-run / tool-call   │
│       节点流           / team-snapshot 等                │
└──────────────────────────────────────────────────────────┘
```

每层职责：

| 层 | 文件 | 职责 | 输出 |
| --- | --- | --- | --- |
| L1 | 宿主平台内部 | 真实事件流 | `chat` 视图下的 Conversation Node 数组 |
| L2 | `useSession / useSessions / useConversation` | 响应式读取宿主平台状态 | 三个 React Hook 的快照 |
| L3 | `src/index.js` | 注册 Host 侧持久投影 | `taskDagAgentMetrics` Session 投影 |
| L4 | `src/team-projection.js` / `src/workflow-definition.js` | 把事件流折叠成小型快照节点 | 隐藏的 Conversation Node、定义元数据 |
| L5 | `src/graph-model.js#graphLayout` | 确定性拓扑排序 + 分层 + 坐标 | `{ width, height, positions, signature }` |
| L6 | `src/graph-model.js#buildGraph` | 把所有投影融合成统一的图结构 | `{ nodes, edges, parentIds, ... }` |
| L7 | `src/client.js` | 渲染 + 交互 | SVG DOM + 事件回调 |

依赖箭头：

```
L1 → L2 → L4 ──┐
       ↓       ↓
       L3 → L6 → L5 → L7
```

> 注意 L3 是 **Host 端**，L4–L7 是 **Client 端**，它们通过宿主平台的 Session 投影（`projectionValues`）和 Conversation 节点（`chat` view）这条唯一通道交换数据。

## 5. 技术选型理由

| 技术 | 选型理由 | 替代方案及其被否决的原因 |
| --- | --- | --- |
| **Cordis 插件模型** | 宿主平台官方插件框架，提供 effect / scope / inject | 手写 React 组件挂载 → 无法响应宿主平台主题，无法与 slot 集成 |
| **React 18 + ReactDOM.createPortal** | 宿主平台 UI 大量用 React；Tooltip/Dialog 用 portal 跳出 overflow | 原生 DOM → 不能复用 UI Primitives 的语义 token |
| **原生 SVG** | 图节点数量小（<100），SVG 足够；DOM 即节点，可直接绑定事件 | Canvas / WebGL → 交互成本高，键盘焦点不友好 |
| **手写确定性布局** | 节点规模有限，自己写拓扑排序 + 层级布局可控 | dagre / elk.js → 增加 ~50KB 依赖，递归布局对深度线性链不友好 |
| **零运行时依赖（Client 打包后）** | 宿主平台 Web profile 体积敏感 | Chart.js / Cytoscape → 体积太大，且样式与宿主平台主题不一致 |
| **Cordis Slot 注入到 `conversation.session.header.actions`** | 直接复用宿主平台的 Session 标题栏 action 区 | 自定义面板入口 → 视觉一致性差 |

## 6. 入口与生命周期

```js
// src/client.js（截选）
const inject = ['sessions', 'slots', 'locale', 'uiConversation'];

function apply(ctx) {
  ctx.effect(() => ctx.uiConversation.events.register(createTeamSnapshotDefinition()),
             'task-dag: Team snapshots');
  ctx.effect(() => { /* 注入 <style> 标签 */ }, 'task-dag: styles');
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-dag: dictionaries');
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'task-dag',
    order: 15,
    locale: NS,
    inject: () => ({ openSession, refreshCatalogs, setCatalogsOpen }),
  }, TaskDagAction));
}
```

四件生命周期副作用：

1. **Team 快照定义**：把每个 Team v1 事件投影为隐藏 Conversation Node。
2. **样式注入**：把 `src/style.css` 作为 `<style data-plugin="task-dag-viewer">` 注入 `<head>`。
3. **多语言字典**：注册中英文 i18n。
4. **Slot 注入**：在 Session 标题栏的 actions 槽位插入 `TaskDagAction` 按钮。

Host 端只有一件生命周期副作用（在 `src/index.js`）：

```js
export function apply(ctx) {
  ctx.inject(['sessionProjections'], scope =>
    scope.sessionProjections.register(metricsProjection)
  );
}
```

把 `taskDagAgentMetrics` 注册为 Session 级别的"最近一次请求头"投影。

## 7. 三个核心抽象

### 抽象 A：节点 ID 命名空间

不同来源的节点用前缀区分，避免 ID 冲突：

| 前缀 | 含义 | 例子 |
| --- | --- | --- |
| 无前缀 | 当前 Session ID（root） | `sess-abc123` |
| `agent:` | 子代理 / teammate / workflow-member | `agent:sess-xyz` |
| `team-task:` | Team 共享任务 | `team-task:task-1` |
| `workflow:` | Workflow run | `workflow:run-42` |
| `workflow-phase:` | Workflow 阶段分组 | `workflow-phase:run-42:verify` |
| `workflow-member:` | Workflow 启动的子会话 | `workflow-member:run-42:1` |

### 抽象 B：边 `kind` 枚举

```js
// src/graph-model.js#createBuilder.addEdge
const kinds = ['team', 'assignment', 'dependency', 'workflow', 'phase', 'delegation', 'communication']
```

每种 `kind` 在 CSS 和 UI 中有专属样式/图例。

### 抽象 C：节点 `status` 枚举

`src/graph-model.js#normalizeStatus` 把所有可能的状态归一化为：

```
running | completed | failed | cancelled | interrupted
| ready | blocked | pending | provisioning | idle
```

不在这 10 个枚举里的字符串全部 fallback 为 `idle`，避免上游字段漂移。

## 8. 小结

> **这个插件的本质是"投影的投影"。**
>
> 它把宿主平台已经持久化的多种 Session 投影（包括插件自己注册的 `taskDagAgentMetrics`）折叠成一张可视 DAG。所有"看得见"的东西都能在某个原始投影里找到出处，没有任何臆造数据、没有任何轮询、没有任何第二份存储。

下一步请阅读 [02-data-sources.md](02-data-sources.md)，了解每个数据源的细节。
