# skyaxis — 竞品 / 参考产品调研

> 本文是 skyaxis 立项阶段的"竞品 / 参考产品调研"。
> **锁定来源**：（无对应 ADR，立项阶段产出物，仅作为后续决策的事实输入）
> **调研时间**：2026-09-19
> **调研人**：Claude（基于 WebSearch / WebFetch 公开信息汇总）

---

## TL;DR

1. skyaxis 的定位（**DSH session 内进度 + 跨 session 产出可视化**，见 [ADR 0002](../decisions/0002-定位-可视化向.md)）在公开市场上没有 1:1 的对照产品；最接近的是 **Aider / Cline / Roo Code** 这类 AI 编程 agent，但它们都聚焦在**"执行 + 改代码"**，可视化只是其 IDE / 终端体验的附属。
2. **LLM 可观测性赛道**（LangSmith / Langfuse / OpenLLMetry / Arize Phoenix / AgentOps）覆盖了 skyaxis 6 场景里的"单次调用追踪 + trace 可视化"，但**几乎都不支持"按 session 维度的会话回溯 + 跨 session 产出聚合 + 决策归档"**——它们的"session"语义偏 trace group，不偏"用户主观划分的开发会话"。
3. **AI 编程 agent 赛道**（Aider / Continue / Cline / Roo Code）中，**Roo Code** 是最接近 skyaxis 拓扑可视化思路的（Orchestrator Mode 协调多 sub-task），但它的可视化嵌在 IDE 侧栏，不是独立插件；**Continue.dev** 提供了 session 管理（新建/重命名/分享会话），但同样绑死 IDE。
4. **开源 / 数据归属**：5 个观测性工具中只有 **Langfuse（MIT）** 和 **Arize Phoenix（Elastic License 2.0，源码可用但有限制）** 可自托管且不依赖云服务；**OpenLLMetry（Apache 2.0）** 是 SDK 不是平台，需自接后端。AI 编程 agent 端，**Aider / Continue / Cline / Roo Code** 全部为开源或源码可用 license。
5. **对 MVP 的潜在影响**：skyaxis 在"session / task / decision / snippet 的可视化与回溯"这条赛道上**几乎无强对手**；需要在立项阶段把"个人开发者本地、跨 session 产出聚合、决策与代码片段归档"作为差异化锚点讲清楚。

---

## 1. 调研背景与目标

### 1.1 背景

skyaxis 立项阶段的 6 场景 + ADR 0009 的 subagent 拓扑可视化（见 [ADR 0003](../decisions/0003-MVP场景清单.md) 与 [ADR 0009](../decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）涉及一个相对独特的交叉地带：

- **它不是纯 LLM 工程可观测性**（LangSmith / Langfuse / Phoenix 这一类，关注 trace / 评测 / prompt 管理）
- **它不是纯 AI 编程工具**（Aider / Continue / Cline / Roo Code 这一类，关注"代码生成 + 文件修改 + git 集成"）
- **它是"AI 编程会话的可视化与回溯"**：把 session 内的进度和跨 session 的产出"变成可被一眼看清、可被回溯的对象"

立项阶段只做产品讨论不写代码（[CLAUDE.md 第 2 节](../../CLAUDE.md)），但允许竞品 / 参考产品调研作为产出物。本文件是落地结果。

### 1.2 调研目标

1. 了解 8 个候选工具**各自在做什么、做到什么程度**，避免 skyaxis 在 MVP 期与既有产品正面撞车而不知情。
2. 提取各工具**可被借鉴的能力**，作为后续产品讨论的事实输入（不替用户决策）。
3. 提取各工具**已覆盖的部分**，作为 skyaxis 的差异化锚点输入。
4. 在每个维度上**事实陈列**，不做"必须借鉴 / 必须差异化"的价值判断。

### 1.3 调研边界

- **覆盖工具**：8 个（见下表）。
- **维度**：每工具 5 个固定维度（见第 3.1 节）。
- **方法**：WebSearch 检索公开页面 + 关键文档页面，**未做 demo 实操验证**，仅依据公开材料。
- **不覆盖**：产品定价谈判细节、私有社区评测、性能 benchmark 实测、内部 roadmap。

---

## 2. 候选工具清单

> **说明**：以下清单是**事实陈列**——只标注每个工具实际在做的事，不评价"是否对 skyaxis 有威胁"。"威胁度"属于立项阶段的判断项，由用户决策，本文件不替用户拍板。

| 工具 | 公司 / 出品 | 一句话定位 | 开源 license | 价格模式 | 类别 |
| --- | --- | --- | --- | --- | --- |
| **LangSmith** | LangChain | LangChain 生态的 LLM 应用可观测、评测、部署平台 | 闭源（仅客户端 SDK 是 MIT） | 免费 5,000 traces/月；Plus $39/seat/月起；Enterprise 自定义（含自托管） | LLM 可观测性 |
| **Langfuse** | Langfuse 公司 | 开源 LLM 工程平台（trace / 评测 / prompt / dataset / 监控） | MIT | 托管版按用量计费；自托管完全免费 | LLM 可观测性 |
| **OpenLLMetry** | Traceloop | 基于 OpenTelemetry 的 LLM 应用可观测性 SDK | Apache 2.0 | SDK 本身免费；可对接 Traceloop Cloud（按用量）或任意 OTel 后端 | LLM 可观测性 |
| **AgentOps** | AgentOps 公司 | AI agent 专用可观测、调试、评测、基准平台 | MIT | 免费 5,000 events/月；Pro 从 $40/月起；Enterprise 自定义（含自托管） | AI agent 可观测性 |
| **Arize Phoenix** | Arize AI | 基于 OpenTelemetry 的开源 LLM 可观测 + 评测框架 | Elastic License 2.0 | 本地 / 自托管免费；Arize AX（托管）按用量计费 | LLM 可观测性 |
| **Aider** | Paul Gauthier（个人） | 终端 AI pair programming 工具，LLM 改你 git 仓里的代码 | Apache 2.0 | 免费开源；只承担 LLM API 费用 | AI 编程工具 |
| **Continue.dev** | Continue（被 Cursor 收购后进入维护期，2026） | 开源 AI 代码助手（VS Code / JetBrains / Neovim），模型与上下文可插拔 | Apache 2.0 | 插件本身免费；自选模型承担 API 费用 | AI 编程助手 |
| **Cline** | Saoud Rizwan（个人项目） | VS Code 自治 AI coding agent，可读写文件、执行命令、用浏览器 | Apache 2.0 | 插件本身免费；自选模型 + 自带 API 费用 | VSCode AI 编程扩展 |
| **Roo Code** | Roo Code（原 Roo Cline） | Cline 的 fork，强化 multi-agent 与自定义 mode 编排 | Apache 2.0 | 插件本身免费；自选模型 + 自带 API 费用 | VSCode AI 编程扩展 |

> 注：Cline 与 Roo Code 在功能定位高度重叠（Roo Code 是 Cline 的 fork），下文按"一个产品族"对照，但分别列能力差异。

---

## 3. 详细对比

### 3.1 核心能力对比

> 表中"√"表示**明确支持**，"(√)"表示**部分支持 / 间接支持 / 通过集成支持**，空白表示**未公开 / 未发现**。每个能力都以"该工具公开材料声明的事实"为依据；不代表"做得有多深"。

| 维度 | LangSmith | Langfuse | OpenLLMetry | AgentOps | Arize Phoenix | Aider | Continue.dev | Cline | Roo Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **可视化形式** | trace 树 + 时间线 + 仪表盘 | trace 树 + session 时间线 + 自定义仪表盘 | SDK 输出 OTel spans，可视化靠后端（Jaeger / Tempo / Phoenix / Datadog 等） | Session Waterfall + 时间线 + chat-style replay + Multi-Agent View | trace 树 + 时间线 + Embedding UMAP + Playground | 终端 TUI（chat + diff）；无独立可视化 UI | VS Code / JetBrains 侧边栏 chat + inline diff | VS Code 侧边栏 chat + 文件 diff + browser screenshot | VS Code 侧边栏 chat + task list + 多 mode 切换面板 |
| **multi-session 支持** | session grouping（按 thread / session 维度聚合 trace） | session 概念（按 session 把多个 trace 串起来） | 由应用层决定（SDK 仅输出 spans） | session replay（按 session 时间旅行回放） | spans 包含 session_id 字段，可按 session 过滤 | 每次启动一个会话；无 session 列表 UI | session 管理（新建 / 重命名 / 分享会话） | 每次任务一个 session（plan / act 模式可保留） | 每次任务一个 session；历史可查看 |
| **sub-agent / multi-agent 支持** | multi-agent trace 可视化（嵌套 span 树） | multi-agent trace 可视化 | 由应用层决定 | 多 agent 协同监控（multi-agent view） | framework 集成覆盖 multi-agent 框架（OpenAI Agents SDK / CrewAI / LangGraph / smolagents 等） | **支持** architect mode（一个"主"模型做规划，一个"弱"模型做编辑），但不是独立的 sub-agent 抽象 | 不直接支持 | **支持** subagent 调用（v3.58 起并行 subagent，隔离 context） | **支持** Orchestrator Mode（启动并协调多个 sub-task）+ 自定义 mode |
| **数据归属** | 云端 / 客户 VPC（Enterprise 自托管）/ Kubernetes | 自托管（MIT 后端）或 Langfuse Cloud | 由接入的 OTel 后端决定（自托管或第三方 SaaS） | 云端 / 客户 VPC（Enterprise 自托管）/ 1,000+ eval 基准 | 本地 / 自托管（Helm）或 Phoenix Cloud | 全部本地：`.aider.chat.history.md` 在用户文件系统 | 全部本地：会话历史在 IDE 本地 | 全部本地：checkpoint 走 git 在用户仓内 | 全部本地：checkpoint 走 git + IDE 本地存储 |
| **离线运行** | 不可（仅自托管可离线，但 Enterprise license） | 可（自托管 MIT 后端，无外部依赖） | 可（SDK 无网络调用，需自接后端） | 不可（云服务）；Enterprise 自托管可离线 | 可（本地 `phoenix serve` 或 Docker） | 完全离线（除 LLM API 调用） | 完全离线（除 LLM API 调用） | 完全离线（除 LLM API 调用） | 完全离线（除 LLM API 调用） |

### 3.2 与 skyaxis MVP 6 场景 + ADR 0009 的差异

> skyaxis MVP 6 场景（[ADR 0003](../decisions/0003-MVP场景清单.md)）：
> - **场景 A**：单 session 内进度可视化
> - **场景 B**：跨 session 产出聚合
> - **场景 C**：多 session 总览
> - **场景 D**：session 决策与代码片段归档
> - **场景 D1**：session 内 task DAG
> - **场景 D2**：session 间依赖
>
> [ADR 0009](../decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 在场景 A / D1 / D2 上**纵深补强** subagent 拓扑可视化。

| skyaxis 场景 | LangSmith | Langfuse | OpenLLMetry | AgentOps | Arize Phoenix | Aider | Continue.dev | Cline | Roo Code |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** 单 session 内进度 | (√) trace 树可看 LLM / tool 步骤，但无"开发者主观感受的进度语义" | (√) trace 树同 LangSmith | (√) 通用 OTel spans | (√) session waterfall + drilldown | (√) trace 树 + 时间线 | (√) 终端流式输出但无"进度总览"面板 | (√) 侧栏 chat 流；无进度面板 | (√) 计划步骤可见（Plan/Act），可勾选 sub-step | (√) task list UI 显示步骤进度 |
| **B** 跨 session 产出聚合 | — 不支持（按项目维度，不按"开发者主观 session"） | (√) session 是 first-class，可按 session 聚合，但语义偏"trace group" | — 由应用层 | (√) session drawer 列出所有 session，但偏 trace replay | (√) session 维度过滤 | (√) `.aider.chat.history.md` 跨 session 累积，但无聚合 UI | (√) session 管理（重命名 / 分享） | (√) 历史任务可回看，但无聚合视图 | (√) 历史可查，无聚合视图 |
| **C** 多 session 总览 | — 项目维度列表 | (√) session 列表 | — | (√) session drawer / list | (√) session 列表 | — 单文件累积 | (√) session 列表 | (√) 历史侧栏 | (√) 历史侧栏 |
| **D** 决策与代码片段归档 | — 不支持 | — 不支持（重点是 trace / 评测，非代码片段归档） | — 不支持 | — 不支持 | — 不支持 | (√) `.aider.chat.history.md` 含完整代码 diff（自动 commit） | — 不支持专门"决策"概念 | (√) checkpoint 保留每次文件状态 | (√) checkpoint + 多 mode 的 plan/act 分离 |
| **D1** session 内 task DAG | — 概念上是 nested span tree，但 UI 主要是 trace 树 | — 同 LangSmith | — 同上 | (√) agent execution graph（专做 multi-agent 协同） | — 同 LangSmith | — 无 DAG 抽象 | — 无 DAG 抽象 | (√) sub-task 列表（Focus Chain） | (√) Orchestrator Mode 把 sub-task 显式建模 |
| **D2** session 间依赖 | — 无"开发者主观 session 间契约"概念 | — 同 LangSmith | — 同上 | — 同 LangSmith | — 同 LangSmith | — 无 session 间依赖概念 | — 无 | — 无 | — 间接：subagent 父子关系是天然的 session 依赖 |
| **ADR 0009** subagent 拓扑 | (√) multi-agent trace 可视化（嵌套） | (√) multi-agent trace 可视化 | — | (√) multi-agent view | (√) framework 集成（OpenAI Agents SDK / LangGraph / smolagents） | (√) architect mode（双模型协作，但非 sub-agent tree） | — 不直接 | (√) subagent 调用（v3.58+），隔离 context | **(√) 最接近**：Orchestrator Mode + 自定义 mode + 可视化 task tree |

> 表中"—"表示**该工具未公开声明此能力**或**不在其核心卖点范围内**。空白不代表"完全没碰过"，仅代表"在公开材料中未把它作为主要能力宣传"。

### 3.3 每个工具的"公开来源标注"

> 以下事实陈述均来自检索到的公开材料。每条尽量给出可追溯 URL，避免二手编辑。

**LangSmith**

- 一句话定位：LangChain 出品的 LLM 应用可观测、评测、部署平台。SDK 开源（MIT），平台本体闭源。
- 来源：[LangSmith Pricing (Softwr 2026 整理)](https://www.softwr.com/pricing/langsmith)、[AitoolsAtlas 定价对比](https://aitoolsatlas.ai/tools/langsmith/pricing)、[LangChain Usage and Billing 文档](https://docs.langchain.com/langsmith/usage-and-billing)。
- Self-hosted 仅 Enterprise：需要 sales 联系，无 self-serve 自托管路径；自托管走 Kubernetes / BYOC（AWS / GCP / Azure）。
- 多 agent / multi-session：trace 树天然支持嵌套 span；session 是 first-class 维度，可把多个 trace 聚合成"一个用户会话"。

**Langfuse**

- 一句话定位：开源 LLM 工程平台，trace / 评测 / prompt 管理 / dataset / 监控。
- 来源：[Langfuse 官网](https://langfuse.com/)、[GitHub Repo](https://github.com/langfuse/langfuse)、[Self-hosting 文档](https://langfuse.com/docs/self-hosting)、[Tracing 文档](https://langfuse.com/docs/tracing)。
- License MIT：前端、后端、API 全开源；可 docker-compose 或 Helm 上 K8s。
- 多 agent / multi-session：session 是 first-class 概念（attach 到 trace / observation），user 也可 attach 到 trace 跨 session 聚合；multi-agent trace UI 可渲染。

**OpenLLMetry**

- 一句话定位：基于 OpenTelemetry 的 LLM 可观测性 SDK，由 Traceloop 维护。
- 来源：[GitHub Repo](https://github.com/traceloop/openllmetry)、[Traceloop 官网](https://www.traceloop.com/)。
- License Apache 2.0（GitHub README 声明）；提供 Python / JS / Go / Ruby SDK。
- 自动 instrument OpenAI / Anthropic / Cohere / Hugging Face / LangChain / LlamaIndex / Pinecone / ChromaDB / Bedrock 等 20+ 集成。
- 不带可视化 UI：可视化靠后端（Jaeger / Tempo / SigNoz / Honeycomb / Datadog / Traceloop Cloud 等任选）。
- 与 Traceloop Cloud（公司商业产品）是上下游关系，不是替代关系。

**AgentOps**

- 一句话定位：AI agent 专用观测、调试、评测平台，400+ LLM / 框架集成，2 行代码接入。
- 来源：[AgentOps 官网](https://www.agentops.ai/)、[AgentOps Docs](https://docs.agentops.ai/v1/introduction)、[AG2 集成文档](https://docs.ag2.ai/0.9.8/docs/ecosystem/agentops/)。
- License MIT（GitHub）；可自托管（Enterprise 自定义合同）。
- 核心可视化：Session Waterfall / Session Drilldown / Time Travel Debugging / Multi-Agent View / Chat History View。
- "Time Travel" 是其差异化词：可从 checkpoint 重启 session 并回放。
- 安全合规：Recursive Thought Detection（防 agent 死循环）/ Prompt Injection Detection / PII 检测。

**Arize Phoenix**

- 一句话定位：开源 AI 可观测 + 评测框架，基于 OpenTelemetry，框架无关。
- 来源：[GitHub Repo](https://github.com/Arize-ai/phoenix)、[Phoenix Docs](https://arize.com/docs/phoenix)、[Tracing 文档](https://arize.com/docs/phoenix/tracing/llm-traces)。
- License Elastic License 2.0（GitHub README 声明；非 OSI 标准开源许可，源码可见但有限制）；同时提供 Arize AX 商业托管版。
- 部署：本地 `pip install arize-phoenix` + `phoenix serve`，或 Docker / Helm 上 K8s，或 Phoenix Cloud。
- 核心可视化：trace 树 / 时间线 / Embedding UMAP / Playground / PXI（Phoenix Intelligence 内嵌调试 agent）。
- 框架集成覆盖度高：OpenAI Agents SDK / Claude Agent SDK / LangGraph / Vercel AI SDK / Mastra / CrewAI / LlamaIndex / LangChain / DSPy / Haystack / smolagents。

**Aider**

- 一句话定位：终端 AI pair programming 工具，对接 git 仓做文件编辑。
- 来源：[Aider 官网](https://aider.chat/)、[Aider 文档](https://aider.chat/docs/)、[Aider GitHub](https://github.com/Aider-AI/aider)、[Chat Modes 文档](https://aider.chat/docs/usage/modes.html)、[Repo Map 文档](https://aider.chat/docs/repomap.html)。
- License Apache 2.0。
- 三种 chat 模式：code（默认改文件）/ ask（只答不写）/ architect（一个强模型规划 + 一个弱模型编辑，是双模型协作）。
- Repo Map：内置仓库结构图，让 LLM 理解大仓库；这是其工程亮点之一。
- Session 存储：`.aider.chat.history.md`（默认 `~/.aider.chat.history.md`，可配），append-only markdown；`.aider.input.history` 保存原始 prompt。
- 自动 git commit：每次成功编辑自动提交，方便回退。

**Continue.dev**

- 一句话定位：开源 AI 代码助手，VS Code / JetBrains / Neovim，模型与上下文可插拔。
- 来源：[Continue 官网](https://www.continue.dev/)、[GitHub Repo](https://github.com/continuedev/continue)、[Session Management 文档](https://docs.continue.dev/features/session-management)。
- License Apache 2.0。
- 核心功能：Tab autocomplete / Chat（侧栏）/ Inline Edit / Agent Mode / Context Providers / Slash Commands / MCP（2026 起）。
- 配置：单一 YAML 文件 `~/.continue/config.yaml`，可按角色路由不同模型（chat / edit / autocomplete / apply / embed / rerank）。
- Session 管理：新建 / 重命名 / 分享会话（这是它的 session 能力，**重点是 IDE 内会话流**）。
- 2026 状态：被 Cursor 收购，进入维护期，最后一次主要 release 为 2026-06。

**Cline**

- 一句话定位：VS Code 自治 AI coding agent，可读写文件、执行命令、用浏览器。
- 来源：[GitHub Repo](https://github.com/cline/cline)、[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=CLine.cline-vscode-extension)。
- License Apache 2.0；项目原名 Claude Dev，后改名以反映多模型支持。
- 工具系统：24+ 内建工具（file / bash / browser / MCP / regex search / tree-sitter / 命令权限控制器）。
- 上下文管理：`@url` / `@problems` / `@file` / `@folder` / prompt caching / sliding window。
- Plan / Act 模式（v3.2+）：分离"规划"与"执行"，便于用户审核 plan 后再让 agent 改文件。
- Subagent（v3.58+）：并行 subagent，隔离 context window。
- Checkpoint：基于 git 的 workspace checkpoint，可 diff 与回退。
- CLI（v2.0，2026-02）：headless CI/CD 模式 + 并行执行。

**Roo Code**

- 一句话定位：Cline 的 fork，强化 multi-agent 与自定义 mode。
- 来源：[Roo Code 官网](https://roocode.com/)、[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)、[Docs](https://docs.roocode.com/getting-started/features)、[Roo Code vs Cline 对比](https://www.roocode.com/blog/cline-vs-roo-code)。
- License Apache 2.0。
- 核心特性：
  - **Orchestrator Mode**：可启动并协调多个 sub-task，并行执行
  - **Custom Modes**：Architect / Code / Debug / Ask + 用户自定义 mode
  - **Multi-Agent Coordination**：把 multi-agent 作为核心设计哲学（vs Cline 的"单一 agentic 体验"）
  - **MCP Server Marketplace**：内置 MCP server 浏览安装
  - **Code Review Mode / Orchestrator Mode**：mode 数量多于 Cline
- 是 skyaxis ADR 0009 subagent 拓扑可视化思路的**最相近对照产品**。

---

## 4. skyaxis 可以借鉴什么

> 以下是**事实推断**——基于各工具公开能力，标注"skyaxis 可以考虑借鉴的某项设计 / 思路 / 工程做法"。是否借鉴由用户决策。

### 借鉴点 1：**显式区分"session 内的步骤进度"与"跨 session 的 session 列表"两个视图层级**（来源：AgentOps / Roo Code / Arize Phoenix）

- AgentOps 把"session waterfall（一个 session 内的时间线）"和"session drawer（多个 session 的列表）"明确分离——这是 skyaxis 场景 A（单 session 内进度）与场景 B/C（跨 session 总览）的天然划分。
- Roo Code 把"Orchestrator Mode 的多 sub-task 并列展示"与"Task list UI"分离——这是 skyaxis 场景 D1（session 内 task DAG）的天然划分。

### 借鉴点 2：**"checkpoint + 可回退"作为 session 进度的快照语义**（来源：Aider / Cline / Roo Code）

- Aider 自动 git commit + `.aider.chat.history.md` 双轨记录：完整对话历史 + 完整代码状态。
- Cline 的 workspace checkpoint 基于 git 的 diff / restore。
- Roo Code 同样。
- skyaxis 场景 A / D 可考虑复用类似的"快照语义"——把"该 session 的所有文件状态"作为可回退的可视化对象。

### 借鉴点 3：**OpenTelemetry 风格的 span / trace / session 三层语义**（来源：OpenLLMetry / Arize Phoenix / LangSmith）

- OpenLLMetry / Phoenix 都把"trace / span / session"作为三层抽象。
- skyaxis 的"session / task / decision / snippet"对象层（见 [ADR 0006](../decisions/0006-业务对象清单.md)）天然可映射到这套语义上：session → trace，task → span，decision / snippet → annotation。
- 是否完全采用 OTel 规范涉及架构选型（属"设计 / 实施"阶段，立项阶段只标记事实）。

### 借鉴点 4：**"Time Travel Debugging / Session Replay"作为可视化增强**（来源：AgentOps 独有卖点）

- AgentOps 宣称可从 checkpoint 重启 session 并回放。
- 这种"时间旅行"语义对 skyaxis 场景 D（决策与代码片段归档）的"回溯"诉求有直接对照。

### 借鉴点 5：**"自定义 mode"作为 sub-agent 拓扑的最小建模单元**（来源：Roo Code）

- Roo Code 的 custom mode（Architect / Code / Debug / Ask + 用户自定义）是 sub-agent 拓扑可视化的天然建模单元。
- skyaxis ADR 0009 已经把"subagent tree 作为 task DAG 的特殊形态"建模；Roo Code 是这条路上已经走了一段的产品。

### 借鉴点 6：**"本地优先 + 自带 .md / .jsonl 存档"作为可移植的会话存储**（来源：Aider / Cline / Roo Code）

- Aider 的 `.aider.chat.history.md`（append-only markdown）+ 自动 git commit 是"个人开发者完全离线 + 数据归用户所有"的典型实现。
- 这种本地文件式存储与 skyaxis ADR 0005 锁定的"纯本地 + 单端"运行环境（[ADR 0005](../decisions/0005-MVP边界与Non-Goals.md)）完全一致。

---

## 5. skyaxis 不需要做的（差异化锚点）

> 以下是**事实推断**——基于各工具公开能力 vs skyaxis 立项定位，标注 skyaxis 不需要与这些产品正面竞争的领域。是否差异化由用户决策。

### 差异化点 1：**不与通用 LLM 可观测性平台正面竞争**（LangSmith / Langfuse / OpenLLMetry / Phoenix）

- 这 4 个工具的核心价值是 **trace 树 + token / 成本 + 评测 pipeline + prompt 版本管理**——面向"LLM 应用工程师"，数据规模是百万级 trace。
- skyaxis 的核心价值是 **session 维度的进度可视化 + 跨 session 产出聚合 + 决策与代码片段归档**——面向"AI 重度多 session 的个人开发者"（[ADR 0004](../decisions/0004-目标用户画像.md)），数据规模是个人级 session（[ADR 0005](../decisions/0005-MVP边界与Non-Goals.md)）。
- 公开材料里这 4 个工具都未把"个人开发者的代码决策归档"作为卖点；skyaxis 不需要去做"通用 LLM 观测平台"。

### 差异化点 2：**不与 AI 编程 agent 抢"代码生成 / 文件编辑"的执行侧**（Aider / Cline / Roo Code）

- 这 3 个工具的核心价值是 **autonomous code editing**：能跑命令、能改文件、能 commit。
- skyaxis 作为 **DSH 的可视化插件**（[ADR 0001](../decisions/0001-形态-dsh插件.md)），不在"执行代码生成"这条赛道上——它把 DSH 的执行结果**画出来**。
- 公开材料里这 3 个工具虽然都内置了 task list / checkpoint / 历史侧栏，但**没有一个把"跨 session 产出聚合 + 决策归档"作为 first-class 卖点**——因为它们的核心是 IDE 内即时体验，不在"跨 session 知识沉淀"。

### 差异化点 3：**不进入团队 / 多租户 / 企业版**（LangSmith Enterprise / AgentOps Enterprise / Phoenix Cloud 等）

- 上述三家都有 Enterprise 自托管 / SSO / SOC2 / HIPAA / VPC 部署等能力——面向企业。
- skyaxis MVP 锁定为 **MIT 开源 + 个人开发者 + 纯本地**（[ADR 0005](../decisions/0005-MVP边界与Non-Goals.md)）。**不进入企业可观测市场**。

### 差异化点 4：**不做模型路由 / prompt 版本管理 / eval pipeline**（Langfuse / LangSmith / Phoenix 的核心）

- 这三家的 prompt 版本管理 + eval pipeline 是其留存客户的"重武器"。
- skyaxis 的 6 场景里**没有任何一个**与 prompt 工程 / 模型 A/B test 相关——skyaxis 不做这件事。

### 差异化点 5：**不做团队协作 / 多端同步**（[ADR 0005 显式 Non-Goals](../decisions/0005-MVP边界与Non-Goals.md)）

- Langfuse / Phoenix Cloud / AgentOps Cloud 都强调"团队协作面板"。
- skyaxis 反向锁定为 **单端 / 离线 / 个人**。这是与 SaaS 化观测平台的明确差异化。

---

## 6. 关键发现 + 对 skyaxis MVP 的潜在影响

### 6.1 关键发现（事实层）

1. **可视化层面没有 1:1 对手**：skyaxis 的"session 内进度 + 跨 session 产出聚合 + 决策归档"这条赛道上，公开市场上无成熟产品。**这是一片相对空白地带**。
2. **OpenTelemetry 已经成为 LLM 可观测性的事实标准**：5 个观测性工具里 4 个基于 OTel（OpenLLMetry / Phoenix / 部分的 Langfuse / LangSmith 已支持 OTLP）。skyaxis 的对象建模可以参考这套三层抽象。
3. **AI 编程 agent 已经把"sub-task / checkpoint / session history"做出来**：Roo Code 的 Orchestrator Mode + custom mode 是当前最接近 skyaxis ADR 0009 思路的产品，但深度不够（其可视化只到 IDE 侧栏）。
4. **"本地优先 + 文件式存档"对个人开发者是合理架构**：Aider 的 `.aider.chat.history.md` + 自动 git commit 是典型实现。这与 skyaxis ADR 0005 锁定的"纯本地 + 单端"完全吻合。
5. **多 session 总览 / 跨 session 聚合：观测性赛道缺失**。Langfuse / AgentOps 都把"session"作为 group by 维度，但语义偏"trace group"，**不是"开发者主观划分的开发会话"**——这是 skyaxis 的一个明确空白点。

### 6.2 对 MVP 的潜在影响（仍属事实层，不替用户决策）

- **MVP v0.1（[ADR 0007](../decisions/0007-长期规划与里程碑.md) 阶段 2.1）的可视化层可参考**：
  - Roo Code 的 task list UI（结构简洁清晰）
  - AgentOps 的 session waterfall + drilldown（信息密度合适）
  - Arize Phoenix 的 trace 树（作为底层抽象的对照）
- **MVP v0.2（[ADR 0007](../decisions/0007-长期规划与里程碑.md) 阶段 2.2）的 D1 / D2 实现可参考**：
  - Roo Code 的 Orchestrator Mode 拓扑建模
  - OpenLLMetry 的 span 嵌套语义
- **MVP v0.3（[ADR 0007](../decisions/0007-长期规划与里程碑.md) 阶段 2.3）的多 session 聚合可参考**：
  - Langfuse 的 session first-class 抽象（注意：语义需重新定义，不是照搬）
  - AgentOps 的 session drawer 列表

> 以上是事实陈列，**不替用户决定**借鉴哪些、不借鉴哪些、是否重新设计。

---

## 7. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。完成 8 个工具的事实调研，覆盖 5 维度（可视化形式 / multi-session / sub-agent / 数据归属 / 离线运行），并对照 skyaxis MVP 6 场景 + ADR 0009 做差异矩阵。 |

---

## 8. 参考 URL

> 仅列文中直接引用或检索过的公开材料；未深入阅读的二手评测链接已尽量剔除。

### LangSmith

- [LangSmith Pricing: Every Plan Compared (2026) — Softwr](https://www.softwr.com/pricing/langsmith)
- [LangSmith Pricing & Plans 2026 — AitoolsAtlas](https://aitoolsatlas.ai/tools/langsmith/pricing)
- [Usage and Billing — LangChain Docs](https://docs.langchain.com/langsmith/usage-and-billing)
- [What Is LangSmith — Scaler](https://www.scaler.com/topics/what-is-langsmith/)
- [LangSmith Alternatives — Morphllm](https://www.morphllm.com/comparisons/langsmith-alternatives)

### Langfuse

- [Langfuse 官网](https://langfuse.com/)
- [Langfuse GitHub](https://github.com/langfuse/langfuse)
- [Langfuse Self-Hosting 文档](https://langfuse.com/docs/self-hosting)
- [Langfuse Tracing 文档](https://langfuse.com/docs/tracing)
- [Langfuse Docs 总入口](https://langfuse.com/docs)

### OpenLLMetry

- [OpenLLMetry GitHub](https://github.com/traceloop/openllmetry)
- [Traceloop 官网](https://www.traceloop.com/)
- [OpenLLMetry JS/TS 版本](https://github.com/traceloop/openllmetry-js)

### AgentOps

- [AgentOps 官网](https://www.agentops.ai/)
- [AgentOps Introduction Docs](https://docs.agentops.ai/v1/introduction)
- [Agent Monitoring and Debugging with AgentOps — AG2 Docs](https://docs.ag2.ai/0.9.8/docs/ecosystem/agentops/)
- [AgentOps, the Best Tool for AutoGen Agent Observability — Microsoft AutoGen Blog](https://github.com/microsoft/autogen/blob/417ce5ca2c21d4828700ad85648d3a4d66b394f2/website/blog/2024-07-25-AgentOps/index.mdx)

### Arize Phoenix

- [Phoenix GitHub](https://github.com/Arize-ai/phoenix)
- [Phoenix Docs 主页](https://arize.com/docs/phoenix)
- [Phoenix Tracing 文档](https://arize.com/docs/phoenix/tracing/llm-traces)
- [Phoenix CLI for Agents](https://arize.com/?p=27531/)
- [Agent Observability — Arize](https://arize.com/ai-agents/agent-observability/)

### Aider

- [Aider 官网](https://aider.chat/)
- [Aider 文档总入口](https://aider.chat/docs/)
- [Aider GitHub](https://github.com/Aider-AI/aider)
- [Aider Chat Modes 文档](https://aider.chat/docs/usage/modes.html)
- [Aider Repo Map 文档](https://aider.chat/docs/repomap.html)
- [Where aider stores its history — Deja-Vu](https://vshulcz.github.io/deja-vu/registry/aider.html)

### Continue.dev

- [Continue 官网](https://www.continue.dev/)
- [Continue GitHub](https://github.com/continuedev/continue)
- [Continue Session Management Docs](https://docs.continue.dev/features/session-management)
- [Continue VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=Continue.continue)

### Cline

- [Cline GitHub](https://github.com/cline/cline)
- [Cline VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=CLine.cline-vscode-extension)
- [Cline — Autonomous AI Coding Agent — tokrepo](https://tokrepo.com/zh/workflows/fe3f1223-13da-42dc-8493-28b6c1a92ca0)
- [Cline Review: The VS Code Autonomous Agent — Knowara](https://knowara.com/ai-tools/coding/cline-review)

### Roo Code

- [Roo Code 官网](https://roocode.com/)
- [Roo Code GitHub](https://github.com/RooCodeInc/Roo-Code)
- [Roo Code VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)
- [Roo Code Documentation — Features](https://docs.roocode.com/getting-started/features)
- [Roo Code vs Cline — Roo Code Blog](https://www.roocode.com/blog/cline-vs-roo-code)
- [Roo Code vs Cline — Apidog Blog](https://apidog.com/blog/cline-vs-roo-code/)
- [Cline vs Cursor vs Copilot vs Roo Code 2025 — Builder.io](https://www.builder.io/blog/ai-coding-assistants-2025)