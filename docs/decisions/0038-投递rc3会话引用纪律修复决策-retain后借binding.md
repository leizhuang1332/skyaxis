# 决策 0038：投递 rc.3 会话引用纪律修复（retain 后借 binding）

> 日期：2026-11-03
> 依据：用户实机缺陷反馈——任务书「投递并发送」失败，提示「投递失败：请复制后手动粘贴。」（用户手动粘贴后任务书会话正常工作，反向印证投递通道本身断链）。
> 状态：**已拍板**——0033（DSH 0.1.5-rc.2→0.2.1-rc.3）升级的遗漏回归修复轮；[决策 0017](0017-投递直启决策.md) 的投递语义（create+prompt 直启）不变，只修「借 binding 的方式」。

## 背景

0017 投递 v3 在 0.1.5-rc.2 上实机过门（2026-10-19 刀零探针）：`sessions.create()` 返回的 id 可直接 `sessions.binding(id)?.session` 借到 prompt 面。0033 升级 0.2.1-rc.3 时修了降级尾的导航（ISessions.open 退役 → uiWorkspace.openSession），但**主路径未实机复验**。rc.3 的会话引用纪律（client service.ts scopes map）下：`create()` 只入目录（catalogue），`binding()`/`scope()` 只在 `retain()` 物化共享 scope 后才有值——SDK 契约原文「retain it before borrowing its binding」。结果：投递主路径 `binding(createdId)` 恒 undefined → 静默跳进降级尾；降级尾 `scope(createdId)` 同样 undefined → `conversationFace.input.for(undefined)` 抛错（或 conversation 面缺席）→ `ok:false` → 每次投递都落到「请复制后手动粘贴」。

## D1 修复形态——retain({source:'skyaxisDelivery'}) 覆盖双臂，finally 归还（已拍板）

- `create()` 成功后立即 `sessions.retain(sessionId, { source: 'skyaxisDelivery' })`：retain 同步物化共享 scope（client `retainScope`→`materializeScope` 立即建 fiber+ctx+Session），reference.binding 立即可借，无需 await `reference.ready`（0017 刀零「never-opened 可 prompt」实证仍适用——open 在飞只是更进一步）。
- **引用覆盖双臂**：降级尾的 `scope()` 吃同一物化 scope——retain 作用域必须包住 v2 尾，不能只包主路径。
- **finally release**：prompt 落定（accepted）即宿主持久，release 只拆客户端 scope/历史窗；侧栏打开时自会重新 retain。refcount 语义对已被侧栏 retain 的活跃会话（0019 信使场景）安全（+1/-1）。
- `source` 标签 `skyaxisDelivery`：`SessionReferenceSourceMap` 声明合并开放（内置仅 controllerOperation/gateway），运行时任意 string 落 retainedBy 记账。skyaxis 走 delivery.ts 既有 minimal-face 纪律（零 SDK 导入），不建 declare-merge d.ts——标签含义由本决策记档锚定。
- **`sessionsFaceOk` 加 retain 必需成员**：缺 retain（rc.2 形状）⇒ 闭包不建面、按钮诚实消失——建了面也只能次次降级，诚实消失优于哑弹。依赖面已钉 0.2.1-rc.3，无兼容负担。
- 同修 `createSessionMessenger`（0019 返工话信使）：目标会话可能从未被任何人 retain（投递后即 release 的壳），同样必须 retain；已活跃会话走 refcount 无害。

## D2 不动清单（已拍板）

- 投递语义、降级尾逻辑（setDraft+openSession）、`resolveCreateOpts` 工作区挂靠、`armConversation` 反应式装配——全部照旧。
- wire 协议、SowModal 行为、词典——零改动（失败文案本就正确，错的是它被每次触发）。
- 不 await `reference.ready`、不吞其 reject（SDK 自兜：constructor `void this.ready.catch(() => {})`）。

## D3 测试与基线（已拍板）

- 既有 delivery.test.ts（0017 轮 13 用例）原地升 rc.3 契约：fake 的 `binding()` 改答 undefined（**回归钉**——任何「直接 binding(createdId)」的回退立红）、加 retain/release 逐路径断言（主路径/降级/no-service/create 抛错/信使，release 恰一次）；形状检查用例加缺 retain 臂。
- 净增用例数为零（13 用例原地强化）；基线 1330 不变，README 零改动。
- 实机验收：投递并发送 → ok（sent:true）、会话出现在侧栏对应工作区、输入框无草稿残留（v3 直启语义）、会话内任务书全文在场且 agent 开跑。

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-03 | 初版：D1 retain 覆盖双臂+finally 归还+source 标签+retain 必需成员 / D2 不动清单 / D3 回归钉与基线 1330。 |
