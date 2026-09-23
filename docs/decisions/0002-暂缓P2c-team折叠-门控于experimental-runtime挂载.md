# ADR 0002 — 暂缓 P2c（Team 折叠）：门控于 experimental runtime 挂载

- **状态**：接受（2026-09-23）
- **决策者**：skyaxis 团队（lorcan.lei + Claude）
- **关联**：[research/0003 §四](../research/0003-任务图升级数据源验证.md)（team 数据源验证）、[research/0003 §七](../research/0003-任务图升级数据源验证.md)（路线图）、参考拆解 [dist/03 §5](../dist/03-data-processing.md) / [dist/05](../dist/05-cycle-fallback.md)

---

## 一、背景

升级路线图的 P2c 是把参考插件 task-dag-viewer 的 Team 视图（`addTeamGraph`：teammate 节点 + 共享任务 DAG + 通信覆盖层）移植到 skyaxis。[research/0003 §四](../research/0003-任务图升级数据源验证.md) 的复审验证了三件事：

1. **词汇与线协议是官方的**：`team/member | team/task | team/message/queued | team/message/delivered` 在 `KNOWN_SESSION_EVENT_TYPES`（56 项持久化目录）内，持久化层完整解释（非 ignorable 外部事件）；typert 线协议表给出外层形状 `{ version: 2; teamId: TeamId; member: TeamMemberSnapshot }` 等。
2. **runtime 真实存在于 npm**：`@deepseek-ai/dsh-experimental-agent-team`（"Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG"），2026-09-09 首发、活跃维护、peerDeps 与本仓库版本兼容。
3. **三处都不带它**：核心包不捆绑 runtime；**standard preset 的 `agent.cordis.yml` 不挂载**；本仓库未安装。

第 3 条意味着：**在当前部署里没有任何进程会发射 team 事件**。

## 二、决策

**P2c 暂缓，维持门控；路线图先行 P2d（Workflow 视图）。**

门控条件（唯一）：**目标部署的 profile 挂载 `@deepseek-ai/dsh-experimental-agent-team`**，team 事件开始真实流动。门控解除后 P2c 升到队列最前。

## 三、理由

| 理由 | 说明 |
| --- | --- |
| **真实环境验证是本会话最有效的质量闸门** | P2a 的 Handle 缺边、双标签页订阅放大、P2b 的三态来源行——全部由手动验证抓住或确认，单测零报告。P2c 在无 runtime 的部署里只能对着合成夹具测试，等于主动放弃这道闸门 |
| **对照 P2d 的可验证性** | `tool-workflow` runtime 默认挂载于 standard preset，今天就能端到端验证；同等工程量下先做能验证的 |
| **experimental 包的风险标注** | 包名自带 experimental；0.1.5-rc.2 → 0.1.7-alpha.1 的快速版本滚动说明形状仍可能变，早移植的返工成本高 |
| **诚实原则同样适用于规划** | 没有验证到数据源流动的功能不排期（0003 §四 初版教训的反面应用） |

## 四、回头处理 P2c 时的恢复清单（防丢信息）

### 4.1 门控解除动作

1. 在部署 profile 安装并挂载 `@deepseek-ai/dsh-experimental-agent-team`（版本取当时最新稳定档）；
2. 本仓库将其加入 devDependencies（仅为类型与单测夹具对齐）；
3. 用真实 session 确认事件流出现后再动折叠代码。

### 4.2 开工前必须补的验证（当前未知项）

- **内层快照形状**：`TeamMemberSnapshot` / `TeamTaskSnapshot` / `TeamMessageSnapshot` 的字段——typert 表里只提取过外层 envelope，内层未验证（从 `typert.host.js` 的声明数组提取，方法同 0003 §四）；
- **version 语义**：DSH 事件是 `version: 2`，参考插件折叠器只认 `version === 1`（"上游升 v2 自动忽略"）——**折叠规则必须按 v2 重写，不能照抄 dist**；
- **runtime 实际发射形状与 typert 表的一致性**（experimental 包可能领先/落后于线协议表）。

### 4.3 从 dist 移植时的设计要点（已验证部分，直接可用）

- `foldTeam` 四集合折叠：members 同 ID 取 seq 最大 / tasks 同 ID 取 revision 最大（同 revision 取 seq）/ messages 全量保留 / delivered 为 Set（dist/03 §2）；
- **归属过滤**：`teamId !== rootId` 整块跳过——Team 任务板只存在于 Team Lead Session（dist/01 原则 2）；
- **`dependency` 边是全图唯一真实 DAG 依赖边**（来自 task.blockedBy）；`team` / `assignment` 只是归属关系；
- **通信边永远 `layout: false`**（双向成环绝不进拓扑排序）+ 反向成对 `curve` 互反（±1）防 SVG 路径重叠（dist/03 §4.4）；
- `ensureAgent` 兜底：通信对端不在 members 里时补建节点；
- **环防御前置**：`dependency` 是非结构边（不像 delegation 由 lineageDepths 拒环），P2c 必须**同时**引入 dist/05 的残量分量 fallback（迭代版 Kosaraju + 分量压平），否则脏数据环会让布局抛错或漂移。

### 4.4 已就绪的基础设施（P0-P2b 产物，P2c 直接复用）

- 边 `kind` 体系（types.ts，加 `'team' | 'assignment' | 'dependency' | 'communication'` 即可）；
- 节点命名空间惯例（`team-task:` 前缀可直接采用）；
- connector 的懒启动订阅模式（0003 §六 教训）——team 事件走现有事件窗口，**零新增订阅**；
- error boundary + apply 兜底（异常降级不波及宿主）。

## 五、影响

- 路线图顺序：P2d → P3 → （门控解除时）P2c；
- 不改任何代码；本 ADR 是唯一产物（+ 0003 §七 指针）。

## 六、修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-23 | 初版。决策：暂缓 P2c、门控于 experimental runtime 挂载、先行 P2d；附恢复清单。 |
