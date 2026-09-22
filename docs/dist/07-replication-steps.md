# 07 复刻实施步骤：把 `task-dag-viewer` 的 DAG 能力落地到你的宿主平台插件

> 本文档是落地手册。按 5 个 step 推进，每个 step 独立可验证。最后的"详细 prompt"可以直接喂给另一个 LLM 帮你批量生成代码。

## 目录

- [Step 1：搭建插件骨架与 Cordis 生命周期](#step-1搭建插件骨架与-cordis-生命周期)
- [Step 2：订阅 6 个数据源并实现团队事件折叠](#step-2订阅-6-个数据源并实现团队事件折叠)
- [Step 3：实现纯函数式图构建 `buildGraph`](#step-3实现纯函数式图构建-buildgraph)
- [Step 4：实现确定性布局与环 fallback](#step-4实现确定性布局与环-fallback)
- [Step 5：用 SVG + React 渲染 DAG 并接入诚实指标](#step-5用-svg--react-渲染-dag-并接入诚实指标)

每个 Step 都包含：

```
# step 目标
# 实现思路
# 必须做的
# 必须不做的
# 详细的prompt
```

---

## Step 1：搭建插件骨架与 Cordis 生命周期

### step 目标

产出一个最小可加载的宿主平台插件，在 Session 标题栏看到一个占位按钮，点击无副作用。所有后续步骤都在这个骨架上叠加。

### 实现思路

宿主平台插件 = 一个 Host 端 (`src/index.js`) + 一个 Client 端 (`src/client.js`) 的双胞胎包，通过 Cordis 的 inject / effect 机制挂载。Host 注册持久投影；Client 注册 UI Slot、样式、字典、Conversation Node Definition。两个端通过 Session 投影（`projectionValues`）和 Conversation Node（`chat` view）这条唯一通道交换数据。

骨架阶段只需要：

1. **Host 端**：注册一个空的 `taskDagAgentMetrics` Session 投影（先用 `init: () => null`，等 Step 5 再填真正折叠逻辑）。
2. **Client 端**：注册 CSS、字典、Conversation Node Definition 占位、在 `conversation.session.header.actions` 槽位注入按钮。

### 必须做的

- 创建 `src/index.js`、`src/client.js`、`src/style.css`、`src/reasoning-defaults.js` 四个文件。
- `src/index.js` 中通过 `ctx.inject(['sessionProjections'], ...)` 注册一个**合法的** Session 投影 schema（`stateSchema.parse()` 必须能接受 `null`）。
- `src/client.js` 中 `apply(ctx)` 必须按顺序注册：`uiConversation.events`、`<style>` 标签、`locale.register`、`ctx.slots.inject('conversation.session.header.actions', ...)`。
- 在 `package.json` 的 `host.client.inject` 列出所有用到的宿主平台 Client 包：`@host/api-session-controller`、`@host/client-locale`、`@host/client-ui-chat`、`@host/client-ui-conversation`、`@host/client-ui-primitives`、`@host/client-ui-renderer`、`@host/client-ui-workflow-run`。
- 在 `package.json` 的 `peerDependencies` 列出 `^0.1.2-rc.1` 的版本约束。
- 编写 `cordis.patch.yml`：`- insert: [{ id: task-dag, name: 'task-dag-viewer' }]`。

### 必须不做的

- 不要直接 `document.createElement` 后手动挂载到宿主平台标题栏——必须通过 `ctx.slots.inject`。
- 不要自己写 CSS reset——直接用宿主平台 UI Primitives 的语义 token（如 `--host-color-bg`, `--host-color-text` 等）。
- 不要写 `useEffect(() => { return () => cleanup(); }, [])` 的 cleanup 逻辑——用 `ctx.effect` 接管生命周期。
- 不要在 Client 端引入额外的打包器（如 webpack）——直接用宿主平台的 esbuild 流程（`scripts/build.mjs`）。
- 不要写异步 IO / fetch / WebSocket——所有数据通过 React Hooks 订阅。

### 详细的prompt

```
我要从零开始复刻一个宿主平台（Host）插件，名字叫 my-task-dag。它要可视化的内容跟 task-dag-viewer 一样：当前 Session 的子代理血缘、Agent Teams 任务/通信、Workflow run。

请你只生成 Step 1 的最小骨架代码，目标是让插件能加载并在 Session 标题栏显示一个 "任务 DAG" 按钮（点击先不做任何事）。

文件清单：
1. src/index.js：Cordis Host 端，注册一个名为 taskDagAgentMetrics 的 Session 投影。当前用空壳：init: () => null, apply: (state, event) => state。注意要实现 stateSchema.parse() 接受 null。
2. src/client.js：Cordis Client 端，通过 ctx.slots.inject('conversation.session.header.actions', ...) 注册一个 React 组件 TaskDagAction，里面先只渲染一个按钮 "任务 DAG"。同时注册 ctx.uiConversation.events.register 一个空 Conversation Node Definition（target: 'chat'），注册 ctx.locale.register(NS, { zh: { title: '任务 DAG' }, en: { title: 'Task DAG' } })，通过 ctx.effect 注入 src/style.css 的占位内容（先空着）。
3. src/style.css：先空文件，留一行注释。
4. src/reasoning-defaults.js：导出空的 PUBLIC_REASONING_REFERENCES 数组。
5. cordis.patch.yml：- insert: [{ id: task-dag, name: 'my-task-dag' }]
6. package.json：name=my-task-dag, version=0.1.0, type=module, main=lib/index.js，host.client.inject 列出 7 个宿主平台 Client 包，peerDependencies 列出 ^0.1.2-rc.1，devDependencies 包含 react@^18.3.1, react-dom@^18.3.1, jsdom@^29.1.1。

技术约束：
- 用 ES Module（import/export）写源码。
- Client 端因为宿主平台的兼容历史用 CommonJS（require/module.exports）。代码里 require('react'), require('react-dom'), require('@host/client-ui-primitives')。
- React 组件用 createElement（h）而不是 JSX，因为宿主平台注入端没有 babel。
- exports.inject = ['sessions', 'slots', 'locale', 'uiConversation']; exports.apply = apply。

注意：先不要实现任何业务逻辑，只搭骨架。返回所有文件完整代码，不要省略。
```

---

## Step 2：订阅 6 个数据源并实现团队事件折叠

### step 目标

把 6 个数据源（`useSession`、`useSessions`、`useConversation`、`workflow-run` Conversation Node、`tool-call` Conversation Node、插件自注册的 `taskDagAgentMetrics`）全部接好，并把 Team v1 事件折叠为隐藏 Conversation Node。在 React 组件里能拿到一个 `teamNodes: [...]` 数组，每个元素是 `{ id, kind, anchorSeq, data: { teamId, type: 'member'|'task'|'message'|'delivery', ... } }`。

### 实现思路

数据源订阅 = React Hook 调用。Team 事件折叠 = 注册一个 Conversation Node Definition 到 `uiConversation.events`。宿主平台在 chat view 流式写入 `team/*` 事件时，会自动用这个 definition 折叠为隐藏节点，然后通过 `useConversation(state => state.views.get('chat')?.legacy.nodes)` 暴露出来。

Workflow 节点的"原始定义"提取需要解析 `tool-call` 节点的 `argsRaw`。这部分是纯函数，可以在 `useMemo` 里跑。

### 必须做的

- 创建 `src/team-projection.js`，实现 `projectTeamEvent(event)` 和 `createTeamSnapshotDefinition()`：
  - 只折叠 `event.data.version === 1` 的事件。
  - 支持 4 种事件：`team/member`、`team/task`、`team/message/queued`、`team/message/delivered`。
  - 折叠后 `buildViewNode` 返回 `{ visibility: 'hidden', data: { teamId, seq, time, type, ...payload } }`。
- 创建 `src/workflow-definition.js`，实现 `extractWorkflowDefinition(viewNode)` 和 `attachWorkflowDefinitions(workflowNodes, chatNodes)`：
  - 解析 `kind === 'tool-call'` 节点的 `argsRaw`。
  - 提取 `args.script`（字符串）和 `args.meta`（含 `name / description / whenToUse / phases`）。
  - `attachWorkflowDefinitions` 按 `callId + anchorSeq` 唯一标识定义，按 `name` 匹配最近一次 run，新匹配在前。
- 在 `src/client.js` 的 `TaskDagAction` 组件里加：
  ```js
  const chatNodes = useConversation(
    state => state.views.get('chat')?.legacy.nodes ?? EMPTY_CHAT_NODES,
    sameArray
  );
  const workflowNodes = useMemo(
    () => attachWorkflowDefinitions(
      chatNodes.filter(node => node.kind === 'workflow-run'),
      chatNodes
    ),
    [chatNodes]
  );
  const teamNodes = useMemo(
    () => chatNodes.filter(node => node.kind === TEAM_SNAPSHOT_KIND),
    [chatNodes]
  );
  ```
- 在 `src/index.js` 临时给 `taskDagAgentMetrics` 投影加一个 "received" log（每次 `request/header` 都 console.log 一下），方便调试。

### 必须不做的

- 不要直接订阅 Chat 原始事件——必须通过 `ctx.uiConversation.events.register` 注册折叠器。
- 不要把 Team v1 事件数据存到自己的全局状态里——完全依赖宿主平台的折叠器把数据放到 `chat` view 里。
- 不要在 `projectTeamEvent` 里臆造 schema v2 的字段——v2 事件直接返回 `null`。
- 不要让 `attachWorkflowDefinitions` 按 `name` 匹配同名定义之外的方式匹配——必须 `callId + anchorSeq` + `name === runName` + `definition.anchorSeq <= run.anchorSeq`。
- 不要把 `args` 里除 `script` 和 `meta` 之外的字段（如运行时参数）记录到 definition 里——避免暴露隐私。

### 详细的prompt

```
我要实现 Step 2：让 my-task-dag 订阅宿主平台内部 6 个数据源中的 4 个：useSession, useSessions, useConversation, workflow-run Conversation Node, tool-call Conversation Node，以及把 Team v1 事件折叠为隐藏 Conversation Node。

文件改动：
1. 新建 src/team-projection.js：
   - 导出 TEAM_SNAPSHOT_KIND 常量，值是 'task-dag-team-snapshot'。
   - 实现 projectTeamEvent(event) 函数，输入是宿主平台持久事件，输出是 snapshot 对象或 null。
   - 只接受 event.data.version === 1。
   - 4 个事件类型：
     * team/member → { type: 'member', member: { id, name, description, phase, error? } }
     * team/task → { type: 'task', task: { id, revision, subject, description, status, ownerId?, blockedBy: string[] } }
     * team/message/queued → { type: 'message', message: { id, senderId, senderName, targetId, delivery, text, nonText } }
     * team/message/delivered → { type: 'delivery', messageId, targetId }
   - 导出 createTeamSnapshotDefinition()：返回 { kind, target: 'chat', match(), start(), update(), buildViewNode() }。match 返回 { id: String(snapshot.seq), role: 'start' }。update 返回原 state 不累积。

2. 新建 src/workflow-definition.js：
   - extractWorkflowDefinition(viewNode)：从 kind === 'tool-call' 节点提取 argsRaw，JSON.parse 出 args.script 和 args.meta（含 name, description, whenToUse, phases）。返回 { callId, anchorSeq, toolName, script, meta } 或 null。
   - attachWorkflowDefinitions(workflowNodes, chatNodes)：对每个 workflow-run 节点，按 callId+anchorSeq 唯一标识定义，按 name 匹配，按 anchorSeq 升序取最早的、anchorSeq <= run.anchorSeq 的定义。

3. 修改 src/client.js 的 TaskDagAction：
   - 增加 useSession / useSessions / useConversation 三个 Hook 调用。
   - useMemo 计算 workflowNodes = attachWorkflowDefinitions(filter('workflow-run'), chatNodes)。
   - useMemo 计算 teamNodes = filter(TEAM_SNAPSHOT_KIND)。
   - 当前阶段在按钮 label 旁边显示 teamNodes.length 和 workflowNodes.length（方便调试）。

4. 修改 src/index.js：
   - 给 metricsProjection.apply 加 console.log('task-dag request/header', event.data.header.config) 临时调试。
   - 其它逻辑保持不变。

注意：
- 暂时不要把这些数据真正画出来——Step 2 只验证数据流到位。
- team-projection.js 和 workflow-definition.js 必须是纯函数，便于单测。
- sameArray 比较器：长度相同且每个元素 === 才算相等。

返回所有修改后文件的完整代码。
```

---

## Step 3：实现纯函数式图构建 `buildGraph`

### step 目标

把所有 6 个数据源融合成一份统一的 `{ nodes, edges, parentIds, activeCount, communicationCount, hasTeamData, hasWorkflowData }` 图数据结构。三种 mode (`overview` / `team` / `workflow`) 各能正确产出对应的子图，且 `scripts/graph-model.test.mjs` 的 6 个核心测试全过。

### 实现思路

`buildGraph` 是 L4-L6 三层的入口。内部按以下顺序执行：

1. `catalogIndex(catalogs)` —— 把目录扁平化为 `Map<sessionId, { parentId, activity, mode, label }>`。
2. `foldTeam(rootId, teamNodes)` —— 折叠 Team 事件为 `{ members, tasks, messages, delivered }`。
3. `createBuilder(rootId, ...)` —— 创建空图容器（含根节点）。
4. `addTeamGraph(builder, ...)` —— 只在 mode === 'overview' || mode === 'team' 时调用。
5. `addWorkflowGraph(builder, ...)` —— 只在 mode === 'overview' || mode === 'workflow' 时调用。
6. `addGenericSubagents(builder, ...)` —— 只在 mode === 'overview' 时调用，补全剩余血缘子代理。
7. 汇总输出 + activeCount/communicationCount/hasTeamData/hasWorkflowData。

整个函数必须是**纯函数**：同样的输入产生同样的输出；不修改入参。

### 必须做的

- 创建 `src/graph-model.js`，按上面 7 步实现 `buildGraph`。
- 实现 `lineageDepths(rootId, summaries)`：走 up 链找每个 Session 的深度；孤儿（parentId 找不到）、非 `origin === 'subagent'`、成环（A.parent=B 且 B.parent=A）都标记为 invalid 并排除。
- 实现 `agentMetrics(summary)`：从 `projectionValues` 读 `taskDagAgentMetrics` + `tokenUsage` + `sessionStats`，返回 `{ provider, model, reasoningEffort?, reasoningSource, reasoningReference?, usage?, turns?, steps? }` 或 `null`。**严格不臆造任何字段**。
- 实现 `foldTeam(rootId, teamNodes)`：按 `anchorSeq` 排序；members 按 seq 取最新；tasks 按 revision/seq 取最新；messages 按 ID 去重；delivered 是 Set。**根 Session 不是 teamId 时整块跳过**。
- 实现 `addTeamGraph`：生成 `agent:*` 节点、`team-task:*` 节点、`team` / `assignment` / `dependency` / `communication` 边。**通信边 layout=false**。
- 实现 `addWorkflowGraph`：生成 `workflow:*` 节点、可能的 `workflow-phase:*` 节点、`workflow-member:*` 节点、`workflow` / `phase` 边。
- 实现 `addGenericSubagents`：只添加 `depths` 有记录且未被 Team/Workflow 占用的 Session，挂在 `agent:*` 命名空间。
- 创建 `scripts/graph-model.test.mjs`，跑以下测试（每个都要 `assert.deepEqual` 验证）：
  - `lineageDepths` 接受合法后代、拒绝孤儿、拒绝环。
  - Team 视图折叠 task/owner/dependency/双向 communication。
  - Workflow 视图创建 phase 节点、保留 navigationId。
  - Overview 视图去重 Team/Workflow 已占用的 Session。
  - `agentMetrics` 折叠 request-config / adapter-default / not-recorded 三种 reasoningSource。
  - `agentMetrics` 把 public default reference 附加到 reasoningReference 但不覆盖 recorded value。
- 把测试加到 `package.json#scripts.check`：`node --test scripts/graph-model.test.mjs`。

### 必须不做的

- 不要在 `buildGraph` 内部调用任何 React Hook——它是纯函数。
- 不要在 `foldTeam` 里跨 Session 拉取数据——Team 数据全部在 Lead Session 的 `chat` view 里。
- 不要让通信边的 `kind === 'communication'` 出现在 `layout !== false` 的边集合里——拓扑排序会失败。
- 不要在 `addGenericSubagents` 里重复创建已被 Team/Workflow 占用的 Session 节点——用 `groupedIds: Set` 去重。
- 不要修改入参的 `summaries`、`catalogs`、`teamNodes`、`workflowNodes`。
- 不要假设 `summaries` 一定有某个 Session——缺失时跳过，不要抛错。

### 详细的prompt

```
我要实现 Step 3：在 my-task-dag 里实现纯函数 buildGraph，把 6 个数据源融合成统一图结构。完成后 scripts/graph-model.test.mjs 的 6 个测试必须全过。

新建 src/graph-model.js，导出 buildGraph、lineageDepths、normalizeStatus、NODE_WIDTH=224、NODE_HEIGHT=76。

实现以下 7 个内部函数（按调用顺序）：

1. normalizeStatus(status) → string：把任意状态归一化为 running | completed | failed | cancelled | interrupted | ready | blocked | pending | provisioning | idle 之一，不在枚举里返回 'idle'。

2. summaryStatus(summary, detail)：detail.activity === 'running' || summary.running → 'running'；summary.completed → 'completed'；否则 'idle'。

3. typeLabel(type, t)：根据节点 type 返回 i18n 字符串。one-shot → 'oneShot', continuable → 'continuable', teammate → 'teammate', workflow-member → 'workflowMember', workflow → 'workflow', phase → 'phaseGroup', task → 'teamTask', root → 'current'，默认 'subagent'。

4. nonnegativeNumber(value)：typeof === 'number' && Number.isFinite && >=0 才返回值，否则 0。

5. agentMetrics(summary)：读 summary.projectionValues.taskDagAgentMetrics + tokenUsage + sessionStats。reasoningEffort 必须有非空字符串才算 recorded；未记录时附加 publicReasoningReference() 返回的 reasoningReference（包含 effort / kind='public-api-model-reference' / evidenceScope / verifiedOn / historicalClaim=false）。

6. catalogIndex(catalogs)：把 catalogs[parentId].entries 中 kind === 'child' 的条目扁平化为 Map<sessionId, { parentId, activity, mode, label }>。

7. lineageDepths(rootId, summaries)：迭代所有 summaries，向上爬到 rootId：
   - 已在 depths → 用基准深度
   - invalid / 非 origin='subagent' / parentId undefined / 成环 / 父 ID 找不到 → 标记 invalid，整圈环全部 invalid
   - 起点是 rootId 时 baseDepth = 0
   - 返回 Map<sessionId, depth>

8. foldTeam(rootId, teamNodes)：按 anchorSeq 排序，归类为 { members: Map, tasks: Map, messages: Map, delivered: Set }。teamId !== rootId 的整块跳过。

9. taskOrder(id, fallback)：匹配 /^task-(\d+)$/ 提取数字，安全整数才返回，否则 fallback。

10. phaseName(phase, t)：phase 为 null/undefined/'' 返回 t('node.unphased')，否则 String(phase)。

11. nodeComparator(left, right)：order 优先，label 次之，id 最后。都用 localeCompare。

12. createBuilder(rootId, rootRunning, summaries, ordinaryIds, t)：返回 { nodesById: Map, edgesById: Map, ordinary: Set, rootLabel, addNode, addEdge }。addNode 幂等；addEdge 自动忽略悬空边。

13. addTeamGraph(builder, rootId, summaries, details, team, t)：
   - 给 team.members 创建 agent:* 节点，status: failed/provisioning/summaryStatus。
   - ensureAgent(sessionId, fallbackName) 兜底创建 agent 节点。
   - 给 team.tasks（过滤 status !== 'deleted'）创建 team-task:* 节点：
     * status: completed/in_progress/blockersComplete?ready:blocked
     * owner: t('node.unassigned') / memberNames.get / summaries.displayTitle / t('node.unknownOwner')
     * 边 ownerNode → taskNode kind='assignment' layout=true
   - 给每个 task.blockedBy 创建 dependency 边 team-task:blocker → team-task:this layout=true。
   - 折叠 messages 为 channels（key=senderId>targetId）：
     * reverse = channels.has(target>sender)
     * curve = reverse ? (senderId.localeCompare(targetId) < 0 ? -1 : 1) : 0
     * 边 kind='communication' layout=false
   - 返回 { sessionNodes, memberNames }。

14. addWorkflowGraph(builder, rootId, workflowNodes, summaries, details, t)：
   - 给每个 workflow-run 创建 workflow:* 节点，definition 来自 workflowNodes[i].data.definition。
   - usePhaseNodes = phases.length > 1 || phases.some(p => p.phase)。
   - 每个 phase 创建 workflow-phase:* 节点（条件性），status = running/failed/completed/data.status 中选最严重。
   - 每个 phase.members 创建 workflow-member:* 节点。
   - 边 root → workflow:* (kind='workflow')，workflow:* → workflow-phase:* (kind='phase')，workflow-phase:* → workflow-member:* (kind='workflow')。

15. addGenericSubagents(builder, rootId, summaries, details, groupedSessionNodes, groupedIds, t)：
   - 过滤 summaries：id !== rootId && depths.has(id) && !groupedIds.has(id)。
   - 创建 agent:* 节点，navigable = ordinary.has(sessionId)。
   - parentId: summary.parentId === rootId ? rootId : groupedSessionNodes.get(parentId) || agent:parentId。
   - 边 parentId → agent:* kind='delegation' layout=true。
   - 返回 depths。

16. buildGraph({ rootId, rootRunning, summaries, catalogs, ordinaryIds, teamNodes, workflowNodes, mode, t })：
   - catalogIndex → foldTeam → createBuilder。
   - mode overview|team → addTeamGraph。
   - mode overview|workflow → addWorkflowGraph。
   - mode overview → addGenericSubagents。
   - 汇总输出 { rootId, mode, nodes, edges, parentIds, activeCount, communicationCount, hasTeamData, hasWorkflowData }。

测试 scripts/graph-model.test.mjs：
1. lineageDepths: direct=1, nested=2, orphan 不在, cycleA/B 都不在。
2. Team 视图: task-1 completed, task-2 ready, task-3 blocked, task-deleted 不存在；communication 两条都 reverse=true，pending 正确。
3. Workflow 视图: workflow:review inspectable=true, definition.script === 'return null'，child navigationId === 'child'。
4. Overview 去重: team/flow/plain 各只出现 1 个节点。
5. agentMetrics: selected 有 reasoningEffort='xhigh', providerDefault 附 reasoningReference，legacy 的 reasoningSource='not-recorded'，contradictory 的 reasoningSource 强制为 'not-recorded' 但保留 reasoningEffort。
6. （可选）graphLayout 对深链的确定性（3000 节点）放在 Step 4 测试。

注意：
- graph-model.js 不依赖 React、不依赖宿主平台客户端 API。
- 所有 i18n 通过 t(key, values={}) 函数调用，禁止硬编码字符串。
- 严格不臆造数据：reasoningEffort 缺失时整个字段不输出；reasoningSource 只在三个枚举里。

返回 src/graph-model.js 和 scripts/graph-model.test.mjs 完整代码。
```

---

## Step 4：实现确定性布局与环 fallback

### step 目标

实现 `graphLayout(graph)`，对任何合法输入图返回稳定的 `{ width, height, positions, signature }`。3000 节点线性链不爆栈；双向环 a↔b + 下游 c 能正确把 a 和 b 压平到同一层，c 在下一层。`scripts/graph-model.test.mjs` 增加的布局测试全过。

### 实现思路

**核心算法**：

1. 入度表构建（过滤 `layout:false` 边和自环）。
2. Kahn 拓扑排序（用二分插入保证确定性 + O((V+E) log V)）。
3. **`Math.max` 处理多入边**（同节点可能从多个上游到达，取最深层）。
4. 主循环跑完后，未分配的节点进入 `residualComponents` 残量分量 fallback：Tarjan-style Kosaraju 迭代版求强连通分量，再对分量级 DAG 做 Kahn 排序赋深度；分量内所有节点压平到同一层。
5. 分桶 `layers[depth].sort(nodeComparator)`。
6. 居中算坐标 `x = startX + index * (NODE_WIDTH + X_GAP)`。
7. 算 `signature = "${mode}|${nodes.join('|')}|${structuralEdges.join('|')}"`。

### 必须做的

- 在 `src/graph-model.js` 里实现 `graphLayout` 和私有函数 `insertSorted`、`residualComponents`、`graphDepths`。
- 常量：`NODE_WIDTH=224`、`NODE_HEIGHT=76`、`X_GAP=30`、`Y_GAP=70`、`CANVAS_PAD=38`、`MIN_CANVAS_WIDTH=760`。
- `insertSorted(queue, node, compare)`：二分查找插入点，`splice` 插入。`O(log n)`。
- `residualComponents(residualIds, outgoing, compareIds)`：迭代版 Kosaraju。
  - 正向 DFS：栈模拟，记录完成顺序。
  - 反向 DFS：按完成顺序倒序展开。
  - 分量内 `component.sort(compareIds)`。
  - 返回 `{ components, componentById }`。
- `graphDepths(graph, nodesById)`：
  - 构建入度表 + outgoing 表，过滤 layout:false / 自环 / 悬空。
  - 主循环 Kahn，二分插入排序。
  - `Math.max(depths.get(target) || 0, baseDepth + 1)` 处理多入边。
  - `processed` 集合记录已分配节点。
  - `residualIds = filter(!processed)` → 进入 fallback。
  - fallback：构建分量级 DAG，Kahn 排序赋深度；分量内压平。
  - 全空兜底：`rootId=0, 其它=1`。
- `graphLayout(graph)`：调 `graphDepths` → `layers` → 算 `width/height` → 算 `positions` → 算 `signature`。
- 在 `scripts/graph-model.test.mjs` 增加：
  - 测试 6：3000 节点线性链布局确定性 + y 单调递增。
  - 测试 7：双向环 a↔b + 下游 c，a.y === b.y 且 c.y > b.y。
  - 测试 8：`graphLayout(cyclic)` 两次调用结果 `deepEqual`。
- 所有路径都要 `assert.deepEqual([...positions.entries()], [...secondPositions.entries()])` 验证确定性。

### 必须不做的

- 不要用 `Array.sort` 排序队列——`O(n²)` 会让 3000 节点很慢。必须用 `insertSorted` 二分插入。
- 不要用递归实现 DFS——深度可能上千会爆栈。用栈 + 索引手动模拟。
- 不要假设图一定无环——必须实现 `residualComponents`。
- 不要把 `layout: false` 边算进 `signature`——toggle 通信会触发不必要的状态重置。
- 不要让 `graphLayout` 修改 `graph` 对象或任何入参。
- 不要在 `width` 计算里用 `Math.max(0, widest - 1) * X_GAP` 之外的公式——单节点时 X_GAP 不算。
- 不要让 `layers[depth]` 内部顺序依赖任何 hash map 迭代顺序——所有地方都用 `nodeComparator` 三级排序。

### 详细的prompt

```
我要实现 Step 4：在 src/graph-model.js 里实现确定性布局 graphLayout + 环 fallback。完成后 3000 节点链不爆栈、双向环能被压平。

实现以下函数：

1. insertSorted(queue, node, compare)：
   - 二分查找插入点
   - queue.splice(low, 0, node)
   - O(log n)

2. residualComponents(residualIds, outgoing, compareIds)：
   - 输入：未分配的节点 ID 列表 + outgoing 邻接表 + 比较器
   - 构建子图（adjacent + reverse，只连 residual 内的边）
   - adjacent.values() 和 reverse.values() 都要 sort(compareIds)
   - 正向 DFS（迭代版，栈 + index 字段）：记录 finished 顺序
   - 反向 DFS：按 finished 倒序展开，每个起点对应一个强连通分量
   - component.sort(compareIds)
   - 返回 { components: string[][], componentById: Map<string, number> }

3. graphDepths(graph, nodesById)：
   - 构建 indegree: Map<id, number>，outgoing: Map<id, string[]>，跳过 edge.layout === false / edge.from === edge.to / !nodesById.has(...) 的边
   - outgoing.values() sort(compareIds)，compareIds = (l, r) => nodeComparator(nodesById.get(l), nodesById.get(r))
   - 主循环：indegree === 0 的入 insertSorted 队列；shift 后处理 outgoing，更新 depths 用 Math.max(...)，减 indegree，归零入队
   - processed Set 记录已分配节点
   - residualIds = graph.nodes.filter(n => !processed.has(n.id))
   - 如果 residualIds 非空：
     * residualComponents(residualIds, outgoing, compareIds)
     * 构建 componentOutgoing（Set 防止重复边）和 componentIndegree
     * componentDepth 初始化：如果分量内节点有已知深度，取最大值
     * fallbackDepth = max(processed depth) + 1
     * compareComponents = (l, r) => compareIds(components[l][0], components[r][0])
     * Kahn 排序分量：componentDepth ?? fallbackDepth，next depth + 1
     * 分量内所有节点 depths.set(id, depth)
   - 兜底：!depths.has(id) → rootId ? 0 : 1

4. graphLayout(graph)：
   - nodesById = new Map(graph.nodes.map(n => [n.id, n]))
   - depths = graphDepths(graph, nodesById)
   - layers = Array(maxDepth + 1).fill([])，每层 push 节点后 sort(nodeComparator)
   - widest = max(1, ...layers.length)
   - width = max(MIN_CANVAS_WIDTH=760, CANVAS_PAD*2 + widest*NODE_WIDTH + max(0, widest-1)*X_GAP)
   - height = CANVAS_PAD*2 + layers.length*NODE_HEIGHT + max(0, layers.length-1)*Y_GAP
   - 对每层：layerWidth = layer.length*NODE_WIDTH + max(0, layer.length-1)*X_GAP，startX = (width - layerWidth) / 2
   - positions.set(layer[i].id, { x: startX + i*(NODE_WIDTH+X_GAP), y: CANVAS_PAD + depth*(NODE_HEIGHT+Y_GAP) })
   - signature = `${graph.mode}|${graph.nodes.map(n => n.id).join('|')}|${graph.edges.filter(e => e.layout !== false).map(e => `${e.kind}:${e.from}>${e.to}`).join('|')}`
   - 返回 { width, height, positions, signature }

常量：NODE_WIDTH=224, NODE_HEIGHT=76, X_GAP=30, Y_GAP=70, CANVAS_PAD=38, MIN_CANVAS_WIDTH=760

测试 scripts/graph-model.test.mjs 新增：

test('graphLayout is deterministic for deep lineages', () => {
  const summaries = { root: { id: 'root', displayTitle: 'Root' } };
  let parentId = 'root';
  for (let i = 0; i < 3000; i++) {
    const id = `node-${i}`;
    summaries[id] = { id, displayTitle: id, origin: 'subagent', parentId, updatedAt: i };
    parentId = id;
  }
  const graph = buildGraph({ rootId: 'root', rootRunning: true, summaries, catalogs: {}, ordinaryIds: Object.keys(summaries), teamNodes: [], workflowNodes: [], mode: 'overview', t });
  const a = graphLayout(graph);
  const b = graphLayout(graph);
  assert.equal(a.positions.get('agent:node-2999').y > a.positions.get('agent:node-0').y, true);
  assert.deepEqual([...a.positions.entries()], [...b.positions.entries()]);
});

test('graphLayout handles cyclic dependency input via residual fallback', () => {
  const cyclic = {
    rootId: 'root', mode: 'team',
    nodes: [
      { id: 'root', label: 'Root', order: 0 },
      { id: 'a',    label: 'A',    order: 1 },
      { id: 'b',    label: 'B',    order: 2 },
      { id: 'c',    label: 'C',    order: 3 },
    ],
    edges: [
      { from: 'root', to: 'a', kind: 'assignment', layout: true },
      { from: 'a',    to: 'b', kind: 'dependency', layout: true },
      { from: 'b',    to: 'a', kind: 'dependency', layout: true },
      { from: 'b',    to: 'c', kind: 'dependency', layout: true },
    ],
  };
  const l1 = graphLayout(cyclic);
  assert.equal(l1.positions.size, 4);
  assert.equal(l1.positions.get('a').y, l1.positions.get('b').y);
  assert.equal(l1.positions.get('c').y > l1.positions.get('b').y, true);
  assert.deepEqual([...l1.positions.entries()], [...graphLayout(cyclic).positions.entries()]);
});

注意：
- 严格用迭代而不是递归
- 严格按 nodeComparator 三级排序
- 严格用 Math.max 处理多入边
- residualComponents 输出的 components 必须完全可重现

返回修改后的 src/graph-model.js 和 scripts/graph-model.test.mjs 完整代码。
```

---

## Step 5：用 SVG + React 渲染 DAG 并接入诚实指标

### step 目标

打开 "任务 DAG" 按钮，弹出对话框，里面：

- 三视图 tabs：Overview / Agent Teams / Workflow。
- SVG 画布 + 节点 + 边 + 拖拽 + 平移。
- Hover Agent 节点弹 tooltip：Provider / 模型 / 思考深度（带来源标签）/ 累计 Token / 轮次 / 步数。
- 点击 Agent 节点打开对应 Session（仅当 `ordinaryIds` 里有）。
- 点击通信边打开消息时间线（最近 100 条）。
- 点击 Workflow run 节点打开定义详情（带复制代码）。
- 三视图手工布局独立保存。

### 实现思路

整个 Client 是 React + SVG，所有数据通过 `useSessions / useSession / useConversation` 订阅，所有布局通过 `useMemo` 计算。所有交互通过 React state 驱动：manual positions、selected communication、selected workflow、hovered metrics、fit mode。

### 必须做的

- 实现 `TaskDagAction` 顶层组件：拿到 sessions 状态 → 计算三视图 graphs → 渲染触发按钮。
- 实现 `TaskDagDialog` 容器组件：dialog 框架 + tabs + 画布 viewport + 拖拽状态。
- 实现 `TaskGraph` SVG 组件：`viewBox` + `defs/marker` 箭头 + 边 + 节点循环渲染。
- 实现 `GraphNode`：`<g transform="translate(x y)">` + 卡片 rect + 装饰 rect + glyph + 文字 + status dot；`onClick` 路由到 `onOpen`/`onInspectWorkflow`；`onPointerDown/Move/Up` 处理拖拽；`onFocus/onPointerEnter` 触发 metrics tooltip。
- 实现 `GraphEdge`：
  - `kind !== 'communication'`：`structuralPath(from, to)` 贝塞尔曲线 + `marker-end="url(#task-dag-viewer-arrow)"`。
  - `kind === 'communication'`：`communicationGeometry(from, to, curve)` 二次贝塞尔 + 偏移；`curve === 0` 时偏移 34，`curve === ±1` 时偏移 ±54。
- 实现 `NodeMetricsTooltip`：`ReactDOM.createPortal` 渲染到 `document.body`；展示 Provider/模型/思考深度（带 `reasoningSource` 标签）/ 公开默认参考行 / 累计 Token / 轮次 / 步数 / "随持久会话投影更新" footer。
- 实现 `CommunicationInspector`：`aside` 抽屉，最多展示最近 100 条消息，含 quiet/wakeup 和 delivered/queued 标签。
- 实现 `WorkflowDefinitionInspector`：复用宿主平台 `CodeBlock` 展示 `definition.script`，含元数据 + 阶段声明 + 复制按钮。`definition === null` 时显示"Definition unavailable"。
- 实现 `EmptyState`：Team 视图空时显示"打开上级 Session"按钮（`rootSummary.parentId` 是 ordinary 才显示）。
- `src/index.js` 的 `taskDagAgentMetrics` 投影按 [06-metrics-honesty.md](06-metrics-honesty.md) 实现完整折叠：
  - `stateSchema.parse()` 强制 provider/model 非空字符串；`reasoningSource` 三枚举；`not-recorded` 与 `reasoningEffort` 互斥。
  - `apply()` 仅响应 `event.type === 'request/header'`；`reasoningSource` 按 `adapterDefaults.reasoningEffort === true` 判定。
- `src/reasoning-defaults.js` 实现 `PUBLIC_REASONING_REFERENCES` 表和 `publicReasoningReference(provider, model)` 查询函数；用 `Object.freeze` 锁定；每个条目带 `evidenceScope`、`historicalClaim: false`、`verifiedOn`、`sourceUrl`。
- 编写 `scripts/metrics-projection.test.mjs`：
  - 测试 `apply` 对 `request/header` 之外的 event 不响应。
  - 测试 `apply` 对相同 event 不产生新 state。
  - 测试 `apply` 对 `adapterDefaults.reasoningEffort: true` 输出 `adapter-default`。
  - 测试 `apply` 对缺失 `reasoningEffort` 输出 `not-recorded` 且不携带 `reasoningEffort`。
  - 测试 `stateSchema.parse` 拒绝 provider/model 为空字符串。
  - 测试 `stateSchema.parse` 拒绝 `not-recorded` + `reasoningEffort` 共存。
- 编写 `scripts/smoke.mjs`：用 jsdom 跑 `npm run build` 之后，加载 `lib/client.js` 的导出，模拟点击 trigger，断言对话框出现、三视图 tabs 存在、SVG 节点数量符合期望。
- 把 `npm run check` 改完整：
  ```json
  "check": "node --check src/*.js && node --test scripts/*.test.mjs && node scripts/build.mjs && node scripts/smoke.mjs"
  ```

### 必须不做的

- 不要在 Tooltip 里用 `position: absolute` 嵌入 SVG 内——必须 `ReactDOM.createPortal` 到 body。
- 不要在通信边的 `curve === 0` 时让成对通信叠加——必须按 senderId.localeCompare(targetId) 分 -1/+1。
- 不要把 Workflow 节点的 `definition` 默认填成"已猜测的代码"——`argsRaw` 解析失败时 `definition = null`，UI 显示"Definition unavailable"。
- 不要在 `TaskDagAction` 里直接 `document.querySelector('.session-header')` 然后插入按钮——必须通过 `ctx.slots.inject` 注入 React 组件。
- 不要假设 `tokenUsage` / `sessionStats` 一定有——缺失时 metrics 该字段不输出。
- 不要在 `taskDagAgentMetrics` 投影里**写**入宿主平台内置的 `tokenUsage` / `sessionStats`——只能添加自己的键。
- 不要让 Tooltip 在拖拽时跟随鼠标——拖拽时 `onHideMetrics`，松手后由 `onFocus` 重新触发。
- 不要给 Panel / 画布 / 节点加键盘拖拽——只支持鼠标拖拽。键盘只支持 Enter/Space 触发点击。
- 不要让 Dialog 有焦点陷阱——按 Escape 关闭后焦点还给 trigger 按钮即可。
- 不要在 Workflow view 把 `phase` 边的 `kind` 设为 `dependency`——phase 只是展示分组，**不是**脚本依赖。

### 详细的prompt

```
我要实现 Step 5：把 my-task-dag 的客户端渲染完整做出来。这是最后一步，目标是在真实宿主平台 Web Session 标题栏点击 "任务 DAG" 按钮后，弹出可交互对话框。

文件改动清单：

A. src/client.js 完整实现（约 1200 行）：
   1. 常量与字典：PACKAGE_ID, NS='taskDag', MODES=['overview','team','workflow'], EMPTY_CHAT_NODES=Object.freeze([]), MESSAGE_DETAIL_LIMIT=100
   2. 中文 / 英文 i18n 字典（zh/en），覆盖所有 UI 文案
   3. 工具函数：
      - sameArray：浅比较
      - statusLabel(status, t)：用 normalizeStatus 后取 t(`status.${status}`)
      - truncate(value, length)：按码点截断 + 省略号
      - tokenCount(value)：Number(value || 0).toLocaleString()
      - isAgentNode(node)：type ∈ {one-shot, continuable, subagent, teammate, workflow-member}
      - reasoningLabel(metrics, t)：返回 "${effort} · ${source}" 或 t('metrics.effortMissing')
      - tooltipPosition(anchor, w, h)：相对窗口边界裁剪
   4. React 组件：
      - NodeMetricsTooltip：ReactDOM.createPortal 渲染到 body，展示 6 段：header (name+status)、description、route-grid (provider/model/reasoning + reasoningReference)、token-section (total/input/output/cacheRead/cacheWrite)、empty 占位、footer (随持久会话投影更新 + turns/steps)
      - DagMark / CommunicationMark / NodeGlyph：SVG 图标
      - GraphNode：<g transform="translate(x y)"> 包含 rect/card/accent/glyph/label/meta/status-dot；actionable → role=button tabIndex=0；onClick 路由到 onOpen/onInspectWorkflow；onPointerDown/Move/Up 处理节点拖拽；onFocus/onPointerEnter 触发 metrics；onBlur/onPointerLeave 隐藏 metrics
      - GraphEdge：structuralPath (贝塞尔) 或 communicationGeometry (二次贝塞尔 + curve 偏移)；通信边 role=button tabIndex=0 + Enter/Space 触发 selectCommunication
      - TaskGraph：<svg viewBox> 渲染 defs/marker + structural edges + communication edges + nodes
      - ViewTabs：3 个 tab 按钮 + 节点数徽标 + ArrowLeft/Right/Home/End 键盘导航
      - StatusLegend / EdgeLegend：根据 mode 显示不同状态/边类型
      - nonTextSummary：聚合 nonText 块的类型计数
      - CommunicationInspector：aside 抽屉，最多 MESSAGE_DETAIL_LIMIT=100 条消息，每条 time + delivery + delivered/queued + text(<=260) + nonText 统计
      - WorkflowDefinitionInspector：复用宿主平台 CodeBlock 展示 definition.script + meta.description + meta.whenToUse + meta.phases + 复制按钮；definition === null 时显示 "Definition unavailable" 空状态
      - EmptyState：Team 视图空时显示打开上级 Session 按钮（仅当 parentId ∈ ordinaryIds）
      - TaskDagDialog：dialog 容器（panelRef + viewportRef + drag/nodeDrag/canvasDrag refs + selectedCommunication/Workflow + hoveredMetrics state）；useMemo 计算 layout 和合并 positions；useEffect 监听 signature 清理失效的手工位置；useLayoutEffect 切 fit 时滚到 root；节点拖拽 → setNodePositions；画布拖拽 → viewport.scrollLeft/Top
      - TaskDagAction：顶层组件，useSession/useSessions/useConversation 订阅，useMemo 算 graphs 和 workflowNodes/teamNodes，useEffect 打开时 refreshCatalogs + setCatalogsOpen，useEffect Escape 关闭，渲染触发按钮 + 条件性 portal TaskDagDialog
   5. apply(ctx)：
      - ctx.effect 注册 createTeamSnapshotDefinition
      - ctx.effect 注入 <style data-plugin="my-task-dag"> 标签
      - ctx.effect 注册 locale { zh, en }
      - ctx.slots.inject('conversation.session.header.actions', ...) 注册 TaskDagAction（order=15, locale=NS）
      - inject: ['sessions', 'slots', 'locale', 'uiConversation']

B. src/style.css：实现所有 .task-dag-viewer-* 类的样式，使用宿主平台主题语义 token：
   - 颜色：--host-color-bg-canvas, --host-color-bg-elevated, --host-color-text-primary/secondary, --host-color-border-subtle, --host-color-accent
   - 状态色：--host-color-status-running, --host-color-status-completed, --host-color-status-failed, --host-color-status-blocked
   - 边 kind 颜色：dependency/team/assignment/workflow/phase/communication/delegation 各一个色
   - @media (prefers-reduced-motion: reduce) 时去掉 transition/animation

C. src/index.js：完善 taskDagAgentMetrics 投影：
   - METRICS_KEY = 'taskDagAgentMetrics'
   - stateSchema.parse()：必须为 null 或 { provider: non-empty string, model: non-empty string, reasoningSource: 'request-config' | 'adapter-default' | 'not-recorded' }；reasoningSource === 'not-recorded' 时 reasoningEffort 必须 absent，其它情况 reasoningEffort 必须 non-empty string
   - apply(state, event)：
     * event.type !== 'request/header' → return state
     * config = event.data.header.config
     * reasoningEffort = config.reasoningEffort
     * next = { provider: config.provider, model: config.model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }), reasoningSource: reasoningEffort === undefined ? 'not-recorded' : event.data.header.adapterDefaults?.reasoningEffort === true ? 'adapter-default' : 'request-config' }
     * state 完全相同时返回 state，否则返回 next
   - wire.view: state => state
   - stateVersion: 2

D. src/reasoning-defaults.js：
   - PUBLIC_REASONING_REFERENCES: Object.freeze([...])
     * openai/gpt-5.6-terra → medium, evidenceScope='openai-api-model-page', verifiedOn='2026-09-22'
     * openai-codex/gpt-5.6-terra → medium, evidenceScope='openai-api-model-page-reference-for-codex-route', verifiedOn='2026-09-22'
     * 都带 historicalClaim: false, sourceUrl
   - publicReasoningReference(provider, model) → 用 Map<provider\u0000model, entry> 查询，返回 entry 或 undefined

E. scripts/metrics-projection.test.mjs：
   - 模拟 ctx.inject(['sessionProjections'], ...) 拿到 sessionProjections.register 的候选
   - apply(init, header('openai', 'gpt-5.6', 'high')) → { provider, model, reasoningEffort: 'high', reasoningSource: 'request-config' }
   - apply(first, header('openai', 'gpt-5.6', 'high', { reasoningEffort: true })) → reasoningSource: 'adapter-default'
   - apply(first, header('acme', 'acme-v4', undefined)) → reasoningSource: 'not-recorded'，没有 reasoningEffort
   - apply(first, { type: 'assistant/message', data: {} }) → first（不响应其它事件）
   - 连续两次相同 event → 返回同一引用（去重）
   - stateSchema.parse 拒绝：空 provider/model、空字符串 source、not-recorded + reasoningEffort 共存、request-config 没有 reasoningEffort
   - stateSchema.parse 接受：忽略多余字段

F. scripts/smoke.mjs：用 jsdom + npm run build 加载 lib/client.js，验证：
   - apply 函数存在
   - inject 列表正确
   - 调 apply(ctx) 不抛错
   - ctx.slots.inject 至少被调一次
   - ctx.effect 注册了 ≥3 个 effect（styles / locale / conversation definition）

G. scripts/build.mjs：
   - 把 src/index.js 复制到 lib/index.js
   - 把 src/reasoning-defaults.js 复制到 lib/reasoning-defaults.js
   - 把 src/client.js + src/team-projection.js + src/workflow-definition.js + src/graph-model.js + src/style.css + src/reasoning-defaults.js 一起打包成 lib/client.js（用 esbuild 或手工 concat）
   - 把 src/index.js + src/reasoning-defaults.js 一起打包到 lib/invariant.js（可选）

H. package.json#scripts.check 改成：
   "check": "node --check src/*.js && node --test scripts/*.test.mjs && node scripts/build.mjs && node --check lib/*.js && node scripts/smoke.mjs"

约束：
- 不要新增第三方依赖（除了 react/react-dom/jsdom）
- 所有 React 组件用 createElement (h)，不要 JSX
- CSS 必须用宿主平台主题 token
- 所有键盘交互必须可达（tabIndex、role、aria-*）
- 关闭对话框后焦点还给 trigger 按钮
- Tooltip 用 portal 渲染到 body
- 通信边永远 layout: false 不参与布局
- 累计 Token 不臆造任何字段；reasoningEffort 未记录时不输出该字段；公开默认值仅作 reasoningReference 附加行显示

请返回 src/client.js, src/style.css, src/index.js, src/reasoning-defaults.js, scripts/metrics-projection.test.mjs, scripts/smoke.mjs, scripts/build.mjs, package.json 这 8 个文件的完整代码或修改。
```

---

## 通用提醒

> **不要试图一次性生成所有 Step 的代码**。每个 Step 都是独立可验证的——先跑通 Step 1 确认插件能加载，再进入 Step 2 验证数据流，以此类推。

> **每个 Step 的"必须不做的"清单比"必须做的"清单更重要**——诚实边界、可重现性、不臆造数据是这套设计的灵魂，破坏任何一条都会让插件失去意义。

> **如果你想跳过 Step 直接生成最终代码**，至少需要保留以下硬约束：

| 硬约束 | 原因 |
| --- | --- |
| `taskDagAgentMetrics` 投影 schema 强制三枚举 reasoningSource | 不强制就会被上游脏数据污染 |
| 通信边 `layout: false` | 否则反向通信成环会让布局崩 |
| `graphLayout` 必须确定性 | 否则用户每次刷新看到不同图 |
| 累计 Token 走 `tokenUsage`、最近请求走 `taskDagAgentMetrics`，不混用 | 混用就是伪造证据 |
| 公开模型默认值仅作参考行、不回写 `reasoningEffort` | 回写就是伪造历史证据 |
| `attachWorkflowDefinitions` 按 `callId + anchorSeq` 唯一标识 | 避免同名 call/run 错配 |
| Team 数据只读 Team Lead Session | 跨 Session 读会要求新增 Host RPC |
| 所有副作用走 `ctx.effect` / `ctx.slots.inject` | 否则卸载会泄漏 DOM |

> **复刻成功的唯一标准**——真实宿主平台 Web profile 加载插件、点击按钮、看到符合 [02-data-sources.md](02-data-sources.md) 描述的 6 个数据源在 DAG 上正确渲染、悬停 Agent 看到诚实分层的指标。
