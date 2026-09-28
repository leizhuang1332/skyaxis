# Issue 草稿：explorer.exe 继承 SW_HIDE 导致 Win11 26200 上文件夹窗口永久隐藏

> 提交前删除本行及以下说明：标题二选一；正文按目标 tracker 语言可整体保留中文（或需要英文版另行翻译）；代码块原样可复现。

**标题（中文）**：`[dsh-native-command] runNativeCommand 的 windowsHide:true 使 explorer.exe 委托创建的文件夹窗口在 Windows 11 build 26200 上永久隐藏（session.openWorkspacePath 返回 200 但无任何可见窗口）`

**标题（英文备用）**：`[dsh-native-command] windowsHide:true makes explorer.exe /select create permanently hidden folder windows on Windows 11 26200 — session.openWorkspacePath answers 200 with nothing shown`

---

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 11 Pro 25H2，build **10.0.26200** |
| Node | v24.21.0 |
| dsh | 0.1.5-rc.2（全局 npm 安装，`dsh web`） |
| dsh-native-command | 0.1.5-rc.2（dsh 捆绑依赖，CLI 树与 profile 树同一物理副本） |
| 触发面 | Web GUI 任意调用 `session.openWorkspacePath` 的入口（此处为 skyaxis 插件需求详情页工作区 tab 的"打开"按钮，`action: 'reveal'`） |

## 症状

- 点击"打开"→ `/api/session/openWorkspacePath` 返回 **200 `{opened:true}`**，但屏幕上无任何资源管理器窗口出现，**任务栏也无新条目**。
- 同一操作在 macOS 上正常（`open -R`，且 Finder 会被激活到前台）。
- 机器上经任何程序化途径（execFile 直连 / ShellExecuteEx 分离血统均测过）打开的文件夹窗口全部不可见；`Win+E` 手动开窗正常。

## 根因分析

`dsh-native-command` 的 `runNativeCommand`（lib/index.js，runner 区段）对所有命令统一传：

```js
execFile(command, [...args], {
  encoding: "utf8",
  signal,
  windowsHide: true
}, ...)
```

`windowsHide: true` 将子进程 `STARTUPINFO.wShowWindow` 置为 `SW_HIDE`。被 spawn 的 `explorer.exe /select,<path>` 实例向主 shell 委托"开窗"时，**build 26200 的 Explorer 会继承并尊重这份初始显示状态**，于是主 shell 创建的文件夹窗口生而隐藏：窗口对象被创建、级联位置被摆放、注册进 ShellWindows，但 `WS_VISIBLE` 永远为假——无画面、无任务栏条目。老版本 Windows 的 Explorer 忽略该继承，因此该问题仅在 26200（25H2）一类新 build 上暴露。

次要问题（同链路）：`explorer.exe` 无论成败恒以退出码 1 退出，`revealNativePath` 将 code 1 按"已委托交接"吞掉（源码注释明示此意图），导致 `openWorkspacePath` 的 200/`{opened:true}` 对"窗口是否真的可见"完全没有证明力——本次问题因此长期被 200 掩盖。

## A/B 复现（唯一变量 = windowsHide）

前置：Windows 11 build 26200，任意干净 node 进程。以下单文件脚本，两次调用仅第三参数不同：

```js
// reveal-ab.mjs — usage: node reveal-ab.mjs noHide | node reveal-ab.mjs hide
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const target = pathToFileURL('C:\\Users\\<you>\\SomeDir', { windows: true }).href.replaceAll(',', '%2C')
const opts = { encoding: 'utf8' }
if (process.argv[2] === 'hide') opts.windowsHide = true   // ← 生产代码现状
execFile('explorer.exe', ['/select,', target], opts, () => {})
```

结果（同机同路径同血统，仅翻转该参数，重复多次稳定）：

| 变体 | 参数 | 结果 |
|---|---|---|
| A | 不传 `windowsHide` | 窗口打开 **可见**（任务栏出现，内容为父目录并选中目标） |
| B | `windowsHide: true`（与 `runNativeCommand` 逐参数一致） | 窗口对象被创建但**永不显示**，任务栏无条目 |

可选的硬证据采集（PowerShell，COM 枚举 + Win32 可见性）：

```powershell
$shell = New-Object -ComObject Shell.Application
Add-Type 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'
# 运行上述脚本后：
foreach ($w in @($shell.Windows())) {
  "{0} url={1} VISIBLE={2}" -f $w.HWND, $w.LocationURL, [W]::IsWindowVisible([IntPtr][long]$w.HWND)
}
# 变体 A → VISIBLE=True；变体 B → VISIBLE=False（且 DWMWA_CLOAKED=0，非虚拟桌面斗篷）
```

## 生产链路实测（真实 host，非脚本模拟）

对运行中的 `dsh web`（PID 已知）做实时观测：

1. WMI 轮询 `Win32_Process`（`Name='explorer.exe' AND ParentProcessId=<host pid>`）：点击按钮后**捕获到 host spawn 的 explorer.exe 子进程**；
2. COM 窗口枚举：子进程出现后约 1 秒，ShellWindows 新增条目，`LocationURL` 为工作区父目录（即 `/select` 语义正确），但 `IsWindowVisible=False`；
3. HTTP 层：200 `{opened:true}`。

即端到端确认：请求链路、路径解析、explorer 调用、窗口创建全部正确，唯独窗口因继承 `SW_HIDE` 而不可见。

## 已排除项（均实测）

- 进程血统无关：宿主终端直启 / ShellExecuteEx 分离的干净 node，行为一致；
- 路径形态无关：纯 Win32 路径与 `file:///` URL、ASCII 与 CJK（经 percent-encode）均一致；
- 非虚拟桌面斗篷：`DwmGetWindowAttribute(DWMWA_CLOAKED)=0`；
- 非状态累积：`taskkill /f /im explorer.exe` 重启后依旧复现；
- 非全局 shell 故障：`Win+E` 手动开窗可见；
- 无第三方注入：IFEO（explorer.exe 键不存在）、AppInit_DLLs（空）、主 explorer 进程无非微软 DLL。

## 建议修法

主修（一行，最小改动，`dsh-native-command/lib/index.js` runner）：

```diff
 const runNativeCommand = (command, args, signal) => new Promise((resolve, reject) => {
 	execFile(command, [...args], {
 		encoding: "utf8",
 		signal,
-		windowsHide: true
+		windowsHide: command !== "explorer.exe"
 	}, (error, stdout, stderr) => {
```

理由：`windowsHide` 的价值在压制 `powershell.exe` / `wslpath` / `defaults` 等**控制台**程序闪窗，应保留；而 `explorer.exe` 是 GUI 委托调用，在 26200 上携带 `SW_HIDE` 直接导致产物窗口永久隐藏，必须豁免。

备选：给 `run` 增加逐调用 options（`run(command, args, signal, { windowsHide })`），由 `openNativePath` / `revealNativePath` 的 Windows 分支对 explorer 显式传 `windowsHide: false`——语义更显式，改动稍大。

次要建议：`openWorkspacePath` 语义上 `explorer` 退出码 1 既可能是成功也可能是静默失败，当前一律 `{opened:true}`；至少值得在文档/类型上注明"opened ≠ 可见"，或评估可校验的确认方式。

## 两种修法的对比与推荐

"备选"方案有一个实现上的坑需要指出：不能简单地"另写一个 `runVisibleCommand`、在 explorer 调用点直接换用它"——所有开窗函数都经由注入口 `const run = internals.run ?? runNativeCommand` 取 runner，包自身的确定性测试靠注入假 `run` 拦截全部 spawn；直接换专用 runner 会绕过注入口，explorer 调用就再也拦不到了。因此免隐藏的正确形态是**把选项穿透注入口**（即上面的逐调用 options）：

```js
// 1) runner 签名追加可选 options，默认值不变（已有自定义 run 不受影响）
const runNativeCommand = (command, args, signal, options = {}) => new Promise((resolve, reject) => {
  execFile(command, [...args], {
    encoding: 'utf8',
    signal,
    windowsHide: options.windowsHide ?? true,
  }, /* …envelope 不变… */)
})
// 2) revealNativePath 的 explorer 分支在调用点显式声明意图
await run('explorer.exe', ['/select,', target], signal, { windowsHide: false })
```

两案对比：

| 维度 | 主修（`command !== "explorer.exe"`） | 备选（调用点传 `{ windowsHide: false }`） |
|---|---|---|
| 决策位置 | 通用 runner 内部，靠命令名字符串匹配 | explorer 调用点，意图显式（GUI 委托不得携带 SW_HIDE） |
| 脆弱性 | 仅匹配字面量 `"explorer.exe"`，传全路径/换命令名即静默失效 | 与命令名无关，不会错配 |
| 可测试性 | `internals.run` 注入测不到该策略（真实 runner 被整体替换） | 注入的假 `run` 可直接断言收到 `windowsHide:false`，一行单测锁死 |
| 改动面 | 一行，零 API 变化 | runner 签名 + 调用点 + 注入口类型说明，约 3-4 处 |
| 兼容性 | 无影响 | 第 4 参追加且可选，向后兼容 |

推荐结论：**本地热补丁用主修**（一行手改、重装后易重打、不碰签名）；**上游正式合入建议取备选**（显式意图 + 注入口可测 + 无魔法字符串），主修可作为 reviewer 偏好最小 diff 时的等价替代。两案对 macOS/Linux 均零影响——`windowsHide` 是 libuv 的 Windows 专属选项，POSIX 路径完全忽略。

## 用户侧临时规避（已实测有效）

对本地安装的 `dsh-native-command/lib/index.js` 打上述主修热补丁并重启 `dsh web`；`dsh` 升级/重装会还原 node_modules，需重打。根因修复仍需上游合入。
