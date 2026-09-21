# skyaxis — MVP 功能点拆解（权威出处）

> 本文档把 MVP 6 场景 + ADR 0009 扩展拆成"功能点列表"。每个功能点一句话定义。
> **不细化字段、不定接口、不写代码**（遵循 CLAUDE.md 第 2.1 节边界）。本文档是 MVP 范围的"骨架级"拆解，不替代需求细化阶段的设计文档。

**锁定来源**：

- [ADR 0003 — MVP 场景清单](decisions/0003-MVP场景清单.md)（2026-09-19 接受）
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)（2026-09-19 接受，带 8 条假设清单待 v0.1 实施期验证）

---

## 场景 A：单 session 内进度可视化

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **A.1** | Session 元数据视图 | Session 列表 / Session 卡片，展示 status / 标签 / 创建时间 | ADR 0006 Session |
| **A.2** | Task 自动抽取 | 从 trajectory 抽取 Task 步骤 | ADR 0006 Task |
| **A.3** | 单 session 进度可视化 | 任务树 / 时间线 / 进度条至少一种展示形式 | ADR 0003 场景 A |
| **A.4** | Session 详情面板 | 点击 session 卡片展开详情 | ADR 0003 场景 A |
| **A.5** | **Subagent Tree 自动展开**（场景 A 纵深补强） | 当 Session 是 subagent root 时，自动展开 subagent 树 | ADR 0009 9.1 |

## 场景 B：跨 session 产出聚合

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **B.1** | 跨 session Decision 聚合 | 把多 session 的 Decision 聚合到一个面板 | ADR 0006 Decision |
| **B.2** | 跨 session Snippet 聚合 | 把多 session 的 Snippet 聚合到一个面板 | ADR 0006 Snippet |
| **B.3** | 跨 session 时间线视图 | 把多 session 的关键事件按时间合并 | ADR 0003 场景 B |
| **B.4** | 跨 session 导出（可选） | 导出 markdown / JSON 等格式 | ADR 0003 场景 B（可选） |

## 场景 C：多 session 总览

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **C.1** | Session 列表 | 列出当前用户的所有 session | ADR 0003 场景 C |
| **C.2** | Session 状态卡片 | 每 session 显示状态 / 当前 task / 进度 / sub-agent 数 | ADR 0003 场景 C |
| **C.3** | Session 过滤 | 按标签 / 状态 / 时间过滤 | ADR 0003 场景 C |
| **C.4** | Session 搜索 | 按名字 / 标签搜索 | ADR 0003 场景 C |

## 场景 D：session 决策 / 代码片段归档

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **D.1** | Decision 主动标记 | 用户在 trajectory 中标记某 turn 为 Decision | ADR 0006 Decision |
| **D.2** | Snippet 主动标记 | 用户在 trajectory 中标记某段代码为 Snippet | ADR 0006 Snippet |
| **D.3** | 标签系统 | Decision / Snippet 可加标签（用于检索） | ADR 0006 |
| **D.4** | 全文搜索 | 跨 session 搜索 Decision / Snippet 内容 | ADR 0003 场景 D |
| **D.5** | 标签过滤 | 按标签过滤 Decision / Snippet | ADR 0003 场景 D |

## 场景 D1：session 内 task DAG

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **D1.1** | Task 依赖推断 | 从 tool/call 顺序推断 Task 依赖 | ADR 0006 TaskDependency |
| **D1.2** | Task DAG 可视化 | 图形化展示 DAG（节点 + 边） | ADR 0003 场景 D1 |
| **D1.3** | Task 节点 hover | 鼠标悬停显示 Task 详情 | ADR 0003 场景 D1 |
| **D1.4** | **Subagent Tree × Task DAG 双视图联动**（场景 D1 纵深补强） | 同一 session 内两种视图联动 | ADR 0009 9.1 |

## 场景 D2：session 间依赖

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **D2.1** | SessionDependency 自动推断 | 从 trajectory 推断 session 间依赖 | ADR 0006 SessionDependency |
| **D2.2** | Session 依赖图可视化 | session 间依赖图（节点 + 边） | ADR 0003 场景 D2 |
| **D2.3** | 手动声明 Session 依赖 | 用户可在 UI 手动声明契约（"虚线"） | ADR 0006 SessionDependency |
| **D2.4** | **Subagent 父子关系"实线"展示**（场景 D2 纵深补强） | 自动推断的 subagent 父子关系区别于手动契约 | ADR 0009 9.1 |

## Subagent 拓扑（ADR 0009 拆解）

> 这些功能点是 [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 的纵深补强，作为独立子节列出。

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **SUB.1** | 拓扑视图 | 多 root 并列画布，每 root 一棵树 | ADR 0009 9.2 |
| **SUB.2** | 节点状态机 | `running / settled`（合并 DSH `idle + ready`） | ADR 0009 9.2 |
| **SUB.3** | 节点 metadata | mode / label / hasChildren / activity / 活跃 duration | ADR 0009 9.2 |
| **SUB.4** | Catalog refresh + retry | `loading / ready / error` 三态 + 防抖 | ADR 0009 9.2 |
| **SUB.5** | Read-only session event 时间线 | 基于 trajectory merger 的"按 .time 合并"只读视图 | ADR 0009 9.4 |
| **SUB.6** | 独立 panel 架构 | 不嵌入 conversation header，独立 store + navigation | ADR 0009 9.2 |

## 非功能 / 横切关注点

| 编号 | 功能点 | 一句话定义 | 关联 ADR |
| --- | --- | --- | --- |
| **NF.1** | 集成形态 | MVP 优先形态 B（外部 patch overlay），形态 A 为长期目标 | ADR 0009 9.6 |
| **NF.2** | observe-only 集成 | skyaxis 只读访问 DSH；禁止写 prompt / interrupt / tool | ADR 0009 9.7 |
| **NF.3** | 5 分钟跑起来 | git clone 到看到可视化界面 < 5 分钟；DSH 插件加载无需手工改配置 | ADR 0008 |
| **NF.4** | DSH 版本钉钉 | 钉钉 v0.1.5-rc.2（commit `fb2c4b9`），不跟随 DSH 演化自动升级 | CLAUDE.md 工程硬性约束 |
| **NF.5** | 纯本地 + 单端 | 运行环境 = 纯本地 + 单端；无云同步 | ADR 0005 |
| **NF.6** | MIT 开源免费 | 分发 = MIT 开源免费 | ADR 0005 |

---

## 功能点映射总览

| 场景 | 功能点数 | 必交付 | 纵深补强（ADR 0009） |
| --- | --- | --- | --- |
| **A** 单 session 内进度可视化 | 4 + 1 | A.1-A.4 | A.5 |
| **B** 跨 session 产出聚合 | 3 + 1 可选 | B.1-B.3 | — |
| **C** 多 session 总览 | 4 | C.1-C.4 | — |
| **D** session 决策 / 代码片段归档 | 5 | D.1-D.5 | — |
| **D1** session 内 task DAG | 3 + 1 | D1.1-D1.3 | D1.4 |
| **D2** session 间依赖 | 3 + 1 | D2.1-D2.3 | D2.4 |
| **SUB** Subagent 拓扑 | 6 | SUB.1-SUB.6（场景 A/D1/D2 补强） | — |
| **NF** 非功能 / 横切 | 6 | NF.1-NF.6 | — |
| **总计** | **35 + 1 可选 + 4 纵深补强** | | |

---

## 与 3 个子阶段的映射

| 子阶段 | 必交付功能点 | 纵深补强 |
| --- | --- | --- |
| **v0.1** 核心可视化 | A.1-A.4 · B.1-B.3 基础 · C.1-C.2 · NF.1-NF.6 | SUB.1-SUB.4 · A.5（场景 A 补强） |
| **v0.2** 依赖关系 | D1.1-D1.3 · D2.1-D2.3 · B.1-B.3 增强 · C.3 | SUB.5 · SUB.6 · D1.4 · D2.4（场景 D1/D2 补强） |
| **v0.3** 归档检索 | D.1-D.5 · B.1-B.3 完整 · C.4 · B.4 可选 | — |

---

## skyaxis 一句话总结

> MVP 功能点拆解共 **35 + 1 可选 + 4 纵深补强 = 40 个功能点**，分布在 A / B / C / D / D1 / D2 / SUB / NF 八个分组，**不细化字段、不定接口、不写代码**。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 ADR 0003 + ADR 0009，把 MVP 6 场景 + ADR 0009 扩展拆成 40 个功能点（35 + 1 可选 + 4 纵深补强）。 |

---

## 相关 ADR / 文档

- [ADR 0003 — MVP 场景清单](decisions/0003-MVP场景清单.md)
- [ADR 0005 — MVP 边界与 Non-Goals](decisions/0005-MVP边界与Non-Goals.md)
- [ADR 0006 — 业务对象清单](decisions/0006-业务对象清单.md)
- [ADR 0007 — 长期规划与里程碑](decisions/0007-长期规划与里程碑.md)
- [ADR 0008 — 每阶段验收标准](decisions/0008-每阶段验收标准.md)
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [docs/scope/mvp-boundary.md](mvp-boundary.md)
- [docs/users/persona-a-scenarios.md](../users/persona-a-scenarios.md)
- [docs/domain/glossary.md](../domain/glossary.md)