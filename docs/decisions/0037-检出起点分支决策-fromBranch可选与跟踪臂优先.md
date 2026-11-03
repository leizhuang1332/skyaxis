# 决策 0037：检出起点分支（fromBranch 可选与跟踪臂优先）

> 日期：2026-11-03
> 依据：用户需求——「从仓库池添加」选择仓库 modal 增加 from 分支，支持指定开发分支的检出起点（默认 master/main，可指定如 product）；三项拍板（起点语义 / 跟踪臂优先 / 纯文本输入）。
> 状态：**已拍板**——[决策 0011](0011-克隆分支检出决策-远程同名分支探测与跟踪检出.md) 的续轮：保持其双臂探测语义不变，为「远程无同名分支、需新建」的臂补上起点控制。

## 背景

0011 落定后的克隆建支语义：clone（不带 `--branch`，HEAD 落远程默认分支）→ 探测 `refs/remotes/origin/<branch>` → 存在则跟踪检出（`checkout -B --track`）、不存在则 `checkout -b <branch>`（**起点恒为 HEAD = 远程默认分支 tip**）。缺口：用户无法指定「开发分支基于哪个分支创建」——如基于 `product` 线而非 master/main 开新支，此前只能克隆后手工 rebase/重建。

## D1 语义与优先级——fromBranch 可选，跟踪臂逐字优先（已拍板）

- `fromBranch` 全链 optional（wire `ReposLinkRequest` / ledger `LinkedRepo` / 引擎 `CloneStartInput`）：**缺省/空白 = 未指定（仓库默认分支起点）**。
- probe exit 0（远程同名开发分支在场）⇒ 0011 跟踪臂**逐字优先**，fromBranch 静默无效化——「远程已有你的分支」时续作它，起点问题不存在；无效化是特性非缺陷。fromBranch **作为声明意图保留在 ledger**（引擎永不回写 ledger，`LinkedRepo` = intent 的既有边界），reclone 照常复用。
- 前端种子策略：fromBranch **永不 carry-over，恒置空**。branch 是需求耦合字段（一个需求的开发分支跨仓库同名），fromBranch 是仓库耦合字段（各仓库基线各异）；且错值代价不对称——branch 预填错提交前可改，fromBranch 残留错值要**整轮克隆后**才响亮失败；空本身就是有意义取值（默认分支）。

## D2 命令形态——`checkout -b <branch> --no-track origin/<fromBranch>`（已拍板）

```
probe exit 0（远程同名在场）        → checkout -B <branch> --track origin/<branch>   // 0011 逐字不动，fromBranch 无效化
probe ≠0 且 fromBranch 在场        → checkout -b <branch> --no-track origin/<fromBranch>
probe ≠0 且 fromBranch 缺省        → checkout -b <branch>                            // 现状逐字不动
```

- **否决裸两参形态 `checkout -b <branch> origin/<fromBranch>`**：git 出厂默认 `branch.autoSetupMerge=true` 会对 remote-tracking 起点静默建 upstream=origin/<fromBranch>——`push.default=upstream`（遗留配置）下 `git push` 会把开发分支提交**直推基线分支**（真实损毁路径）；`push.default=simple`（默认）下因 upstream 名≠本地名报错死路。
- **显式 `--no-track` 与 0011 D2 的显式 `--track` 互为镜像防御**：跟踪臂防用户把 autoSetupMerge 设 false（确保跟踪在场），from 臂防默认 true（确保跟踪不在场）——同一哲学：行为钉死在 argv 上，不随用户全局配置漂移。此处记档防止后人以「反正默认不跟踪」为由把这个防御「修正」掉。
- from 臂与裸 `-b` 臂同属「新分支无 upstream」家族：首次 `git push -u origin <branch>` 的自然流程两臂一致。
- clone argv（`git clone --progress`，不带 `--branch`）**逐字不动**——全量克隆语义与 probe 的本地 refs 前提（0011 D1）保持，起点控制局部在 `#branchPhase` 三叉。

## D3 失败、取消与校验——响亮失败即探针，复用 invalid-branch（已拍板）

- **远端无 fromBranch** ⇒ 克隆后 checkout 非 0 → 既有 `bad-branch` + cleanupDest；**刻意不加第二次 probe**——checkout 失败本身就是探针（全量 clone 后 `origin/<fromBranch>` 缺失必致非 0），detail 取 git stderr 首行（报错文本自含 ref 名，足以区分）。
- 边角不特判：`fromBranch == branch` 且远程无此分支 → probe ≠0 走 from 臂 → `origin/<from>` 同样不存在 → 同一失败族（「远端无 from 分支」子集）；`fromBranch == 默认分支名` → 等价不填，无害冗余。
- preflight：fromBranch 非 undefined 时在 branch 校验后串行追加一次 `check-ref-format --branch`（零网络）。失败**复用 `invalid-branch`，不新增错误码**——两个理由：① zod wire 层已把 fromBranch 形状违规（>100 字符等）折叠进 `bad-request` → 同一条 inline 文案（`repos.errInvalidBranch`），单列新码反而同一错误两种呈现——不一致比不精确更糟；② 新码波及 8 个触点（`ClonePreflightReason` / `PREFLIGHT_CODE` / `ErrorResponse['code']` / `REPOS_INLINE_CODES` / `INLINE_ERROR_KEYS` / 词典四处）换一条文案的精确度，不值。
- abort/取消语义零新增：from 臂只是同一 checkout 槽位的另一条 argv——handle 停靠、`signal.aborted` 先查、settle 幂等、cleanupDest 槽位守卫全部原样复用；状态机、wire status、`CloneFailureClass` 零改动。

## D4 波及与基线（已拍板）

- **reclone 复用 ledger 的 fromBranch**（wire schema 不收该字段——与 branch 同构，「ledger 是唯一真源」）。
- **旧档零迁移**：`YAML.stringify` 丢弃 undefined 键，无 fromBranch 的 ledger 行落盘逐字节兼容；读边界 `OptionalLedgerBranchSchema` 把空白串归一为 undefined——手改 yaml 的 `fromBranch: ''` 无害读入（不触发整文件 schema-degraded）。
- **互相赋值断言对 optional 漂移静默**（缺 optional 键的对象仍满足接口）：fromBranch 防漂移锚 = requirements-file round-trip 测试 + endpoint ledger 断言，不指望编译期。
- 已关联行展示 `branch ← fromBranch` 后缀（箭头字形语言中立，零新词典 key）；词典仅 +2（label + placeholder）。
- 基线 1318 → **1330**（clone-registry +4 / endpoint +4 / requirements-file +1 / repos-section +3）；README 双版同轮追平。

## 连带记档

- clone.ts 模块头注释与 `#branchPhase` 文档注释同步三叉链描述（含 `--no-track` 镜像防御依据）。
- repos-section.spec 的 6 处 `linkRepo` 精确实参断言随签名补第 4 参（恒传 `''`，可变形 arity 是测试与可读性双毒——空值归一收敛在 controller 构造 body 处）。
- register.spec.tsx 的词典键全集契约按排序位补入两键。

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-03 | 初版：D1 fromBranch 可选+跟踪臂逐字优先+不 carry-over / D2 `--no-track` 命令形态与镜像防御（否决裸两参）/ D3 响亮失败即探针+复用 invalid-branch / D4 波及与基线 1330。 |
