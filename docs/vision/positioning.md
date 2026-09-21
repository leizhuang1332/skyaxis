# skyaxis — 定位（权威出处）

> 本文档是 skyaxis 项目"一句话定位"的权威定义文档。任何对定位的修订，必须先开 ADR，再回写本文档。

---

## 一句话定位

> **skyaxis 是 deepseek-harness 的 AI 编程可视化插件，把 session 内的进度和跨 session 的产出变成可被一眼看清、可被回溯的对象。**

**锁定来源**：[ADR 0002 — 定位决策：skyaxis 的一句话定位（可视化向）](0002-定位-可视化向.md)（2026-09-19 接受）。

---

## 形态约束

> skyaxis 以 deepseek-harness（DSH）的独立插件形态存在，而非独立产品。

**锁定来源**：[ADR 0001 — 形态决策：skyaxis 作为 deepseek-harness 的独立插件](0001-形态-dsh插件.md)（2026-09-19 接受）。

---

## 拆解

| 维度 | 内容 |
| --- | --- |
| **是什么** | deepseek-harness 生态的 AI 编程可视化插件 |
| **给谁用** | 个人开发者 / 一线开发工程师（详见 `docs/users/` —— 待建立） |
| **和现有工具差异** | 把 session 内的进度 + 跨 session 的产出"长出来"，而非困在聊天框里 |

---

## 隐含的产品方向

- **核心能力**：
  - **session 内的进度可视化**：单一 session 内的过程清晰化（如任务树、时间线、进度条等）。
  - **跨 session 的产出可视化**：多 session 之间的产出聚合与回溯。
  - **subagent 拓扑可视化**（场景 A / D1 / D2 的**纵深补强**，[ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）：主 + 子 agent 拓扑画布 · 节点状态机（`running / settled`）· 节点 metadata · read-only event 时间线。**非新独立场景**，作为既有场景的"特殊形态"承载。
- **隐含取舍**：
  - **不主打开箱即用的多 session 列表 UI**（A 方向被弱化）——这是 DSH 容易自己做的部分。
  - **不主打开箱即用的知识沉淀 + 检索**（C 方向被推迟）——MVP 起步较慢，留作后续迭代候选。
  - **subagent 拓扑可视化只覆盖 native subagent**（`origin: 'subagent'` 且 `parentSession` 已记录）；**不覆盖** ACP / Codex / Claude Code 远端子节点（DSH README 明确 one-shot 不可追踪）；**不覆盖** agent-team（DSH 标记 experimental）。
- **可视化形态（待细化）**：可能包含进度条、任务树、时间线、依赖图、subagent 拓扑画布等多种表达。**立项阶段不细化形态**。

---

## 风险与待验证假设

1. **"可视化"定义模糊**
   - **假设**：第一版聚焦"任务树 + 时间线"两种最常见的可视化形式。
   - **验证手段**：跑通最小插件 demo 后回看是否要调整可视化的具体形态。
2. **A 方向（多 session 管理）被弱化**
   - **风险**：用户核心痛点可能是"同时开多个 session 心智爆炸"，B 版本在 MVP 中可能没充分覆盖该痛点。
   - **缓解**：跨 session 的产出可视化天然承载"多个 session 摆在一起看"的价值，不至于完全缺失多 session 视角。
3. **C 方向（产出归档 / 知识沉淀）被推迟**
   - **缓解**：在 `docs/scope/` 显式标注 C 方向为"暂缓（不进入 MVP）"，避免后续无意识地扩张。

---

## 暂缓方向（不进入 MVP）

| 方向 | 暂缓原因 | 何时再评估 |
| --- | --- | --- |
| **A：多 session 管理向** | 与 DSH 内置 session 列表差异化不足；护城河弱。 | MVP 后视 DSH 内部演化决定是否补回。 |
| **C：产出归档 / 知识沉淀向** | MVP 起步较慢；需先想清楚"沉淀什么 / 沉淀格式"。 | MVP 完成后第一个迭代阶段评估。 |

---

## 相关 ADR

- [ADR 0001 — 形态决策：skyaxis 作为 deepseek-harness 的独立插件](0001-形态-dsh插件.md)
- [ADR 0002 — 定位决策：skyaxis 的一句话定位（可视化向）](0002-定位-可视化向.md)
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)