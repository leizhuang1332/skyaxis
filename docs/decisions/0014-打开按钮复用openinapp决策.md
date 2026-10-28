# 打开按钮复用 open-in-app 决策（分体按钮、多打开方式）

> 日期：2026-10-16
> 背景：用户要求工作区 tab「工作区目录-打开」按钮改成 dsh 会话头 `CAgGvG_split` 分体按钮形态（主按钮=用记住的应用打开，chevron=菜单列出全部可用打开方式）。
> 定位：纯客户端轮——宿主零改动、wire 协议零改动、仓库池/repos-section 不动（留后续轮）。

## D1 复用边界：三层判定（为什么不是 import）

**「直接复用 CAgGvG_split」在字面上不可行，在其宿主能力上完全可行。** 判定依据（2026-10-16 实勘 dsh 0.1.5-rc.2 全局安装树）：

| 层次 | 判定 | 事实链 |
|---|---|---|
| ① React 组件 `OpenInAppAction` | 不可复用 | 浏览器包 `@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js` 只导出 `apply`/`inject`（插件入口，注册进 `conversation.session.header.utilities` slot），组件本体不导出；且其 props 绑死 dsh 会话头数据源（`useSessions` 取 session `cwd`），skyaxis 的语境是 `requirement.workspacePath` |
| ② CSS 类 `CAgGvG_split` | 不可复用也不应 | CSS-module 构建哈希类名，随 dsh 每次构建变化；引用即脆断。处置：规则语义重表达进 `open-in-app.module.css`（同形非同类名，头注锚定 dsh 版本） |
| ③ 宿主路由 + 记忆键 + Menu 原语 | 完全复用 | 见下 |

第 ③ 层的事实链：

1. **路由在场**：web profile 组合 bundles = `dsh-base` + `dsh-web-app` + `@leizhuang1332/skyaxis`（`~/.dsh/profiles/web/package.json`）；`dsh-web-app` 依赖 `dsh-host-open-in-app`（cordis 插件 `open-in-app`），在组合 `webServer` 上挂三条路由：GET `/open-in-app/apps`（已解析应用 id 列表，宿主每生命周期探测一次）、GET `/open-in-app/icon/<id>`（每应用 PNG 图标）、POST `/open-in-app/open`（body `{app, path}`，校验绝对路径+目录存在，argv 永不走 shell）。
2. **信任栅栏可过**：三条路由全在 `connection.requestRejection` 栅栏后（Host/Origin 防 DNS rebinding + 登录 cookie）；skyaxis 客户端同源 fetch 自动带 cookie——fetcher.ts 头注即此先例（repos-pool 传承）。
3. **Menu 原语已链接**：dsh 分体按钮的菜单即 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`，skyaxis 已在 requirements/list.tsx 运行时使用同包。
4. **记忆键可共享**：dsh 控制器 choice 用 `createSnapshotStore('', { persist: { name: 'dsh.open-in-app.choice' } })`，而 dsh-client-store 的 persist 语义是**裸 localStorage 键**（`localStorage.getItem(name)` 原样）。
5. **行为等价背书**：菜单「文件资源管理器」（explorer id）= `shell-open` → `openNativePath`，正是 0011/0012 落地的 plain-open 所走同一宿主开窗函数——分体按钮的 explorer 项与降级臂殊途同归，无行为回归。

**路线常量为字符串字面量的取舍**：`dsh-host-open-in-app` 有 `./shared` 子路径导出但不在页面模块图（浏览器侧 loader 只注册 client 包及其依赖），浏览器包无 `./shared`——类型化导入按构造不可达。字符串常量 + 头注锚定 dsh 包名与版本；不匹配时探测得到非 2xx/404 → 发布空表 → 回退（见 D3），不会误开任何东西。

## D2 choice 键共享：一条 localStorage，两个表面

skyaxis 的 choice store 使用**同键名** `dsh.open-in-app.choice`：skyaxis 工作区分体按钮与 dsh 会话头分体按钮共享「上次用哪个应用打开」的记忆——用户在任一处选过 VS Code，两处主按钮都变成 VS Code。

- 耦合面仅一个字符串常量；dsh 若改键名，两侧各自静默持有独立历史（各自读到空/旧值），是降级不是错误，无崩溃面。
- 词典不共享：skyaxis 不 bind dsh 的 `open-in-app` locale 命名空间（见 D4），choice 键共享而词典不共享是刻意的——键是存储契约（裸字符串，稳定），词典是 UI 契约（键集随 dsh 目录扩展漂移）。

## D3 降级语义：最坏情况 = 现状

分体按钮的渲染阶梯：

1. apps 未应答（`null`）→ 不渲染（短暂缺席，dsh 同构——dsh 的组件在无应用/无 cwd 时也渲染 null）；
2. apps 已应答但空（SSH 组合——`resolveOpenInAppApps` 在 SSH 下返回空表、老版本 dsh 无路由、路由改名、探测网络失败）→ 渲染**调用方的 fallback**＝0011/0012 的 plain-open 按钮（canOpen 门控、无 `action` 键载荷、失败静默，全部原样）；0011 的「无 action 键」回归锁继续生效（存量用例经 fallback 臂全绿）。
3. apps 非空（经可命名过滤）→ 分体按钮。

**懒探测 vs dsh 页载即探的差异（记档）**：dsh 在插件 apply 时即 `controller.load()`（其按钮在每个会话头上）；skyaxis 在分体按钮挂载时才 `load()`（控制器 once-per-life 去重）——没开过工作区 tab 的用户不付出探测请求。apps GET 是宿主侧缓存的廉价读（探测解析每插件生命一次），懒更符合 skyaxis 的按需面。

**launch 失败可见性**：plain open 静默（环境事实）；分体按钮的 launch 走显式路由，失败穿 2 秒 error 红（dsh 同构 busy 250ms/error 2s 节奏）——这是显式契约带来的可见性提升，不与降级臂的静默矛盾（两臂语义各自忠实于其载体）。

## D4 标签自持：闭键纪律，不 bind dsh 命名空间

34 个目录 id 的标签进 skyaxis 自己的 `skyaxis.requirements` 命名空间（`openIn.app.*` 前缀层 + `workspace.openInApp*` 3 键），五点登记照走（interface/zh/en/LocaleNamespaceMap/哨兵）。

- 备选（弃）：`ctx.locale.bind('open-in-app')` 读 dsh 的词典——自动跟随 dsh 目录扩展，但耦合其键集（`app.*`），dsh 改键即裸键外露；且「哪些 id 可渲染」的过滤器需要拿 t(key)===key 当探测，脆。
- 自持的代价：dsh 目录新增 app id 时 skyaxis 侧无标签即不进菜单（「只渲染能命名的 id」过滤器，dsh 同款），补标签是加键的常规操作。
- zh 与 en 仅 4 键不同（访达/文件资源管理器/文件管理器/终端），其余为产品名逐字（dsh PRODUCT_NAMES 口径）。

## D5 范围拍板

- 本轮：仅 [workspace-tab.tsx](../../src/client/requirements/workspace-tab.tsx) 的「打开」按钮。repos-section 行内 `openRepoDir`（repos 行打开）**不动**——组件按可复用形态设计（`OpenInAppButton` 收 path + fallback 两个 prop），后续轮一行接入即可。
- 宿主侧（src/index.ts、requirements-host、wire 协议）零改动；`workspace.open`（fallback 文案）与 `openDirectory` 保留为降级臂，不删除。

## 修订记录

- 2026-10-16 实施轮原稿（D1-D5）。实施偏差一条：控制器 apps 线格式初版误把整个 payload 当数组校验（应为 `{apps: [...]}` 取字段后过滤），红测试 `publishes the host app ids once loaded` 抓出后修正——测试先行语义兑现。
