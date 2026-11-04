# 决策 0039：标题寻址绑定的 split 门（镜像宿主生命周期门）

> 日期：2026-11-03
> 依据：用户实机缺陷反馈——浏览器控制台持续红行 `POST /api/skyaxis/workbench 400`（0036-0038 已记档的「会话切换瞬间 400 重试串、自恢复、另议」观察项，本轮议清）。用户提供的 Network 载荷定案：`bindSession{WP1, dev}` → 宿主答 `{"ok":false,"code":"locked-split"}`。
> 状态：**已拍板**——客户端补门对齐宿主既有契约，宿主零改动。

## 背景

0016 刀一验收二修把 `devTitleBindTargets`（view 翻转 pass 与 watcher 清扫共用的纯连接）的候选放宽到「所有非 dropped WP」——但 split **提案**期的记录 workPackages[] 已落地（提案行先于批准写入），`splitApprovedAt` 尚缺席；而宿主 bindSession 的 P2 生命周期门（record-actions.ts:760）要求 split 已批准。于是：用户对提案期 WP 投过任务书 → 会话标题命中 `# (skyaxis )?工作包任务书 WP<n>` → 每次 running→idle 边沿（＝会话切换瞬间）触发节流清扫 → 发一条宿主必拒的 bind → 400 红行；30s 节流下反复重试＝重试串；用户批准 split 或会话消失即止＝「自恢复」。实机样本：d3c40556 记录（stage=plan、splitApprovedAt 缺席、WP1-9 全 planned、有标题命中会话）。

## D1 客户端镜像门（已拍板）

`devTitleBindTargets` 入口加 `if (record.splitApprovedAt === undefined) return []`——绑定是执行期关联（宿主 P2 裁定原文「the list contract must be active」），提案期不发注定被拒的请求。单点修复覆盖双路（view 级 :518 与 watcher 清扫 :155 共用该连接函数）；投递时 bind（view onDelivered :1022-1037）构造上只在批准后状态（plan-approved/in-dev）触发，无需另门。

## D2 宿主不软化、业务码不打日志（已拍板）

- **不动宿主门**：locked-split 是生命周期契约本体，软化它破坏 P2「绑定=执行期关联」裁定。
- **不给业务拒绝臂加日志**：locked-split 等码在响应体里自描述（客户端可分支处理），逐次记档只会刷日志。
- **只给两个不透明 400 臂加诊断日志**（mutateFlow 的 schema 失败 + 非小写 requirementId）：这两臂响应体不带任何区分信息，是本轮排查被拖成考古的直接原因。schema 臂记 zod issue 路径（`字段:错误码` 清单），id 臂记原值；不记载荷。

## D3 测试与基线（已拍板）

- dev-watcher.test.ts +1 回归钉：提案期形状（WP 在场、splitApprovedAt 缺席、标题命中会话、shell 绑定在场）→ 零 bindSession 调用。
- endpoint.test.ts 既有两用例原地扩日志断言（schema 臂报出字段名、id 臂报出原值）；harness 收 logs。
- 基线 1330 → **1331**；README 双版同轮追平。

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-03 | 初版：D1 devTitleBindTargets 镜像 split 门 / D2 宿主零改动+仅不透明臂记档 / D3 回归钉与基线 1331。 |
