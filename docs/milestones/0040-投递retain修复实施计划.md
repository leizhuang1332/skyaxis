# 投递 retain 修复（rc.3 会话引用纪律回归）实施计划

> 日期：2026-11-03
> 依据：[决策 0038](../decisions/0038-投递rc3会话引用纪律修复决策-retain后借binding.md) + 用户实机缺陷反馈（任务书「投递并发送」→「投递失败：请复制后手动粘贴。」；手动粘贴后会话正常开跑）。
> 定位：0033 升级（0.1.5-rc.2→0.2.1-rc.3）的遗漏回归修复轮——单文件（delivery.ts）+ 既有测试原地升契约 + 记档；wire/词典/SowModal 零改动。
> 基线：1318→1330（0039）之上，**1330 不变**（13 用例原地强化，净增零）。

## 根因链（宿主源码 ../deepseek-harness 逐环核实）

1. rc.3 客户端 `ISessions` 引用纪律：`create()` 只入目录（`ClientSessions.create` → manager.create + projectList，不碰 scopes map）；`binding()`/`scope()` 只读 `this.scopes`，仅 `retain()`（→`retainScope`→`materializeScope`）物化（service.ts:539-541/:490-492/:543-565）；契约原文「retain it before borrowing its binding」。
2. delivery.ts（0017，探针于 0.1.5-rc.2 实机过门）主路径 `sessions.binding(createdId)?.session` ⇒ rc.3 恒 undefined ⇒ 静默跳降级尾；降级尾 `scope(createdId)` 同 undefined ⇒ `input.for(undefined)` 抛/或缺 conversation ⇒ `ok:false` ⇒ 兜底文案。
3. 0033 升级轮只改了降级尾导航（open 退役→uiWorkspace.openSession），投递主路径未实机复验——回归窗口即 0033（2026-10-26）。

## 实施记档（单工作树交付）

- **delivery.ts**：头注释补 rc.3 引用纪律段（0017 探针版本前提记档）；minimal faces 加 `SessionReferenceFace` 与 `retain`；`sessionsFaceOk` 四成员（retain 必需——缺则不建面，按钮诚实消失）；投递/信使两闭包 retain({source:'skyaxisDelivery'}) 覆盖双臂（降级尾 scope() 同吃物化 scope）、finally release（refcount 对活跃会话 +1/-1 安全；prompt 已宿主持久，release 只拆客户端 scope）。
- **tests/workbench/delivery.test.ts**（0017 轮 13 用例原地升契约）：fake `binding()` 改答 undefined（回归钉：回退「直接 binding(createdId)」立红）；retain/release 逐路径断言（主路径 retain 实参+release 恰一次、降级/no-service 同、create 抛错零 retain、信使 retain 目标 id）；形状检查加缺 retain 臂；0038 钉替换 0033 钉（无 open 有 retain 照常建面）。中途自建 delivery.spec.ts 与本文件重叠，按「不留重复测试面」并回本文件后删除。
- `npx tsc --noEmit` 零错误；全量 `npx vitest run` = **1330 全绿**；build 通过；README 计数不变零改动。

## 实机验收脚本（4 步，待用户实机走查）

1. **主路径（主体）**：需求详情 → 生成任务书 → 投递并发送 → 无警示、modal 关闭、新会话出现在侧栏对应工作区下、会话内任务书全文在场且 agent 直接开跑（无草稿待手发）。
2. **信使**（如有未验收工作包返工场景）：返工话发送 → 同上直启。
3. **工作区挂靠回归**：已注册工作区路径投递 → 会话挂在该工作区（侧栏分组可见），非 cwd-only。
4. **投递后再开侧栏**：release 后侧栏打开同一会话无异常（重新 retain/打开历史正常，任务轮次不丢）。

## 关联观察项（本轮不动，另议）

- 工作台 `/api/skyaxis/workbench` 会话切换瞬间 400 重试串（0036-0038 已记档，既存自恢复）。
- artifacts GET 404 控制台红行：设计内「诚实缺失」探查（fetcher 注释 `404 = honest missing`），仅控制台噪音，无行为缺陷。
- 投递会话内 agent 报「git 因目录所有权受限无法执行」（dubious ownership）——宿主沙箱令牌与克隆目录属主差异，属宿主/环境语义面，skyaxis 侧暂不动作；若高频可另立轮次评估（如克隆后 safe.directory 预配或任务书措辞提示）。
