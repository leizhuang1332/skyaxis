# skyaxis — 长期规划与里程碑（权威出处）

> 本文档定义 skyaxis 从立项到 MVP + 后续迭代的阶段划分。每个阶段给出**目标、能力范围、依赖前置、通过条件**。**不排期、不估时、不绑死时间**（遵循 CLAUDE.md 第 2.1 节边界）。

**锁定来源**：[ADR 0007 — 长期规划与里程碑：从立项到 MVP 的阶段划分](0007-长期规划与里程碑.md)（2026-09-19 接受）。

---

## 总体阶段划分

| 阶段 | 名称 | 状态 |
| --- | --- | --- |
| **阶段 1** | 立项验证 | ✅ 已完成（ADR 0001-0006） |
| **阶段 2** | MVP 实现 | ⏳ 待启动（分为 v0.1 / v0.2 / v0.3 三个子阶段） |
| **阶段 3** | MVP 后迭代 | 📋 占位（待 MVP 完成时启动新 ADR 锁定具体内容） |

阶段切换的门详见 [docs/milestones/acceptance.md](acceptance.md)（待建立）。

---

## 阶段 1：立项验证（已完成）

| 维度 | 内容 |
| --- | --- |
| **目标** | 把"做什么 / 不做什么 / 为谁做"说清楚，形成立项阶段产出物。 |
| **已完成内容** | 6 个 ADR + 5 个权威文档： |
| | - 形态：[ADR 0001](0001-形态-dsh插件.md) · [vision/positioning.md](../vision/positioning.md) |
| | - 定位：[ADR 0002](0002-定位-可视化向.md) |
| | - 场景：[ADR 0003](0003-MVP场景清单.md) |
| | - 画像：[ADR 0004](0004-目标用户画像.md) · [users/personas.md](../users/personas.md) |
| | - 边界：[ADR 0005](0005-MVP边界与Non-Goals.md) · [scope/mvp-boundary.md](../scope/mvp-boundary.md) |
| | - 对象：[ADR 0006](0006-业务对象清单.md) · [domain/entities.md](../domain/entities.md) |
| **通过条件** | ✅ 满足（ADR 0007 落地即视为进入阶段 2 准备阶段）。 |

---

## 阶段 2：MVP 实现

MVP 内部按"对象群"分 3 个子阶段（详见 [ADR 0007](0007-长期规划与里程碑.md)）。

### v0.1：核心可视化（Session + Task）

| 维度 | 内容 |
| --- | --- |
| **目标** | 交付"单 session 内的进度可视化"核心能力。 |
| **能力范围 — 场景** | **A**（单 session 内进度可视化）必交付；**B**（跨 session 产出聚合）+ **C**（多 session 总览）**基础部分**（Session 视图层）。 |
| **能力范围 — 对象** | Session（元数据视图）+ Task（任务步骤）。 |
| **能力范围 — subagent 拓扑可视化**（场景 A 纵深补强，[ADR 0009](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)） | 当 Session 作为 subagent root 时，自动展开 subagent tree；拓扑视图 / 节点状态机（`running / settled`）/ Catalog refresh + retry 可用；独立 panel 架构（不嵌入 conversation header）。 |
| **依赖前置** | DSH 插件 demo 跑通，验证 trajectory 事件流可达；**subagent 拓扑可视化假设 1-3 验证通过**：`dsh --profile web --patch <外部-overlay.yml>` 能加载独立仓 plugin；`listDescendants` / `SessionSummary.running` / `subagentTiming` projection 可用。 |
| **通过条件** |  |
| | - [ ] Session 视图层可用（status / 标签 / 关联）。 |
| | - [ ] Task 从 trajectory 自动抽取可用。 |
| | - [ ] 单 session 内的进度可视化（任务树 / 时间线 / 进度条）至少一种可用。 |
| | - [ ] subagent 拓扑可视化（场景 A 纵深补强）：subagent tree 自动展开 + 节点状态机 + Catalog refresh 可用。 |
| | - [ ] 关键决策有 ADR。 |

### v0.2：依赖关系（TaskDependency + SessionDependency）

| 维度 | 内容 |
| --- | --- |
| **目标** | 交付"session 内 task DAG + session 间依赖"两个增强能力。 |
| **能力范围 — 场景** | **D1**（session 内 task DAG）+ **D2**（session 间输入 / 输出依赖）必交付；**B + C** 增强部分（依赖 SessionDependency 的多 session 视图）。 |
| **能力范围 — 对象** | TaskDependency + SessionDependency。 |
| **能力范围 — subagent 拓扑可视化**（场景 D1 / D2 纵深补强，[ADR 0009](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)） | subagent tree 与 task DAG 是同一 session 内双视图联动；subagent 父子关系作为 SessionDependency 的**优先实例**以"实线"展示（区别于用户手动声明的 session 间契约"虚线"）；read-only trajectory merger 时间线接入（基于 `.time` 合并）。 |
| **依赖前置** | v0.1 全部场景可用；**假设验证**：DSH 原生支持 task DAG 事件（D1）；DSH 原生支持 session 间通信（D2）；**subagent 拓扑可视化假设 4-7 验证通过**：`SessionQueryEngine.observeSession` 默认可用；`turn/start` / `turn/end` / `subagent/descriptor` 的 `.time` 字段可排序；cold observation 返回完整 events；`ctx.agents.get(id)` 在未选中时也能返回。 |
| **通过条件** |  |
| | - [ ] Task DAG 可视化可用。 |
| | - [ ] Session 间依赖图可视化可用。 |
| | - [ ] subagent 拓扑可视化（场景 D1 / D2 纵深补强）：subagent tree × task DAG 双视图联动 + trajectory merger 可用。 |
| | - [ ] 关键决策有 ADR。 |

### v0.3：归档检索（Decision + Snippet）

| 维度 | 内容 |
| --- | --- |
| **目标** | 交付"session 内决策 / 代码片段的归档检索"能力。 |
| **能力范围 — 场景** | **D**（session 决策 / 代码片段归档与检索）必交付；**B + C** 进一步增强（以 Decision / Snippet 为锚点）。 |
| **能力范围 — 对象** | Decision + Snippet。 |
| **范围限定** | 仅"只读归档 + 全文搜索"，**不含**语义级智能检索（已 Non-Goal，[ADR 0005](0005-MVP边界与Non-Goals.md)）。 |
| **依赖前置** | v0.2 全部场景可用；DSH trajectory 暴露决策 / 代码片段标记能力（待验证）。 |
| **通过条件** |  |
| | - [ ] 用户可在 session 内主动标记 Decision / Snippet。 |
| | - [ ] 跨 session 的 Decision / Snippet 全文搜索可用。 |
| | - [ ] **MVP 完整 6 个场景全部可用**。 |
| | - [ ] 关键决策有 ADR。 |

---

## 阶段 3：MVP 后迭代（占位）

| 维度 | 内容 |
| --- | --- |
| **目标** | 根据 MVP 验证结果决定下一阶段方向。 |
| **能力范围** | 占位。**不在本 ADR 锁定具体内容**，避免立项阶段过度承诺。 |
| **候选方向**（仅作参考，不锁定） | 反例 3（B 画像）适配 · 云同步 / 多端 · 商业模式探索（开源 + 增值服务）· 学习者画像适配 · D3 / D4 重新评估。 |
| **依赖前置** | v0.3 完成后，启动阶段 3 时需**新开 ADR** 锁定具体内容。 |

---

## skyaxis 一句话总结

> skyaxis 的长期规划分 **3 个大阶段**：阶段 1（立项验证 ✅ 已完成）· 阶段 2（MVP 实现分 v0.1 / v0.2 / v0.3 三个子阶段 ⏳ 待启动）· 阶段 3（MVP 后迭代 📋 占位）。MVP 完成后，新开 ADR 锁定阶段 3 具体内容。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 ADR 0001 ~ 0006 与本轮决策起草，3 个大阶段（阶段 1 已完成 / 阶段 2 分 3 子阶段 / 阶段 3 占位）。 |

---

## 相关 ADR

- [ADR 0001 — 形态：DSH 独立插件](0001-形态-dsh插件.md)
- [ADR 0002 — 定位：可视化向](0002-定位-可视化向.md)
- [ADR 0003 — MVP 场景清单](0003-MVP场景清单.md)
- [ADR 0004 — 目标用户画像](0004-目标用户画像.md)
- [ADR 0005 — MVP 边界与 Non-Goals](0005-MVP边界与Non-Goals.md)
- [ADR 0006 — 业务对象清单](0006-业务对象清单.md)
- [ADR 0007 — 长期规划与里程碑](0007-长期规划与里程碑.md)（本 ADR 锁定来源）
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)