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

> **2026-09-24 修订（用户裁定）**：未知类失败**不再硬拒，改为与网络/权限同样走 `RiskConfirmation` 交用户抉择**。触发场景：GitHub 标准 ssh 地址 `git@github.com:org/repo.git` 在非交互探针下因 ssh 主机密钥校验失败（`Host key verification failed.`）原落"未知"被硬拒——用户明确"即使无法确认可达性，也不能硬拒"。修订后的持久化映射：网络/权限 → `forced-network`/`forced-auth`；**未知 → `unverified`**（诚实语义：未成功验证过，不扩枚举值）。同时分类器已将 host key 校验失败（首连/密钥变更）归入权限类（服务器可达、信任门槛未建立）。

> **2026-09-27 修订（决策 [0004](./0004-仓库池双地址与配置导入决策-per-address状态模型与合并策略.md) D1/D2/D5）**：本节 forced/unchanged 与 `RepoRecord.status` 均为**单 url 语境**。仓库池引入双地址（urlSsh/urlHttp）后，status/validatedAt/lastError 三元组按地址独立持久化（per-address 四件套），`SaveValidation` 重定义为按地址槽位携带结论；放行映射（本节表格）对每个地址独立适用，语义不变。另：程序化导入写入不经 `RiskConfirmation`，统一落 `unverified`（决策 0004 D5 显式豁免，与本节"未知 → unverified"诚实语义一致）。

| 分类 | 行为（修订后） |
|---|---|
| 网络 | 提示原因，`RiskConfirmation` 确认后**可放行**保存 |
| 权限 | 同上，确认后**可放行** |
| 未知 | **同样走确认放行**（勾选后保存，落库 `unverified`） |
| 不合法 | 仍为唯一硬拒路径（无确认对话框） |

## 连带影响

- 浏览器↔宿主通道收敛为**一套端点族**（list / save / remove / validate），比路线 A 少一条通道（无需 `ctx.remote.settings`、client 入口无需加 `'remote'`）。
- 调研报告 §6.1 决策点 1/2/3/4 全部关闭；5/6（settings 页副作用、URL 内嵌凭据）随路线 B 一并消失/简化——URL 内嵌凭据仍按 D2 白名单中的合法性规则处理（`https://user:token@host` 属合法 URL 形态，是否入库属 P2 实现期文案与安全细化，默认倾向拒绝并提示）。
- **2026-09-27 修订（决策 [0004](./0004-仓库池双地址与配置导入决策-per-address状态模型与合并策略.md)）**：端点族由四端点扩为**五端点**（+ `POST /api/skyaxis/repos/import`，JSON/YAML 配置导入，dry-run 预览 + 尽力合并 + 精确报告）；repos.yaml `version` 升 2（双地址 per-address 状态，读侧 v1 兼容迁移，见决策 0004 D3）。
