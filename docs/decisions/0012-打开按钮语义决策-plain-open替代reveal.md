# 决策 0012：打开按钮 plain open 语义（reveal 退役）

> 日期：2026-10-15
> 依据：用户实机行为反馈——需求详情页工作区 tab「打开」按钮与 dsh GUI 头部 open-in-app explorer 按钮（`wSkVaW_headerUtilities` 内 `/open-in-app/icon/explorer`）行为不一致，前者打开的是回退目录（桌面/文档）而非工作区目录；A/B/C 实机探针（COM `ShellWindows` 枚举 `LocationURL` 验证落点，[issue 草稿](../issues/issue-dsh-native-command-explorer-windowshide.md) 同款手法）定位根因。
> 状态：**已拍板**——两个「打开」调用点（工作区目录 + repos 行）统一 plain open（`action` 省略），reveal 语义退役。

## 背景

两条链路落在 dsh 宿主的**两个不同开窗函数**上：

- skyaxis「打开」（`session.openWorkspacePath({ path, action: 'reveal' })`）→ `revealNativePath` → win32 `explorer.exe /select, <pathToFileURL 百分号编码 URL>`（开父目录+选中）。
- dsh open-in-app explorer 按钮（POST `/open-in-app/open`，catalog `id:"explorer"`，launch `shell-open` → `openNativePath`）→ win32 `powershell Invoke-Item -LiteralPath '<原始路径>'`（开目录本身）。

wire 契约（`dsh-api-session-controller` typert）：`action?: z.literal("reveal")`——唯一合法值是 `'reveal'`，**省略即 plain open**（宿主 `openPath` = `openNativePath`）。

## D1 根因——reveal 的 file-URL argv 载不动 CJK 路径（实机实证）

2026-10-15 本机 A/B/C 探针（目标 `C:\Users\lorcan.lei\IdeaProjects\集运附件回传`，台账真实需求路径；argv 逐参复刻 `runNativeCommand` 热补后形态）：

| 探针 | argv 形态 | 实测落点（ShellWindows LocationURL） |
| --- | --- | --- |
| A = 现状 reveal | `/select,` + `file:///…/%E9%9B%86%E8%BF%90…`（UTF-8 百分号） | **`file:///C:/Users/lorcan.lei/Desktop`（回退桌面）**——症状复现 |
| B | `/select,` + 裸 Win32 中文路径 | `file:///…/IdeaProjects`（父目录）——中文正常 |
| C = open-in-app 同款 | `Invoke-Item -LiteralPath` 裸路径 | **`file:///…/集运附件回传`（目录本身）**——目标行为 |

机制（实测事实之上的推断，旁证在场）：zh-CN 系统 ANSI 代码页 = GBK，Explorer 的 `/select` 目标解析按 ANSI 解码 `%XX` 转义，而 `pathToFileURL` 按 UTF-8 编码——GBK 解出乱码路径 → 不存在 → Explorer 回退默认目录。旁证：本机 ShellWindows 现存 `…/%B6%CC%D0%C5…/repos` 窗口，`%B6%CC%D0%C5` 正是「短信」的 **GBK** 百分号编码——Explorer URL 层说 GBK 的活标本。

台账事实：8 条需求的 workspacePath 全部含 CJK（`IdeaProjects/<中文名>`），该缺陷在本机是**必现**而非边角。

## D2 选型——`action` 省略 = 与 open-in-app explorer 逐字节同函数（已拍板）

`session.openWorkspacePath` 省略 `action` ⇒ 宿主 `openPath` = `openNativePath`，与 dsh open-in-app explorer 的 `shell-open`（`runShellOpen` → `openNativePath`）落在**同一宿主函数**——「与后者一样」由构造保证，非模仿。跨平台同语义：macOS `open <dir>`、Linux `xdg-open <dir>`，皆开目录本身。

备选（热补丁全局 `dsh-native-command` 的 `revealNativePath` 传裸路径，探针 B 已证可行）弃为主案：治标——保留的是「父目录+选中」语义，仍与参照按钮「开目录本身」不同；且每次 dsh 升级/重装需重打（[issue 草稿](../issues/issue-dsh-native-command-explorer-windowshide.md) SW_HIDE 议题同况）。

## D3 语义变化知情记档 + repos 同修（已拍板）

- 行为从「开父目录+选中」变为「打开目录本身」——即参照按钮的行为；「选中」高亮不再有。
- `canOpenWorkspacePath` 门控、失败静默（环境事实）、按钮出现条件全部不变。
- [repos-section.tsx](../../src/client/requirements/repos-section.tsx) 仓库行「打开」同病同修：repo 路径 `<中文工作区>/repos/<目录>` 必然触发同一缺陷；`revealDir` 更名 `openRepoDir`。
- 词典零改动——「打开」文案未变，变的是落点。

## D4 上游缺陷与本轮边界（已拍板）

`revealNativePath` 的 file-URL 形态是 `dsh-native-command` 的**第二个独立缺陷**（与已修的 SW_HIDE 同函数不同因），已给 [issue 草稿](../issues/issue-dsh-native-command-explorer-windowshide.md) 补第二节（含 A/B/C 表与上游修法：explorer 分支直接传 Win32 路径，WSL 分支 wslpath 译出后同理）。skyaxis 本轮起不再走 reveal，不依赖上游修复即自愈。

## 连带记档

- workspace-tab / repos-section 调用点注释记档 plain open 依据；spec 断言改为无 `action` 键（该缺席即回归锁——多出的 `action:'reveal'` 会使断言翻红）。
- 测试 **1080→1080（0）**；`npx tsc --noEmit` 干净；README 双版计数 1080 不变、零改动（README 未描述打开行为细节）。

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-15 | 初版：D1 根因 A/B/C 实证 + GBK 旁证 / D2 plain open = 同函数构造保证 / D3 语义变化知情 + repos 同修 / D4 上游 issue 补节与自愈边界。 |
