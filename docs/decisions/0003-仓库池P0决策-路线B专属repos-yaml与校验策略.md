# 决策 0003：仓库池 P0 拍板（存储路线 B + 校验策略）

> 日期：2026-09-24
> 依据：[0004-仓库池调研](../research/0004-仓库池调研-DSH宿主能力评估与方向规划.md) §4.2 存储决策矩阵、§3.2 校验路径、§6.1 决策点
> 状态：已拍板

## D1 存储路线：B —— 插件专属 repos.yaml（否决路线 A settings namespace）

**选择**：宿主半自管 `$DSH_HOME/skyaxis/repos.yaml`（自带 `yaml` 运行时依赖 + node:fs）。

**含义与后果**：
- 数据是插件**专属文件**，与宿主全局 `settings.yaml` 完全隔离：无"手编坏 settings.yaml 炸宿主 boot"风险、无设置页自动渲染 namespace 表单的副作用、无 `@deepseek-ai/schemastery` fork 依赖问题。
- 代价（自担，调研已确认）：脱离宿主原子写 / zod 读边界 / 热重载 / revision 体系——原子性（temp+rename+备份）、schema 校验、乐观并发（自建 revision 计数）全部插件自理；浏览器读写不经 `ctx.remote.settings`，CRUD 与校验统一走自建 `connection.fetch.register` 端点（`/api/skyaxis/repos` 端点族）。
- 先例：宿主 `dsh-credentials-local` 自管 `.credentials.yaml`（yaml Document 保注释改写）。

## D2 URL scheme 白名单：file:// 拒绝，ext::/fd:: 必拒

**允许**：`https://`、`http://`、`git@host:path`（ssh）、`ssh://`；scp 风格 `host:path` 允许但须防本地路径歧义（实现期定防护规则，P2 细化）。
**拒绝**：`file://`（D2 拍板）、`ext::`/`fd::`（安全必拒：git 传输协议本身是命令执行面）、无 scheme 的本地/相对路径。
不合法者直接拒绝保存，无可商榷路径。

## D3 宿主未装 git 的降级：仅语法校验放行

`resolveExecutable('git')` 失败时跳过可达性检查，语法合法即允许保存（可选在列表标注「可达性未验证」，P3 打磨项）。不回退 `ctx.web.fetch` 公网探测（其 SSRF/无认证限制使其价值有限）。

## D4 可达性失败分类的放行映射：未知 → 拒绝

| 分类 | 行为 |
|---|---|
| 网络 | 提示原因，`RiskConfirmation` 确认后**可放行**保存 |
| 权限 | 同上，确认后**可放行** |
| 未知 | **直接拒绝**（无可商榷路径），文案说明原因不明、建议人工核查 |

## 连带影响

- 浏览器↔宿主通道收敛为**一套端点族**（list / save / remove / validate），比路线 A 少一条通道（无需 `ctx.remote.settings`、client 入口无需加 `'remote'`）。
- 调研报告 §6.1 决策点 1/2/3/4 全部关闭；5/6（settings 页副作用、URL 内嵌凭据）随路线 B 一并消失/简化——URL 内嵌凭据仍按 D2 白名单中的合法性规则处理（`https://user:token@host` 属合法 URL 形态，是否入库属 P2 实现期文案与安全细化，默认倾向拒绝并提示）。
