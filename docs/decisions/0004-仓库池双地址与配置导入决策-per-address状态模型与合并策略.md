# 决策 0004：仓库池双地址（SSH+HTTP）与配置导入（JSON/YAML）

> 日期：2026-09-27
> 依据：用户需求（双地址配置 + JSON/YAML 导入合并四规则）+ [决策 0003](./0003-仓库池P0决策-路线B专属repos-yaml与校验策略.md)（存储路线 B / D2 白名单 / D3 降级 / D4 放行映射）+ 2026-09-27 影响面评估（5 路子系统调研 → 方案起草 → 3 视角对抗评审，7 个 blocker 全部裁决吸收）
> 状态：已拍板（用户 2026-09-27 确认，开放项按推荐落定）

## 背景与总原则

两个需求是**父子关系**：双地址是数据模型改造（协议 → 存储 → 端点 → UI 全链路），导入是双地址之上的新增端点（导入条目天然携带双地址槽位）。导入实现若抢跑于双地址落地必然返工，阶段顺序不可倒置。

全程有效的不变约束（源自 0003 与工程硬约束）：

- D2 白名单是安全边界：`{https, http, ssh}` scheme + scp 简写、拒 `file://`/`ext::`/`fd::`/内嵌凭据——**导入路径逐地址过同一 `checkUrlSyntax`，不得因批量走捷径成为后门**。
- repos.yaml 持久化契约：原子写（tmp→bak→rename 退避）、内部序列化队列、`expectedRevision` 乐观锁、degraded 拒写保护现场——导入批量写必须复用此通道，单次落盘 revision 只 +1。
- 0002 边界：requirements host 永不读 repos.yaml，关联仅靠 repoId join + 请求期 url/name 快照。
- `repos-pool-shared/protocol.ts` 零依赖铁律（浏览器 bundle 内联，禁 zod/yaml/node builtins）：文件解析只在 host 半。
- protocol.ts ↔ host types.ts 的 mutual-assignability 编译断言、dictionary zh/en 键集镜像、browser 手写 type guard——三处对齐机制不可绕过。

## D1 数据模型：per-address 平铺拆分（否决仓库级单 status）

**选择**：`RepoRecord` 的单 `url` 拆为双可选地址槽位，验证状态三元组**按地址独立持久化**（平铺，不嵌套）：

```
RepoRecord {
  id, name, description,
  urlSsh?,  urlHttp?,                     // 至少其一（refine 约束）；空串在入口归一为"未提供"，不落库
  statusSsh?,  statusHttp?,               // 状态四件套存在 ⟺ 对应 url 槽位存在
  validatedAtSsh?, validatedAtHttp?,
  lastErrorSsh?,  lastErrorHttp?
}
```

字段名统一 camelCase（`urlSsh`/`urlHttp`）；导入文件的 `url-ssh`/`url-http` 仅是文件格式，host 解析层映射。

**为何否决"仓库级单 status + 保守合成"**（对抗评审三方交叉印证的 blocker，记录备查）：

1. **导入规则 2 语义空洞**：给已 verified 仓库补第二个地址，单 status 无法表达"一地址已验证、另一地址未验证"——保留 verified 则徽标说谎（新地址从未探测），回退则丢失已有验证态。
2. **clone 优先级倒退**：自建 GitLab（`code.jms.com:2222` 类）首连 host key 未信任时 ssh 探针必落 auth（0003 D4 已归权限类）；单 status 下 clone 无法感知哪个地址更可信，固定"ssh 优先"反而使"配双地址比只配 http 更不可用"。
3. **保守合成无解**：`{unchanged, verified}` 混合（"只改一个地址"恰是最常见编辑形态）无规则命中；status/validatedAt/lastError 三元组只合成 status 则产生 verified 配 stale validatedAt 的不一致记录；unverified 压过 forced 会静默抹掉用户显式的 D4 放行决策。

per-address 模型让上述问题全部消失（无需跨槽合成），代价是协议面积约 +40%——裁决值得。

## D2 槽位 wire 约定：字段存在性即意图

- 请求/记录中 `urlSsh`（或 `urlHttp`）**缺失 = 不配置该地址**；编辑时删掉字段 = **显式移除**该地址及其整套状态四件套。无需新增 `'removed'` 枚举值，"缺键"无歧义。
- `SaveValidation` 重定义为 per-address：`validation: { ssh?: SaveVerdict, http?: SaveVerdict }`，**键集 = 请求中存在的地址槽位集合**（有地址必带该地址的保存结论；SaveVerdict ∈ verified / unverified / forced / unchanged）。
- 移除唯一剩余地址 → "至少其一" refine 拦截（422）。移除已 verified 地址 → 该槽状态随地址一起消失，剩余地址按自身结论。
- `'unchanged'` per-address 语义：哪个地址没变就继承哪个地址的状态四件套，host 不重探（0003 P2 "编辑 URL 未变跳过可达性"原则按地址粒度保留）。

> **2026-09-27 实施补充（P1 落地时钉死的三条边界）**：
> ① **槽级 unchanged 兜底**——`'unchanged'` 但 previous 无该槽（create 或编辑新增槽，罕见客户端信号）**不 422**，落 unverified 四件套（槽内默认），保住陈旧缓存客户端的保存流。
> ② **YAML null 视同缺键**——手改 repos.yaml 写 `urlSsh:`（冒号后留空，yaml 库解析为 null）语义是"不配该地址"而非坏文件：v2 存储记录的可选字段将 null 归一为缺键，refine 以 `!== undefined` 判存在；`validatedAt*/lastError*` 的 null 是合法语义值（槽存在+未验证）不受影响。
> ③ **归位撞槽 400**——请求字段族与值族不一致（如 `urlSsh` 装 http 值）或两值归位同槽：**400 bad-request（客户端 bug），绝不静默去重/改槽**。D4 的"按值归位"保证的是**落库槽位由值决定**（存储中 urlSsh 槽必为 ssh 族），并非宽容错位请求——客户端（表单/导入装配）负责把值放进正确字段。
> **2026-09-27 P2 补充（两条写路径的错位语义分叉）**：import 条目的键族/值族交叉（`url-ssh` 装 http 值）或同族两值抢槽是**用户文件问题 → 该条 skipped（reason `slot-conflict`）带因继续**，与 save 的 400（客户端 bug）分叉——批量导入不因单条错位整单拒。另 D6 的 description 合并口径钉死：**值异才更新、值同 no-op 计 unchanged**（与地址同哲学）——变更检测 = 槽位变更 ∪ description 值异，description-only 更新同样落盘（否则被"零变更不落盘"分支静默丢弃），重复导入同文件不空转。

## D3 repos.yaml v1→v2 迁移：读侧兼容，格式转换不做内容审查

**选择**：`version` 升 `literal(2)`；读侧先按 `version` 字段判别再 parse（不用 z.union——union 错误合并会让 degraded detail 变成"Expected 2, received 1"这类无诊断价值的报错）；v1 分支 transform 迁移后 `.pipe(v2 记录 schema)` 复验，迁移产物不直通落盘。写侧恒写 v2（`repos-file.ts` 两处硬编码 `version: 1` 同改），读路径纯读不回写——用户下次任意 save 自然升级。

**归槽规则**：旧 `url` 过 `checkUrlSyntax`，`kind ∈ {ssh, scp}` → `urlSsh`，`kind ∈ {https, http}` → `urlHttp`，状态四件组随迁。

**关键裁决——"schema 合法但语法非法"的存量 URL**（v1 存储边界从不过白名单，白名单在 save 端点层；手改文件的 `file://`、无 scheme 路径、纯空白 url 是合法存量）：**原样落入 urlHttp 槽并保留原状态**。迁移是格式转换不是内容审查——绝不因迁移丢记录（下次 save 落盘后永久消失），也绝不因单条坏数据整文件 degrade（池砖化 + 拒写）。语法问题留给该记录下一次 save/validate 暴露。

**其余口径**：

- 迁移原样保留文件级 `revision`（否则升级即触发并发面板 409 风暴）。
- `.bak` 为单份滚动备份：v2 首次落盘后的下一次 save 即覆盖 v1 锚点——**降级口径为"不支持降级"**，在决策与发版说明中显式声明，不暗示 .bak 长期兜底。
- **加性 schema 替代方案（不动 version、可选新字段 + 保留必填 `url`）的比较记录**：加性方案可双向兼容（旧插件 zod strip 未知键不 degrade），但 `url` 变成"主地址副本"的第二真相，双写同步负担永久存在且 version 语义失效（v1 有两种形状）。裁决弃用：v2 硬切换来单真相与干净版本语义，升级路径由"两半同包发布 + 发版声明不支持降级"覆盖。

## D4 save / validate 语义

- **validate 路由零改动**：保持单 url 语义，前端对每个非空地址**并行**（Promise.all）各调一次——串行使最坏等待 20s→40s 且复杂度本在结论聚合层而非请求层；`unchanged` 槽位跳过 probe 沿用现有结论。
- **按值归位（两条写路径统一）**：save 与 import 一致——地址按 `checkUrlSyntax` 的 kind 归槽（用户在 SSH 输入框粘 http 地址 → 归位 http 槽），杜绝"槽位名欺骗"（urlSsh 槽里躺 http 值，展示与 clone 选择双双被骗）。
- **duplicate-url 重定义**：任一新地址与任何存量记录的任一地址精确相等（排除自身）即 422——同一远端的两种形态本就该在一条记录里。
- `ErrorResponse` 新增可选 `field?: 'ssh' | 'http'` 定位失败槽位（可选字段，破坏性最小）。**注意**：field 定位链（fetcher Failure → parseErrorBody → controller SaveFailure → 表单 per-address fieldError）四层无编译兜底，列为验收项。
- 空串/纯空白地址在 zod 入口归一为"未提供"（与导入规则 4"空值忽略"同一语义），空值不落库。

> **2026-09-28 P3 实施补充（表单流四条承重裁决）**：
> ① **结论按值缓存 + stale 守卫**——每槽 verdict 以 `(value, outcome)` 对存放；探测在飞时框被编辑 → 响应落地前比对 `valuesRef`，值不符即**丢弃**（绝不把旧值的结论配新值的 body 落库，顺手封掉 P1 单框时代的既有洞）。重试/再点保存只探"无结论或值不符"的槽，不全量重探。
> ② **并行探测逐槽 settle**——失败槽回 idle + 该框网络错误文案，成功槽保留结论；任一槽缺结论则本次提交不落盘（错误可见、可编辑重试，不卡死）。
> ③ **gate confirm 禁用语义修正（对"单一 canSave 共用所有确认路径"的实现层修正）**——DSH `RiskConfirmation` 原语用同一个 `disabled` prop 同时禁用 ack checkbox 与 confirm 按钮：直接传完整 canSave 会**死锁**（未 ack → canSave false → checkbox 被禁 → 永远无法 ack）。落地为：`disabled = busy || anyBoxError`（忙/被拦兄弟槽时整个 gate 不可操作），"所有 gate 全 ack"规则由 footer 保存按钮的 disabled（视觉信号）+ `onConfirm` 内 canSave 短路（行为兜底，单 gate 已 ack 时点击为静默 no-op）共同强制——**不可放行的语义不变，仅按钮视觉态与原裁决有偏差**。
> ④ **自动保存路径的过期闭包洞（实现期测试暴露的真 bug）**——`handleSubmit` 内 `await` 探测后，闭包读到的 `phase` 仍是点击瞬间的渲染快照，刚探完的槽会被误判"缺结论"而永不自动保存。修复：本闭包内落地的结论收入局部 `landed` 映射，`hasMissing` 判定与 `collectVerdicts` 优先读它（渲染态仅作跨提交的缓存回退）。

## D5 导入端点（新增第五端点）

- 路径 `REPOS_IMPORT_PATH = '/api/skyaxis/repos/import'`；**buffered JSON**：`{ expectedRevision, dryRun?, content: string }`（前端 `file.text()` 上送；配置文件量级 KB~百 KB，不适用 streaming）。
- **host 侧统一解析**：一律 `YAML.parse`（JSON 是 YAML 子集，消除一半错误面），**按形状分派**（不带 format 字段）：顶层数组 = JSON 条目式；对象含 `repos` 数组 = YAML 全量式（头部 version/revision 是导出快照，**忽略**；v1 形态条目复用 D3 迁移函数归槽）。
- **独立宽松 ImportEntrySchema**（name 必填 + 双地址可选 + 其余字段一律 optional 且忽略）——不复用存储边界 ReposFileSchema，手写精简条目（仅 name+url）不被整单拒。
- **dry-run 强制预览**：`dryRun: true` 只回报告不落盘；前端先展示"将新增 N / 更新 M / 跳过 K"预览，用户确认后二次请求真导入。批量改写系统配置必须有落盘前确认。
- **尽力合并 + 精确报告**（已拍板）：非法条目跳过并带原因，不整单拒；**零变更不落盘**（created+updated 均为 0 时不调 save，revision 原样返回，不空转 .bak）。
- **导入不做可达性探测**（20s/地址的 probe 会拖垮批量），统一落 unverified，验证留给现有 validate 流。此为 0003 D4"用户抉择放行"的**程序化写入显式豁免**：导入不经 RiskConfirmation，落 unverified 与"未知 → unverified"的诚实语义一致。
- **409 冲突口径**：**以最后一次合并响应为准**，不是幂等重放——重放针对新快照执行，窗口内第三方变更会改变合并结果，前端必须渲染最后一次响应的报告。
- 大小防线：前端 `file.size` 预检；host 先查 content 长度（自设上限，超限 413）再进 parse，防 YAML.parse 大文档内存峰值。
- degraded 相位（配置文件损坏）下导入入口禁用（409 unreadable-file 提前拦截于 UI 层）。

> **2026-09-28 P3 实施补充（导入 UI 五条承重裁决）**：
> ① **真导入的 revision 锚定 dry-run 响应**——`expectedRevision` 取 **dry-run 响应返回的 revision**（组件 preview 态显式持有并传入），controller 绝不代读 store：否则后台 focus-refresh 后确认会静默合并到与预览不同的快照上。
> ② **409 永不自动链式**——dry-run 或真导入撞 conflict 均落"stale 态"（提示清单已变更），仅**用户手动点"重新预览"**才对新快照重跑 dry-run；不存在 409→自动 dry-run→自动 import 的链条。
> ③ **前端两段 size 防线**——`file.size > IMPORT_PRECHECK_MAX_BYTES`（8MiB 字节）拒读文件；`file.text()` 后 `content.length > IMPORT_MAX_CONTENT_CHARS`（2M UTF-16 码元）拒发请求。两段分别盖住"未读先拒"与"字节≠码元"（多字节中文文件不被字节预检误拒）。
> ④ **importing 态禁 onClose**——真导入在飞时服务端可能已落盘，关闭对话框会被读成"取消"；Modal 关闭与遮罩路径全部拒绝，done 态才可关闭。
> ⑤ **skipped detail 白名单渲染**——detail 仅当值为 `UrlRejection` 枚举时经词典映射显示；host 的 slot-conflict detail 是硬编码中文句子，**不回显**（英文界面语言泄漏防线）。导入入口禁用矩阵钉死为 `phase === 'ready' && !busy`（degraded/loading/load-error/busy 全禁——非 ready 下 dry-run 必 409，是①②的前置闸）。

## D6 导入合并规则矩阵（需求四规则 + 边界裁决）

前置：解析归一为条目数组 `{name, urlSsh?, urlHttp?, description?}`，逐条**先滤空（规则 4）、再校验、后合并**；合并对"当前快照 + 本批已并入条目"的累积视图执行。

| 场景 | 处置 |
|---|---|
| 1 当前配置无此仓库名称 | 新增：mint 新 uuid，提供的地址各落 unverified 四件套，description 采用导入值 |
| 2 有仓库、对应槽位为空 | 补入该地址（unverified 四件套）；**另一地址的状态四件套原样保留**（per-address 模型下与 save 路径语义自动一致） |
| 3 有仓库有地址、导入值非空且不相等 | 覆盖该槽位 url 并重置其状态四件套（unverified/null/null）；与系统值相等则 no-op 计入 unchanged |
| 4 导入地址空/空串/纯空白/缺字段 | 该槽位视为"未提供"，**绝不触碰系统已有值**；两地址皆空的新条目整条跳过（`empty-urls`） |
| description | 与地址同哲学：非空且**值异**则更新、空或值同则忽略/计 unchanged（yaml 导出文件天然带 description，丢弃不合理；2026-09-27 P2 钉死"值异才更新"防重复导入空转） |
| id / status / validatedAt / lastError | 一律不采用（防伪造 id 撞库；导入文件中的验证结论不可信） |
| name 空串/缺失/超 64 | 跳过（`invalid-name`） |
| 地址非法（checkUrlSyntax 拒绝） | 跳过该条并带具体 UrlRejection（`invalid-url`）——白名单不可因批量放松 |
| 系统中同名多条 | 跳过（`ambiguous-name`，保守不猜；name 现无唯一约束是事实，是否加唯一约束不属本次范围） |
| 撞其他仓库地址 | 跳过（`duplicate-url`，与 save 同规） |
| 同批两条同名 | 按顺序应用（第 2 条对第 1 条结果执行"有则更新"） |
| 坏文件 / 超大 / 无 repos 字段 | 整单拒：400（解析失败专用文案）/ 413（先长度后 parse） |
| 全部条目被跳过 | 成功 + 如实报告；UI 对 skipped>0 用警示色并默认展开明细 |

**name 匹配口径（已拍板）**：trim 后**大小写敏感全等**（git 平台大小写不敏感是常态，但 name 是用户自由字段、系统现状 save 不查重名；归一化不属本次范围，显式声明防歧义）。

**报告结构**：`report: { created, updated, unchanged, skipped: [{name, reason}] }`——unchanged 独立计数保证用户可对账（created+updated+unchanged+skipped = 文件条数）。

## D7 clone 连带（需求详情页关联仓库）

- **保持 0002 边界**：link/reclone 仍传**前端选定的最终 URL** 快照（wire 零改动，requirements host 零改动，账本仍只存 repoId+branch）。
- **地址选择策略（已拍板）**：picker 中按 per-address 验证结论**自动推荐**（verified > forced > unverified，同级 ssh 优先），用户可在 picker 行内**手动切换**地址——per-address 状态模型使这成为可能（单 status 模型下此策略不可实现，为 D1 的核心回报）。固定"ssh 优先"无回退的方案因"自建 GitLab 首连 host key 必 auth 失败、配双地址反而不可用"被否决。
- picker 行内展示与筛选双地址化；"池内改地址后 reclone 自动换用新地址/协议"列入已知行为与验收清单（现状语义继承：reclone 用池中现地址）。

## D8 协议扩展清单

- protocol.ts 新增：`REPOS_IMPORT_PATH`、import 请求/响应类型与手写 guard、`RepoRecord` per-address 形状、`SaveValidation` per-address 形状、`ErrorResponse.field`。
- 词典新增（zh/en 成对，register.spec 键集断言守门）：`form.urlSsh`/`form.urlHttp` 双地址文案、`import.*` 整组（入口/预览/报告/错误分支含 unreadable-file/conflict/too-large/parse 专用文案）。
- 成功 mutation 回带最新快照惯例：import 响应 `{ok, revision, repos, report}`。

## 连带影响

- **修订 [决策 0003](./0003-仓库池P0决策-路线B专属repos-yaml与校验策略.md)**：D4 的 forced/unchanged/status 均为单 url 语境，经本决策扩展为 per-address；"一套端点族（list/save/remove/validate）"扩为五端点（+import）。修订以追加块落于 0003 原文。
- 实施立项见 [里程碑 0005](../milestones/0005-仓库池双地址与配置导入实施计划.md)。
- 集成策略：P1 改 `RepoRecord` 即断编译（types.ts 断言强制原子同改），P1–P3 必须同一分支连贯完成、一次发版（wire 变更两半同包）。**旧 client 断裂点更正（P1 实施核验）**：缓存的旧 client.js 会在 **list 响应解析**处失败（旧 `isRepoRecord` 要求 `url` 字段，新响应没有）而非等到 save 422——因此 P1–P3 期间 main 不发版、不做快照构建，缓存窗口仅存在于最终发版瞬间且两半同包覆盖，无需额外兼容文案。
