# 投递直启决策（prompt 自动发送与投递即绑）

> 日期：2026-10-19
> 背景：用户 2026-10-19 提出「投递到新会话」流程过长——现状点击后跳转 DSH 会话页、还要选工作区、还要粘贴、还要手按发送；而触发点本身就在已知工作区里，这四步全是冗余。要求：不跳转、不选工作区、直接创建并开启会话并自动关联，用户经已关联会话入口随时跳入。
> 拍板：用户 2026-10-19——**D1-D5 全部采纳建议档**（四问四答逐项确认）；实施落 [milestones/0017](../milestones/0017-投递直启实施计划.md)。
> 定位：client 单侧小轮（wire/host 协议零改动）；**推翻 0007 §3.2 的 v2 默认档（人握门禁）——范围仅限投递自动化，0016 D2-A 介动词档位不动**；探针先行，过门才动 UX。

## 拍板速览

| # | 决策 | 拍板 |
| --- | --- | --- |
| D1 | 投递档位 v2→v3（自动发送） | **create(cwd)+prompt('queue') 直启，不 open 不跳转**；按钮文案改「投递并发送」 |
| D2 | 适用范围 | **全部六类任务书统一**；绑定点差异保留 |
| D3 | 失败降级 | **create 成功但 prompt 失败→降级今日 v2**（open+setDraft+跳转，用户手发兜底） |
| D4 | 已关联会话入口 | **复用现有面**（会话条 chip / 收件箱「跳会话」/ 执行视图），零新投影面 |
| D5 | 探针先行 | **刀零 console 探针过门才动 UX**（create→binding→prompt 直启链实机四查） |

## D1 投递档位 v3：prompt 直启（推翻 0007 §3.2 默认档）

**v3 = `create({cwd})` → `binding(id).session.prompt([{type:'text',text}],'queue')`，不 `open()`、不 setDraft、不跳转。** prompt 接受即返回（acceptance ≠ 轮完成）——会话在后台跑，工作台经既有 waiting/收件箱/会话条面观察。

**推翻的口径**：research 0007 §3.2「任务书投递 v2 = create+open+setDraft，用户按下发送……自动 prompt 列 v2+ 届时单独立项」与 decisions/0016 D2 引用的「prompt 自动发送档不做」。本轮即那笔挂账立项。

**推翻站得住的理由**：0007 的人握门禁针对的是「替用户按发送」的**静默**自动化；v3 的发送内容在 SOW 弹窗内**全程可预览可编辑**（0009 起草稿即用户可改），点击「投递并发送」= 用户对自己预览过的内容显式按下发送——同意权没有旁落，与 0016 D2 为 B 档预留的追认逻辑同款（「用户在工作台点击发送自己预览过的内容」不违口径）。按钮文案同步改「投递并发送」——诚实 UI：按钮做什么就写什么。

**范围钉死**：只动投递。0016 D2-A（介动词=仅深链、`prompt('steer')`/排队补话后置）与 D9（setDraft→已存在会话探针冻结）均不受本轮影响。

**v3 顺带消灭的三个旧坑**（驱动证据，非附带收益）：
1. **setDraft known window**（delivery.ts 头注：open 前草稿只活 shell 内存）——用户实机体感「还要粘贴」的根源；v3 不再依赖草稿。
2. **选择工作区步**——`create({cwd})` 创建即绑工作区，且不 open 就没有会话 Hero 的选区交互；实机上 v2 的「选工作区+粘贴」正是用户走了 Hero 新会话流而非已开 shell 的证据。
3. **blank 壳滞留**——prompt 接受后客户端即置 `blankBit=false` 并触发 `onEngaged`（client.js:1695-1699），created id 直接变实；0016 修订 #95/#96 的「每次投递遗留一壳污染选择器」自本轮起不再新增。

**静态证据链**（探针的先验基础）：① `binding()` 对任何**已列出**会话按需物化 scope/binding（client.js `resolve()`/`eligible()`；`create()` 解析即入列表）；② SDK 自身先例——`fork()` 对从未 open 的子会话直接 `binding(childId).session.rename(...)`；③ `prompt()` 是纯 remote 调用无 UI 挂载依赖，`RemoteResult` 诚实回错误分支。

## D2 适用范围：全部六类任务书统一

analysis/split/plan/consolidate/dev/review 的投递按钮统一改为 v3 行为（同一 DeliverFace，无按 purpose 分叉）。**绑定点差异保留**：analysis/split 投递即绑（现状已有，含锚）；**dev 新增投递即绑**（v3 下 sessionId 即真实会话——0016 刀一「dev 不绑在投递时」修正的前提〔绑的就是 shell〕随 v3 消失；标题寻址 pass 与端点侧内容寻址保留为降级/历史修复路径，覆盖 degraded 投递与手投场景）；plan/review/consolidate 维持不绑（无绑定语义，不新造）。

## D3 失败降级：降级今日 v2

create 成功但 prompt 被拒/抛错 → 回退 v2 尾巴：`setDraft(text)` + `open(sessionId)` + 跳转，用户手发兜底——已实机验证的路径，任务不中断；降级投递**不参与 dev 投递即绑**（绑的可能是壳，留标题/内容寻址事后修复）。create 失败或 faces 缺席 → 现状诚实失败（alert+复制兜底，按钮 no-render 纪律不变）。DeliverOutcome 扩 `sent` 布尔（true=已自动发送；absent=降级手发）。

## D4 已关联会话入口：复用现有面

会话条 chip（SessionStrip，已支持点击 `navigate`→`open`）、收件箱行内「跳会话」动词（0016 P1c）、执行视图头行「跳宿主会话」——三面已足，**零新投影面**（0016 修订 #3 反第三投影）。v3 投递即绑后 chip 从投递瞬间即在且指向真实会话，「点卡片跳会话页」即点 chip。

## D5 探针先行：刀零过门才动 UX

0007 §3.3 遗留待验证点 + 0016 修订 #95 的实机教训（「投递即真实 sessionId」假设曾被实机推翻）→ v3 主路径成立与否必须实机先证。刀零 = console 钩子 `__skyaxisDeliveryProbe(text?, cwd?)`（[delivery-probe.ts](../../src/client/delivery-probe.ts)，临时件刀一删除），实机四查：① prompt 对未 open 会话被接受；② created id 变实（blank 翻 false、首条 user 消息=探针文本）；③ 工作区=传入 cwd（会话页核）；④ 轮在跑且完成（回复「探针收到」）。**败→v3 不动工，重议形态（深链+收件箱为主轴）；成→刀一起跑。**

## 连带记档

- **词典**：`sow.deliver` 值改（zh「投递并发送」/en 对齐），键名不动；无新键。
- **显式拒绝清单更新（防复活口径同步）**：仍然拒绝的是——无预览的静默自动发送、介动词 `prompt('steer')`/排队补话默认化（0016 D2-A 不动）、setDraft 草稿辅助默认项（D9 冻结不动）；「投递自动发送」自本轮起**不再是**拒绝项（已显式追认）。
- **退役清单（刀一/刀二执行）**：delivery-probe.ts + index.ts 接线（刀零临时件）；delivery.ts 头注的 v2 叙述与 known-window 披露（改写为 v3）；0016 刀一「投递不绑 dev」的 view 层门（sent 门替代）。
- **不动清单**：四权、账本七态、advanceStage 零守卫、任务书五段结构、S5 导入面、task-graph、回传轮 watcher 族（analysis/split 的锚修复对 v3 会话幂等无害）。

## 修订记录

- 2026-10-19 初版（D1-D5 全量拍板——用户四问四答逐项确认；0007 §3.2 推翻与追认理由落档）。
- 2026-10-19 **刀一验收修正：D1 链路首步从 `create({cwd})` 修正为「resolve-or-register 工作区 → `create({workspaceId})`，cwd 为降级档」**（用户实测：cwd-only 会话不挂工作区、侧栏工作区会话列表不可见——host 只在 workspaceId 路径上执行 `attachSession`）。D1 拍板语义（「在需求的工作区创建会话」）不变，落点是挂靠语义补全；未注册目录首次投递经 create-or-resolve 注册为工作区分组（幂等，与 v2 手选同效）。详见 [milestones/0017 修订记录](../milestones/0017-投递直启实施计划.md)。
- 2026-10-19 **D4 修订（用户裁定）：会话条 chip 退役**——append-only 绑定随投递即绑累积成「chip 墙」；会话入口收敛为 **WP 详情会话行（新增可点入）+ 收件箱「跳会话」+ 执行视图「跳宿主会话」**。反第三投影原则不变（零新增投影面，纯退役+入口位移）。
