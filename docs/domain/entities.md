# skyaxis — 业务对象清单（权威出处）

> 本文档定义 skyaxis 第一版要管理的核心业务对象。每个对象给出"**名称 + 一句话定义 + 与同类工具的对象差异**"。
> **不细化字段、不定类型、不设计存储**（遵循 CLAUDE.md 第 2.1 节边界）。

**锁定来源**：[ADR 0006 — 业务对象清单：skyaxis 第一版要管理的 6 个核心对象](0006-业务对象清单.md)（2026-09-19 接受）。

---

## 6 个核心对象

### 1. Session（视图层）

| 维度 | 内容 |
| --- | --- |
| **名称** | Session |
| **一句话定义** | AI 会话本体，由 DSH 提供，skyaxis 在其上加自己的视图与元数据。**当 Session 作为 subagent root 时，其视图骨架同时承载 subagent tree 与 subagent 节点状态**（[ADR 0009](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）。 |
| **MVP 场景归属** | 所有场景的载体（A / B / C / D / D1 / D2），以及 subagent 拓扑可视化的 root 节点 |
| **与同类工具的对象差异** | DSH 内置 Session 是 runtime 实体；skyaxis 的 Session 视图是"信息流管理层"——把 Session 的进度、状态、关联关系从 trajectory 里"长出来"。**当 Session 是 subagent root 时，skyaxis 同时把它的 descendant sessions 的拓扑、状态、metadata 从 `listDescendants` 与 trajectory merger 里"长出来"**（observe-only 集成）。 |

### 2. Task（任务步骤）

| 维度 | 内容 |
| --- | --- |
| **名称** | Task |
| **一句话定义** | 从 session trajectory 中抽取的任务步骤，构成 session 内的进度单元。 |
| **MVP 场景归属** | A + D1 |
| **与同类工具的对象差异** | vs Linear / Notion 的 Task：Linear Task 是"用户手动管理的待办"，skyaxis Task 是"从 AI trajectory 自动抽取的执行步骤"。 |

### 3. TaskDependency（任务依赖边）

| 维度 | 内容 |
| --- | --- |
| **名称** | TaskDependency |
| **一句话定义** | Task 之间的依赖边，构成 session 内的 task DAG。 |
| **MVP 场景归属** | D1 |
| **与同类工具的对象差异** | vs 通用 DAG 库（Terraform、Airflow）：skyaxis TaskDependency 是"从 trajectory 自动推断"，不要求用户手动声明。 |

### 4. SessionDependency（session 间依赖边）

| 维度 | 内容 |
| --- | --- |
| **名称** | SessionDependency |
| **一句话定义** | Session 之间的输入 / 输出契约，构成 session 间的依赖图。 |
| **MVP 场景归属** | D2 |
| **与同类工具的对象差异** | vs DSH trajectory 隐式依赖：skyaxis SessionDependency 是显式声明的、可视化的。 |

### 5. Decision（决策）

| 维度 | 内容 |
| --- | --- |
| **名称** | Decision |
| **一句话定义** | Session 内的关键决策记录，可被检索与回溯。 |
| **MVP 场景归属** | D |
| **与同类工具的对象差异** | vs Git commit message / ADR 文档：skyaxis Decision 是"在 session 过程中被标记的"，与 session trajectory 强绑定。 |

### 6. Snippet（代码片段）

| 维度 | 内容 |
| --- | --- |
| **名称** | Snippet |
| **一句话定义** | Session 内的代码片段，可被检索与回溯。 |
| **MVP 场景归属** | D |
| **与同类工具的对象差异** | vs GitHub Gist / 独立 snippet 工具：skyaxis Snippet 与 Session / Task 强绑定，可被回溯到"哪段 trajectory 产生的"。 |

---

## 对象群视角

6 个对象可按"对象群"组织：

| 对象群 | 对象 | 角色 |
| --- | --- | --- |
| **Session 视图** | Session | 所有场景的载体 |
| **Task 体系** | Task + TaskDependency | session 内的进度结构（D1） |
| **Session 依赖** | SessionDependency | session 间的依赖图（D2） |
| **归档体系** | Decision + Snippet | session 内的归档对象（D） |

---

## skyaxis 一句话总结

> skyaxis 第一版要管理 **6 个核心对象**：**Session**（DSH 会话视图）、**Task**（session 内的进度步骤）、**TaskDependency**（任务 DAG 边）、**SessionDependency**（session 间依赖边）、**Decision**（session 内决策）、**Snippet**（session 内代码片段）。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 ADR 0001 / 0002 / 0003 / 0004 / 0005 与本轮决策起草，6 个核心对象。 |

---

## 相关 ADR

- [ADR 0001 — 形态：DSH 独立插件](0001-形态-dsh插件.md)
- [ADR 0002 — 定位：可视化向](0002-定位-可视化向.md)
- [ADR 0003 — MVP 场景清单](0003-MVP场景清单.md)
- [ADR 0004 — 目标用户画像](0004-目标用户画像.md)
- [ADR 0005 — MVP 边界与 Non-Goals](0005-MVP边界与Non-Goals.md)
- [ADR 0006 — 业务对象清单](0006-业务对象清单.md)（本 ADR 锁定来源）
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)