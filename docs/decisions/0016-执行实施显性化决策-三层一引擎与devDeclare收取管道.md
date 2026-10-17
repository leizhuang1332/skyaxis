# 执行实施显性化决策（三层一引擎与 devDeclare 收取管道）

> 日期：2026-10-17
> 背景：用户 2026-10-16 提出「③ 执行实施」重设计——把 AI 执行显性化：状态可见、结果可查、进度可跟踪、人类可介入。[research 0016](../research/0016-执行实施显性化业界调研与设计.md)（五路现状盘点 + 15 产品业界调研 + 3×3×3 设计面板）给出终案「三层一引擎」与决策点 D1-D12。
> 拍板：用户 2026-10-17——**D1-D12 全部采纳建议档**；实施落 [milestones/0016](../milestones/0016-执行实施显性化实施计划.md)。
> 定位：wire+host+client 全栈轮（P0 侦察刀先行）；**账本状态机七态零改动、四权零变化、每处新能力配降级路径（最坏=现状）**。

## 拍板速览

| # | 决策 | 拍板 |
| --- | --- | --- |
| D1 | 骨架与执行视图形态 | **A=live 分层**（追认终案裁决） |
| D2 | 介入动词档位与「人握门禁」追认 | **A=仅深链**（默认档）；B=排队补话列候选（触发式追认） |
| D3 | commits[] 激活路径 | **B=建议行+槽内提议行确认入账双层** |
| D4 | 验证证据门强度 | **A=徽章纯展示** |
| D5 | S3→S4 准出形态 | **A=不加闸只加亮**（披露行「{n} 项未验收」） |
| D6 | 收件箱挂载面 | **A=S3 瘦身段**（两组；引擎全八组） |
| D7 | 后台活动刷新档位 | **A=事件驱动 only** |
| D8 | 活动摘要提取器 | **A=规则版起步** |
| D9 | setDraft→已存在会话探针 | **A=独立小轮立项** |
| D10 | 宿主能力诉求包 | **A=打包提报、按批复逐项落** |
| D11 | 台账聚焦刷新默认化 | **A=默认开** |
| D12 | 账本新增面一次追认 | **A=三点全采**（startedAt / declarations 锚 / devDeclares 键控容器） |

## D1 骨架与执行视图形态：live 分层（追认）

S3 升为双形态**看板（摘要层）⇄ WP 执行视图（过程层）**+ S3 顶部「需要你」瘦身段 + WP 详情 Modal 保留为计划与验收档案。裁决理由（research 0016 §5.0）：①评审 2/3 选 live（feasibility+persona），governance 的两处扣分（介动词分期前置、治理暴露面）均可结构性修复；②governance 自身 graft 清单把 live 核心件全部拉进 board——选 board 也会长成 live 的形状，不如显式分层；③现状最大空白「执行中的过程可见性」只有 live 正面击穿。执行视图容器=**二级全宽**（直播需驻留屏幕，Modal 瞬态遮板不合性；独立 tab 动 rail 越界）。B（board 最小增量）的四通道件（收取卡/自动绑定/watcher/卡面升级）全部被 A 吸收为子集；C（inbox 中心）的分组引擎作为 A 的分组投影并入。

## D2 介入动词档位：默认仅深链，排队补话列候选（治理类）

**A=仅深链**：介入默认=「跳宿主」（waiting 聚合条/收件箱行直达深链）；现状零风险——单用户宿主输入框原生支持运行中排队，「跳去应答」落地即得同一能力，工作台内排队是拆成两半的交互（发得出、看不到回应）。**B=排队补话/撤回列候选**：用户实际抱怨跳转频繁再立项；立项时须用户显式确认「用户在工作台点击发送自己预览过的内容」不违反「prompt 自动发送档不做」口径（0007 P0-1 拍板针对投递自动化，非介动词），且 P3a 探针门控全套照旧（用户点击+内容预览可编辑+排队可撤回+首用诚实失败+深链降级）。C=全三速（prompt('steer')+cancel）后刀。**A 档下 setDraft 草稿辅助与 D9 探针一并冻结，介入保持跳转**（D9 立项时解冻）。

## D3 commits[] 激活路径：建议行+槽内确认双层

**B**：P2a 先落 commitMessage 建议行（声明扩键渲染，零协议依赖）；P2b 激活 devDeclare 槽内 commits 提议行（host 铸 {hash,note,confirmedAt?}，随 seed 写入，用户确认点击盖 confirmedAt 才 append wp.commits[]），全链「未校验」标注——AI 自报 hash 数据质量问题用披露解决而非红线拒绝（采纳 governance 裁定，推翻 board 角「把数据质量问题当红线问题拒」的过严判定）。C=declare 直落 wp.commits **拒绝**：AI 自报值不经用户确认入账，违约束 2 四权闭环。红线维持：commit 由人在工作区执行（open-in-app 打开，C3 冲突预警 3），插件不代跑 git。

## D4 验证证据门强度：徽章纯展示

**A**：声明缺 verification 键时验收面出示「无验证证据」徽章——stale 同款纪律「提示权在系统、判断权在用户」。C=硬门「无证据不得进 built」**拒绝默认**：治理变更且加重流程（0006 P3 阶段可跳过的轻量化教训）。验收节次序落 P2a：先看证据区再核工作区。

## D5 S3→S4 准出形态：不加闸只加亮

**A**：「完成本阶段→」按钮旁披露行「{n} 项未验收」纯提示（与 stale 徽章同构）；advanceStage 零守卫**不动**（「阶段是指针不是闸门」刻意口径，约束 8）。B=三条件完成度条绿灯**弃**（心理闸门效应，rail 既有 accepted/active 徽章已足）；C=加守卫**拒绝默认**（须独立立项）。

## D6 收件箱挂载面：S3 瘦身段

**A**：S3 顶部段仅渲染「卡哪·存疑」「等你·待发送」两组（空态零占位，其余六组被会话条/看板列/角标覆盖不重复渲染）；inbox-engine 纯函数保留全八组+全序+全矩阵单测，为跨需求版直接资产。B=+跨需求全局驾驶舱 band 与 tab「需要你 n」计数——**须连常驻数据面一起立项**（模块级跨需求聚合 store 的 owner/生命周期/新鲜度/陈旧降级，现架构对跨需求常驻面零支撑：register.tsx:78 标签闭包为无状态 thunk、controller 为逐需求槽模型），**后置 D6-B 不在本轮**。C 弃。

## D7 后台活动刷新档位：事件驱动 only

**A**：翻转沿/开视图/手动+节流；视图标注「截至上次翻转」，绝不假装实时；注册层 watcher 的翻转沿台账对照是沿触发非轮询，不违本档。B=30s 轻轮询档：P1b readSession 性能实测门槛数据落档后另议。C=宿主诉求非置台订阅（列 D10-①）。

## D8 活动摘要提取器：规则版起步

**A**：尾窗「动词+对象」规则提取（最近工具调用→摘要行），零新依赖可测；拉不到→行隐藏（诚实缺席）。B=小模型归纳独立立项评估。

## D9 setDraft→已存在会话探针：独立小轮立项

**A**：独立小轮验证 setDraft 对已存在会话是否可用——成=「预置草稿+用户按发送」（包络内最强介入且不依赖 D2，是 D2-A 档下唯一工作台内介入候选）；败=复制面+悬置记宿主缺口。副作用披露：setDraft 覆盖目标会话已有草稿，须确认提示。**轮次排在主线刀之后**，不阻塞 P0-P2b。

## D10 宿主能力诉求包：打包提报

**A**：四项诉求**打包记档于此**、按批复逐项落（inbox D8 纪律；本终案全部机制有降级路径，诉求不阻塞任何一刀）：

1. 非置台会话事件流订阅或 digest 主动推送（后台直播实时化的正道）；
2. pendingInteractions 内容读取+工作台内应答提交 API（waiting 现为布尔级无内容，应答须跳宿主）；
3. git 只读（diff/commit hash 核验——AI 自报「未校验」的正解）；
4. Windows 系统通知（终态提醒）。

批复前一律不进任何设计默认。

## D11 台账聚焦刷新默认化：默认开

**A**：focus/visibility 重拉+会话翻转 30s 节流共享 demand；单用户本地成本极低；看板对新账本数据不再依赖写动作自愈；兼作注册层 watcher 的台账对照通道。落 P1c。

## D12 账本新增面：三点全采

1. `wp.startedAt?`——startWorkPackage 用户动作审计戳（splitApprovedAt 同类，非运行态）；旧记录无戳→时长行不显示。
2. `wp.declarations[]`——导入锚（append-only，host 铸 {seq,at,sessionId,contentHash}），导入点击与 built/产物行、槽盖 imported、持久快照文件**同一 save 原子落账**。
3. `record.devDeclares`——**按 WP 键控**待裁容器（`Record<workPackageId, {seed:{sessionId,contentHash,seededAt}, adjudication:'pending'|'imported'|'dismissed', adjudicatedAt?, commits?[]}>`）：同键 seed 覆盖=槽内幂等替换（结构上不可能跨 WP 覆盖——对抗修订 #1）；幂等锚双维 due=sessionId 或 contentHash 任一不匹配（同会话第二轮返工亦 due——修订 #7）；**文本不入容器**（seed 时 host 写 `.skyaxis/declares/<rid>/<wpId>-pending.md`，导入时写 `<wpId>-d<seq>.md`；台账持哈希、全文单真源在文件——splitProposals 纪律同构升级为键控，修订 #6）；导入 dryRun 重抓 hash≠槽锚→出示「会话文本已变化」。

B=仅 startedAt 弃（证据链短一截）；C=零账本改动弃（纯客户端缓存跨刷新不稳定、与 0012 容器先例反方向）。

## 连带记档

- **分期与砍刀保险**：底线四刀=P0 侦察+P1a 收取管道+P1b 执行视图+P2a 声明扩键（独立可验收，其余刀全部可砍或后置）——盘子相对 0012 压回 2 倍以内；详见 [milestones/0016](../milestones/0016-执行实施显性化实施计划.md)。
- **显式拒绝清单（防复活）**：watcher+自动导入（违四权）；declare commits 直落 wp.commits（D3-C）；自动编排/定时触发/事件到自动开工；代批/分类器代人批；auto-commit/push/merge；硬沙盒/执行前拦截；running 期 30s 常驻轮询；setDraft 草稿辅助为默认项（D2/D9 门控）；inbox 三条件绿灯完成度条（D5-B）；inbox 全局 band 首刀化（D6-B）；todo 键进 v1 扩键集（后置 P4）；系统通知默认化（D10）；workbench tab「需要你 n」计数（D6-B 连账）；置台直播为默认刀（P3b 后置 P4）；dev legacy shell 修复（0015 五段无判别前缀，错绑不可逆）。
- **P4 候选清单（触发条件立项，不在本轮）**：stuck 启发式 / 小模型归纳（D8-B）/ 全局驾驶舱（D6-B）/ todo 对账物 / 系统通知（D10 批后）/ readSession 频率放宽（D7-B）/ 批注通道 / 独立预审 / 排队补话 P3a（D2-B 追认）/ 置台直播 P3b（盯流频次数据）。

## 修订记录

- 2026-10-17 初版（D1-D12 全量拍板——用户采纳建议档；D10 诉求清单四项与显式拒绝清单连带记档）。
- 2026-10-17 **刀一验收三修——收取门从 in-dev 降为 dropped**（用户第四轮实测报告：WP 详情无「声明收取」卡、无「导入声明」）。取证：台账全部 WP 为 planned（用户跳过「开始开发」直接投递），devDeclares 键全文不存在（零槽位=零卡）；最新会话有完整声明块（workPackage: WP3, built: true）但 seed 的 in-dev 门整体拒了——门放错了位置：**收取是信息收集，不该受 WP 生命周期限制；导入（markWorkPackageBuilt）才需要 in-dev 门**（那个在真守卫里已有）。修正三处：① applyDevDeclareSeed 纯核门从 in-dev 降为 dropped（planned/built/accepted 均可收取）；② endpoint seedDevDeclareFlow 同步移除 in-dev 前置门（dropped 仍拒）；③ DeclarationCard 导入按钮对非 in-dev WP 禁用并显示提示（「开始开发后可导入声明」）。四权不变：markWorkPackageBuilt 仍仅 in-dev 可走（新增端点测试钉此）。测试 1147：record-actions guards 用例重写（dropped 400/planned+built 收取合法）+ endpoint wp-not-in-dev 用例改为 built WP 收取成功+markBuilt 400 + planned WP 寻址绑定+收取一气呵成用例重写。
- 2026-10-17 **刀〇 P0 侦察刀记档**（本机 `~/.dsh/sessions/` 真实会话离线分析——存储形态：`<encoded-cwd>/<sessionId>/session.vN.jsonl.zstd`，**多帧拼接 zstd**（每批一帧），与 `ctx.sessionQuery.readSession` 同源数据）。样本=5 个大会话（2582 事件）。
- 2026-10-17 **刀一实机验收驱动修正——dev 投递绑定的 shell 缺陷**（用户实测报告：绑定行状态恒「未开始」）。实证（本机会话存储标本）：`sessions.create` 出的是 config-only shell（351B/4 事件/0 条 user 消息/无标题，永远 blank）；用户按发送后 DSH 把真实对话物化在**新 id**（87KB/129 事件/首条 user 消息=任务书原文）——回传轮四次诊断的 shell 机制对 dev 同样成立，推翻本决策修订 #8 的「投递即真实 sessionId」假设；分析/拆分通道自愈靠的是任务书头行可标题寻址，而 dev 五段首块 `[需求]` 全 WP 逐字同、进不了标题（实测真实会话标题被 LLM 重写）。**修正三件**：① dev 任务书判别头行 `# skyaxis 工作包任务书 WP<n> · <需求标题>`（家族对齐，review 头行顺手补齐；五段块体不动）；② 投递不再绑定（绑的就是 shell）；③ 标题寻址自动绑定——`devTitleBindTargets` 纯联表（门=WP in-dev 且〔无 dev 绑定或最新绑定指向 blank shell〕；匹配=未绑定会话标题的 WP 号词边界正则，最新匹配胜；view 层翻转驱动即时绑定 + 注册层 sweep 兜底跨需求）。存量 shell 绑定行保留（append-only 纪律）；旧 SOW 无判别头，存量 WP 重新投递即入账（真实行追加，watcher 以最新 dev 绑定为准）。挂账：shell 指针置换（host 侧 readSession 验证 blank 后换行）列 P4 候选。
- 2026-10-17 **刀一验收二修——绑定改为端点侧内容寻址（治本）**（用户第二轮实测报告：仍未自动绑定 + 选择器混入 shell 会话）。磁盘+台账取证还原全链路：①修正版在跑（任务书带判别头行 ✓）；②本轮零自动绑定——两个 WP 台账状态为 **planned**（用户跳过「批准计划→开始开发」直接投递，设计允许），而绑定/收取 pass 均以 in-dev 为门全数跳过；台账里 08:54 的真实会话绑定是**用户手动**挑的；③真实会话最终标题被 LLM 重写为自然语（「修图APP WP1 工程骨架与上传校验」）——判别头行**不能在标题中长期存活**，标题寻址只对发送后数秒的 fallback 标题窗口有效，无人观看场景的完成期 sweep 必然寻不到；④选择器混入的「非 DSH 会话」= 每次投递遗留的 shell（append-only 累积）。**修正**：A）绑定/寻址移入 seedDevDeclare 端点——`findTaskbookSession('# skyaxis 工作包任务书 WP<n>')` 全文搜索**事件内容**（首条 user 消息永远含头行，LLM 改标题无关），无绑定或绑定是 shell 时先寻址追加绑定（对任意非 dropped WP 成立——用户先投递后开工的现实流），修复绑定的 save 与 seed 的 save 共用流程内 revision 穿线；B）watcher sweep 只跳过 dropped（无绑定 WP 也尝试，端点自寻址；无绑定尝试不设防——无臂可重臂，靠 sweep 节流+边沿触发天然限频）；C）SessionPicker 过滤 blank 会话（shell 永不可作为绑定选择——它们不是对话）；D）blank 会话状态词改「空壳会话（投递残留，未开始）」（strip/对话框/选择器三处共用 sessionChipState，消灭「未开始」误读）；noBinding/wpNotInDev miss 措辞随语义更新。标题寻址客户端 pass 保留为观看中需求的快路径（fallback 标题窗口内即时绑定）。

**事件类型分布计数表**（3 个主样本 2040 事件）：

| 类型 | 计数 | 关键字段 | 执行视图判定 |
| --- | --- | --- | --- |
| tool/call | 456 | turn/step/callId/**name/arguments** | **进 P1b**：工具分组直播 |
| tool/result | 456 | message.source.callId 回链+sourceEventSeqs | **进 P1b**：结果折叠（输出截断显示） |
| step/start · step/end | 341+341 | turn/step | **进 P1b**：折叠单元 |
| assistant/message | 341 | content 块（**reasoning**/text/tool-call）+**usage/totalTokens** | **进 P1b**：一句话摘要原料（首个 text/reasoning 块）+计量 |
| turn/start · turn/end | 10+10 | turn；end 带 reason{kind} | **进 P1b**：轮边界+终态原因 |
| agent/inbox/spliced | 22 | target:'next-turn'+inserted 消息 | **进 P1b**：「已排队待送达」标注（排队可见） |
| user/message | 17 | content+source.kind | 折叠显示（发起轮） |
| deliverables/presented | 9 | **files[{path,description}]** | **进 P1b**：交付文件区（结果可查现成事件） |
| todo/write（+todo_write 工具） | 4 | todos[{content,status}] 三态 | **进 P1b 只读展示**（对账物 P4 的原料在场） |
| request/context · request/header | 3+4 | model/provider/contextWindow；header 含 tools 全声明 | 计量行提取（model/contextWindow）；tools 声明砍 |
| session/title（-llm-request） | 5+2 | title/messageSeqs | 到场则用（sessionsFace 已有） |
| permission/preset · sandbox/mode · approval/policy | 3+3+3 | preset/mode/policy | 到场则用：执行环境小字行 |
| system/message · session/end-seed · session | 3+4+3 | 系统提示/结束种子/头 | 砍（噪音；header 事件被 readSession 用于寻址） |

**工具名直方图**（585 次 tool/call）：read 212 / grep 188 / pwsh 84 / edit 58 / glob 20 / present 9 / write 8 / todo_write 4 / subagent 1 / list_agents 1。**文件改动累计可行**：`edit`（file_path+old_string/new_string）与 `write`（file_path+content）的 arguments JSON 直含路径；`pwsh`=命令执行（bash 全透明同款）。**计量可行**：usage/totalTokens 携带于 assistant/message（每响应一条）；时长=time 差。**seq 会话内严格单调**（实测 max 1316）——lastEventCount 缓存设计成立。**结论：digest 五列（turn 折叠/工具分组/文件改动/计量/摘要）+交付文件区+排队标注全部进 P1b；task-graph 对账按此表执行。**
