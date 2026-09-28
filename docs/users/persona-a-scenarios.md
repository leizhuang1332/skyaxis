# skyaxis — 核心画像 A 的一天：5 个场景剧本

> 本文档基于 [personas.md](personas.md)，把核心画像 A「AI 重度多 session 用户」的具体一天工作流写成 5 个剧本。
> 每个剧本对应 1-N 个场景，作为验收维度的"真实剧本"验床。

**核心画像 A**：AI 重度多 session 用户

---

## 角色设定

| 维度 | 内容 |
| --- | --- |
| **化名** | 老王 |
| **职业** | 资深独立开发者，全栈方向 |
| **日常** | 维护 1-2 个长期个人项目；每周新增 1-2 个探索性 session；偶尔学习新技术 |
| **AI 用度** | 重度：每天同时开 3-5 个 session 是常态 |
| **工具栈** | macOS · VSCode · Terminal · DSH + skyaxis（计划中） |

---

## 剧本 1：早晨进入开发

**对应 MVP 场景**：**A**（单 session 内进度可视化）

**时间**：早上 9:00

**情境**：老王今天有三件事要做：

1. **session1**：给项目 X 加一个新功能（前端 React 组件）
2. **session2**：重构项目 X 的后端 API（清理 3 个月前的临时方案）
3. **session3**：写文档（项目 X 的 API 文档 + 用户手册）

老王先后开启这 3 个 session，每个 session 让 DSH 跑自己的 sub-agent 处理子任务。

**痛点**：3 个 session 同时在跑，需要快速看清"哪个 session 现在卡在哪里"——DSH 默认只有一个 active conversation 视图，要切换才能看，老王频繁切换被打断思路。

**skyaxis 行为**：老王打开 skyaxis 面板，看到 3 个 root session 节点并列，每个节点显示当前 task（如"写 Button 组件 / 第 3 步"）、进度条（"60% / 已运行 8 分钟"）、状态（`running`）。

**MVP 验证点**：场景 A 的"任务树 / 时间线 / 进度条至少一种"通过。

---

## 剧本 2：上午切 session 中断恢复

**对应 MVP 场景**：**A + C**（单 session 进度 + 多 session 总览）

**时间**：上午 10:30 - 11:30（会议中断 1 小时）

**情境**：老王正在盯 session1 的 React 组件开发，突然被拉去开会。回来时，3 个 session 都在跑不同的 sub-agent，老王需要快速回到 session1 看进度，但要先确认其他 session 没出大问题。

**痛点**：

- 切到 session1 看进度 → 切到 session2 看进度 → 切到 session3 看进度，每次切换都打断思路
- 不切的话，看不到任何一个 session 的实时进度

**skyaxis 行为**：

- skyaxis **多 session 总览面板**（场景 C）显示 3 个 session 的状态卡片
- 每个卡片显示当前 task 摘要 + 进度 + sub-agent 数量
- 老王点击 session1 → 展开单 session 详情（场景 A 深度）→ 看到 React 组件的 task DAG：Button 组件已完成 → Input 组件正在跑 → Form 组件待开始

**MVP 验证点**：场景 C（多 session 总览）+ 场景 A 的 session 视图层联动通过。

---

## 剧本 3：中午决策回溯

**对应 MVP 场景**：**D**（session 决策 / 代码片段归档）

**时间**：中午 12:30

**情境**：session1 在跑 React 组件时，前端和后端通信方式需要决策——用 REST 还是 GraphQL？老王让 session1 跑出来对比，发现项目 X 数据模型嵌套深，REST 不够灵活，决策改为 GraphQL。

**痛点**：这条决策很重要（影响整个项目的数据层设计），但散落在 trajectory 的某个 turn 里，过后找不到。老王担心 3 个月后回头看代码会忘了为什么选 GraphQL。

**skyaxis 行为**：

- 老王在 session1 的 trajectory 里手动标记这条决策为 Decision（标签：`架构 / GraphQL / 数据层`）
- 写下简短理由："数据模型嵌套深，REST 字段冗余太多；GraphQL 按需取字段更合适"
- 几天后，老王想确认"为什么项目 X 用 GraphQL" → 在 skyaxis 搜索标签"GraphQL" → 找到这条 Decision + 当时的 trajectory 上下文

**MVP 验证点**：场景 D 的"主动标记 + 跨 session 全文搜索"通过。

---

## 剧本 4：下午依赖冲突

**对应 MVP 场景**：**D1 + D2**（task DAG + session 间依赖 + subagent 拓扑）

**时间**：下午 14:30

**情境**：session2 在重构后端 API 时，把某个端点的请求 / 响应 schema 改了。但 session1 的某个 sub-agent（在前端写 fetch 调用）还在用旧 schema，导致 session1 的那个 sub-agent 报错。

**痛点**：session1 的 sub-agent 报错，老王看不到为什么——因为 session2 是独立的 session，老王记不清"session2 改了什么"。

**skyaxis 行为**：

1. skyaxis 显示 session1 的 sub-agent tree，某个 child 节点状态是 `error`
2. 老王点击该节点 → 看到 trajectory 里 `tool/call` 失败的上下文
3. skyaxis 提示："该 sub-agent 的输入可能在 session2 中被修改（基于 SessionDependency 推断）"
4. 老王切到 skyaxis session 间依赖图（场景 D2）→ 看到 session1 → session2 的"实线"依赖（subagent 父子关系）→ 切到 session2 看那次 schema 修改的 Decision
5. 老王回到 session1，告诉 DSH "session2 已升级 v2 schema，请重新 fetch" → session1 的 sub-agent 自动 retry

**MVP 验证点**：场景 D1（task DAG）+ 场景 D2（session 间依赖）+ ADR 0009（subagent 拓扑可视化）三者联动通过。

---

## 剧本 5：晚上归档

**对应 MVP 场景**：**B + D**（跨 session 产出聚合 + 归档检索）

**时间**：晚上 18:00

**情境**：老王一天结束，要回顾今天做了什么：3 个 session 加起来有几十次 tool call、5 条关键 Decision、20 个 Snippet、几百行代码片段。

**痛点**：这些东西全散在 3 个 session 的 trajectory 里，老王手动汇总要 1 小时；而且容易遗漏。

**skyaxis 行为**：

- skyaxis **跨 session 产出聚合**（场景 B）：把 3 个 session 的所有 Decision / Snippet 聚合到"今日产出"面板
- 老王看到：
  - 5 条 Decision：架构选型 / 库升级 / 性能优化 / ...
  - 20 个 Snippet：Button 组件 / API schema 迁移脚本 / ...
- 老王按"标签"过滤：只看"数据层"标签 → 找到 2 条 Decision + 5 个 Snippet
- 老王把今天产出的 Decision / Snippet 一键导出为 markdown（**可选**，非 MVP 必交付）

**MVP 验证点**：场景 B（跨 session 产出聚合）+ 场景 D（归档检索）的全文搜索 + 标签过滤通过。

---

## 剧本映射总览

| # | 剧本 | 对应 MVP 场景 | 核心痛点 | skyaxis MVP 关键能力 |
| --- | --- | --- | --- | --- |
| 1 | 早晨进入开发 | A | 同时 3 个 session 看不清每个的进度 | 单 session 进度可视化 |
| 2 | 上午中断恢复 | A + C | 切 session 看进度打断思路 | 多 session 总览联动 |
| 3 | 中午决策回溯 | D | 决策散落 trajectory 过后找不到 | 主动标记 + 全文搜索 |
| 4 | 下午依赖冲突 | D1 + D2 + ADR 0009 | sub-agent 报错看不到根因 | subagent 拓扑 + session 间依赖 |
| 5 | 晚上归档 | B + D | 跨 session 汇总产出费时 | 跨 session 聚合 + 标签过滤 |

---

## 剧本未覆盖的 MVP 场景

| 场景 | 原因 | 何时再评估 |
| --- | --- | --- |
| **A 场景的 subagent 拓扑**（作为场景 A 纵深补强） | 剧本 4 已部分覆盖；完整 subagent 拓扑验证留 v0.1 demo | v0.1 demo 跑通 + ADR 0009 假设 1-3 验证 |
| **C 场景的多 session 总览深度**（关联 SessionDependency 视图） | 剧本 5 仅覆盖基础聚合，深度视图留 v0.2 demo | v0.2 demo |
| **D 场景的语义检索** | 已 Non-Goal | MVP 后评估 |

---

## skyaxis 一句话总结

> 核心画像 A 的 **5 个剧本** 覆盖 MVP **A / B / C / D / D1 / D2** 全部 6 场景 + 1 个扩展场景，作为 MVP 验收维度的真实剧本验床。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。核心画像 A 的 5 个场景剧本（早晨 / 上午 / 中午 / 下午 / 晚上），对应 MVP 6 场景 + 1 个扩展场景。 |

---

## 相关文档

- [users/personas.md](personas.md)