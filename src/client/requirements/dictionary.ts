/**
 * Requirements dictionaries (zh/en), prefix layers per the repos-pool
 * convention: panel./page./view./form./error./menu./delete./detail./workspace.
 *
 * Key set is mirrored verbatim into the LocaleNamespaceMap merge in
 * register.tsx — a key present here but missing there (or vice versa) is a
 * type error, which is the point: the two lists cannot drift.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'

export const REQUIREMENTS_LOCALE_NS = 'skyaxis.requirements'

interface RequirementsDictionary {
  /** Sidebar panel label and page heading. */
  readonly 'panel.title': string
  // page.*
  readonly 'page.loading': string
  readonly 'page.degraded': string
  readonly 'page.degradedBackupHint': string
  // view.*
  readonly 'view.addRequirement': string
  readonly 'view.filterPlaceholder': string
  readonly 'view.filterEmpty': string
  /** Row creation-time prefix; the timestamp itself is not copy. */
  readonly 'view.createdPrefix': string
  /** Sort control label and its two directions. */
  readonly 'view.sort': string
  readonly 'view.sortCreatedDesc': string
  readonly 'view.sortCreatedAsc': string
  // form.*
  readonly 'form.titleCreate': string
  readonly 'form.titleEdit': string
  readonly 'form.title': string
  readonly 'form.titlePlaceholder': string
  readonly 'form.description': string
  readonly 'form.descriptionPlaceholder': string
  readonly 'form.cancel': string
  readonly 'form.submit': string
  readonly 'form.submitting': string
  readonly 'form.closeLabel': string
  // error.* — copy for field/banner failures
  readonly 'error.titleRequired': string
  readonly 'error.conflict': string
  readonly 'error.network': string
  readonly 'error.unreadableFile': string
  readonly 'error.notFound': string
  readonly 'error.internal': string
  // menu.*
  readonly 'menu.edit': string
  readonly 'menu.remove': string
  // delete.* — lightweight confirm dialog copy
  readonly 'delete.title': string
  readonly 'delete.description': string
  readonly 'delete.confirm': string
  readonly 'delete.cancel': string
  // detail.* — in-panel detail view (0003 route B)
  readonly 'detail.back': string
  readonly 'detail.switch': string
  readonly 'detail.missing': string
  readonly 'detail.tab.overview': string
  readonly 'detail.tab.workspace': string
  readonly 'detail.tab.seat': string
  // workspace.* — workspace binding tab (0003 P3a)
  readonly 'workspace.setUp': string
  readonly 'workspace.emptyHint': string
  readonly 'workspace.pathLabel': string
  readonly 'workspace.browse': string
  readonly 'workspace.tagOk': string
  readonly 'workspace.tagMissing': string
  readonly 'workspace.tagUnregistered': string
  readonly 'workspace.open': string
  readonly 'workspace.unbind': string
  readonly 'workspace.unbindHint': string
  readonly 'workspace.rebind': string
  readonly 'workspace.rebindHint': string
  readonly 'workspace.invalidPath': string
  readonly 'workspace.pickerUnavailable': string
  readonly 'workspace.sectionRepos': string
  readonly 'workspace.sectionReposHint': string
  readonly 'workspace.sectionPrd': string
  readonly 'workspace.sectionPrdHint': string
  // workspace.* open-in-app split button additions (0014) — {app} is composed
  // by the caller (the prd.time* '{n}' precedent; RequirementsT has no params).
  readonly 'workspace.openInApp': string
  readonly 'workspace.openInAppMenu': string
  readonly 'workspace.openInAppFailed': string
  // openIn.app.* — dsh open-in-app catalog labels (0014): self-held product
  // names (decisions/0014 D4), zh differs from en only for the four OS
  // surface apps; ids without an entry stay invisible (the dsh filter).
  readonly 'openIn.app.finder': string
  readonly 'openIn.app.explorer': string
  readonly 'openIn.app.filemanager': string
  readonly 'openIn.app.cursor': string
  readonly 'openIn.app.vscode': string
  readonly 'openIn.app.vscodeinsiders': string
  readonly 'openIn.app.windsurf': string
  readonly 'openIn.app.zed': string
  readonly 'openIn.app.sublimetext': string
  readonly 'openIn.app.xcode': string
  readonly 'openIn.app.androidstudio': string
  readonly 'openIn.app.intellij': string
  readonly 'openIn.app.pycharm': string
  readonly 'openIn.app.webstorm': string
  readonly 'openIn.app.phpstorm': string
  readonly 'openIn.app.goland': string
  readonly 'openIn.app.rider': string
  readonly 'openIn.app.rustrover': string
  readonly 'openIn.app.fork': string
  readonly 'openIn.app.sourcetree': string
  readonly 'openIn.app.github': string
  readonly 'openIn.app.tower': string
  readonly 'openIn.app.gitkraken': string
  readonly 'openIn.app.smartgit': string
  readonly 'openIn.app.sublimemerge': string
  readonly 'openIn.app.ghostty': string
  readonly 'openIn.app.warp': string
  readonly 'openIn.app.iterm': string
  readonly 'openIn.app.kitty': string
  readonly 'openIn.app.terminal': string
  readonly 'openIn.app.windowsterminal': string
  readonly 'openIn.app.gitbash': string
  readonly 'openIn.app.gnometerminal': string
  readonly 'openIn.app.konsole': string
  // repos.* — linked repositories / clone (0003 P3b)
  readonly 'repos.add': string
  readonly 'repos.branchLabel': string
  readonly 'repos.branching': string
  readonly 'repos.cancelled': string
  readonly 'repos.cancel': string
  readonly 'repos.cloning': string
  readonly 'repos.emptyHint': string
  readonly 'repos.emptyPool': string
  readonly 'repos.errBusy': string
  readonly 'repos.errDestExists': string
  readonly 'repos.errGitMissing': string
  readonly 'repos.errInvalidBranch': string
  readonly 'repos.errNoWorkspace': string
  readonly 'repos.errTooMany': string
  readonly 'repos.failAuth': string
  readonly 'repos.failGitMissing': string
  readonly 'repos.failNetwork': string
  readonly 'repos.failedTag': string
  readonly 'repos.link': string
  readonly 'repos.menuLabel': string
  readonly 'repos.poolError': string
  readonly 'repos.reclone': string
  readonly 'repos.removeLink': string
  readonly 'repos.removeLinkHint': string
  readonly 'repos.removeTitle': string
  readonly 'repos.removeDesc': string
  readonly 'repos.removeConfirm': string
  readonly 'repos.removeCancel': string
  readonly 'repos.removedRepo': string
  readonly 'repos.selectRepo': string
  // repos.* dual-address picker additions (0005 P4) — status copy mirrors the
  // repos-pool namespace verbatim (same product, same meaning).
  readonly 'repos.recommended': string
  readonly 'repos.statusForcedAuth': string
  readonly 'repos.statusForcedNetwork': string
  readonly 'repos.statusUnverified': string
  readonly 'repos.statusVerified': string
  // repos.* reverse-link discovery (repos/ scan + adopt)
  readonly 'repos.scanTitle': string
  readonly 'repos.scanHint': string
  readonly 'repos.adopt': string
  readonly 'repos.errDestMissing': string
  readonly 'repos.errNoBranch': string
  // prd.* — PRD documents (0003 P3c)
  readonly 'prd.contentLabel': string
  readonly 'prd.create': string
  readonly 'prd.createTitle': string
  readonly 'prd.delete': string
  readonly 'prd.deleteConfirm': string
  readonly 'prd.deleteDesc': string
  readonly 'prd.deleteTitle': string
  readonly 'prd.emptyHint': string
  readonly 'prd.errDuplicate': string
  readonly 'prd.errInvalidName': string
  readonly 'prd.errNoWorkspace': string
  readonly 'prd.errTooLarge': string
  readonly 'prd.loadError': string
  readonly 'prd.manualCreate': string
  readonly 'prd.recommend': string
  readonly 'prd.uploadHint': string
  readonly 'prd.mdCopiedCode': string
  readonly 'prd.mdCopyCode': string
  readonly 'prd.mdFootnotes': string
  readonly 'prd.mdSuffixHint': string
  readonly 'prd.menuLabel': string
  readonly 'prd.nameLabel': string
  readonly 'prd.namePlaceholder': string
  readonly 'prd.preview': string
  readonly 'prd.previewFailed': string
  readonly 'prd.timeDays': string
  readonly 'prd.timeHours': string
  readonly 'prd.timeMinutes': string
  readonly 'prd.timeMonths': string
  readonly 'prd.timeNow': string
  readonly 'prd.timeYears': string
  readonly 'prd.upload': string
}

export type RequirementsT = (key: keyof RequirementsDictionary) => string

const zh: RequirementsDictionary = {
  'panel.title': '需求管理',
  'page.loading': '正在加载需求清单…',
  'page.degraded': '需求清单文件无法读取，已显示为空清单。',
  'page.degradedBackupHint': '检测到备份文件：requirements.yaml.bak。请人工检查 $DSH_HOME/skyaxis/ 下的 requirements.yaml 后恢复；文件修复前写入已被拒绝。',
  'view.addRequirement': '新增需求',
  'view.filterPlaceholder': '按标题 / 描述筛选',
  'view.filterEmpty': '没有匹配的需求。',
  'view.createdPrefix': '创建于',
  'view.sort': '排序',
  'view.sortCreatedDesc': '创建时间倒序',
  'view.sortCreatedAsc': '创建时间正序',
  'form.titleCreate': '新增需求',
  'form.titleEdit': '编辑需求',
  'form.title': '标题',
  'form.titlePlaceholder': '例如：支持多仓库并行检索',
  'form.description': '描述',
  'form.descriptionPlaceholder': '选填，一段简短说明',
  'form.cancel': '取消',
  'form.submit': '保存',
  'form.submitting': '保存中…',
  'form.closeLabel': '关闭',
  'error.titleRequired': '请输入需求标题',
  'error.conflict': '清单已在别处被修改，已自动刷新，请重试',
  'error.network': '网络错误，请稍后重试',
  'error.unreadableFile': '需求清单文件不可写（可能已损坏），请检查 requirements.yaml',
  'error.notFound': '该记录已不存在，已自动刷新清单',
  'error.internal': '服务内部错误',
  'menu.edit': '编辑',
  'menu.remove': '删除',
  'delete.title': '删除需求',
  // 归档口径（decisions/0005 D6 连带）：产物在用户不可见的 $DSH_HOME 深处，
  // 「仅移除记录」的旧句暗示文件还可找到，对 workbench 产物失真。
  'delete.description': '确定要删除该需求吗？清单记录与 AI 工作台产物（计划文档、评审报告等）将一并归档至 .trash 目录，继续占用磁盘空间，可手动找回。',
  'delete.confirm': '删除',
  'delete.cancel': '取消',
  'detail.back': '返回',
  'detail.switch': '切换需求',
  'detail.missing': '该需求已不存在。',
  'detail.tab.overview': '概览',
  'detail.tab.workspace': '工作区',
  'detail.tab.seat': '功能规划中，此页预留。',
  'workspace.setUp': '设置工作区目录',
  'workspace.emptyHint': '为该需求设置一个工作区目录，关联仓库与 PRD 文档将落位其中。',
  'workspace.pathLabel': '工作区目录',
  'workspace.browse': '选择目录…',
  'workspace.tagOk': '正常',
  'workspace.tagMissing': '目录缺失',
  'workspace.tagUnregistered': '未注册',
  'workspace.open': '打开',
  'workspace.unbind': '解绑',
  'workspace.unbindHint': '解绑不会删除磁盘上的文件',
  'workspace.rebind': '重新注册',
  'workspace.rebindHint': '在宿主工作区列表中重建此目录的注册',
  'workspace.invalidPath': '路径无效：请输入绝对路径，且不能指向普通文件',
  'workspace.pickerUnavailable': '当前后端不支持目录选择',
  'workspace.sectionRepos': '关联仓库',
  'workspace.sectionReposHint': '设置工作区后可用。',
  'workspace.sectionPrd': 'PRD 文档',
  'workspace.sectionPrdHint': '设置工作区后可用。',
  'workspace.openInApp': '在 {app} 中打开',
  'workspace.openInAppMenu': '选择打开方式',
  'workspace.openInAppFailed': '打开失败',
  'openIn.app.finder': '访达',
  'openIn.app.explorer': '文件资源管理器',
  'openIn.app.filemanager': '文件管理器',
  'openIn.app.cursor': 'Cursor',
  'openIn.app.vscode': 'VS Code',
  'openIn.app.vscodeinsiders': 'VS Code Insiders',
  'openIn.app.windsurf': 'Windsurf',
  'openIn.app.zed': 'Zed',
  'openIn.app.sublimetext': 'Sublime Text',
  'openIn.app.xcode': 'Xcode',
  'openIn.app.androidstudio': 'Android Studio',
  'openIn.app.intellij': 'IntelliJ IDEA',
  'openIn.app.pycharm': 'PyCharm',
  'openIn.app.webstorm': 'WebStorm',
  'openIn.app.phpstorm': 'PhpStorm',
  'openIn.app.goland': 'GoLand',
  'openIn.app.rider': 'Rider',
  'openIn.app.rustrover': 'RustRover',
  'openIn.app.fork': 'Fork',
  'openIn.app.sourcetree': 'Sourcetree',
  'openIn.app.github': 'GitHub Desktop',
  'openIn.app.tower': 'Tower',
  'openIn.app.gitkraken': 'GitKraken',
  'openIn.app.smartgit': 'SmartGit',
  'openIn.app.sublimemerge': 'Sublime Merge',
  'openIn.app.ghostty': 'Ghostty',
  'openIn.app.warp': 'Warp',
  'openIn.app.iterm': 'iTerm2',
  'openIn.app.kitty': 'kitty',
  'openIn.app.terminal': '终端',
  'openIn.app.windowsterminal': 'Windows Terminal',
  'openIn.app.gitbash': 'Git Bash',
  'openIn.app.gnometerminal': 'GNOME Terminal',
  'openIn.app.konsole': 'Konsole',
  'repos.add': "从仓库池添加",
  'repos.branchLabel': "分支名",
  'repos.branching': "创建分支中",
  'repos.cancelled': "已取消",
  'repos.cancel': "取消克隆",
  'repos.cloning': "克隆中",
  'repos.emptyHint': "从仓库池选择一个仓库，clone 到工作区 repos/ 目录。",
  'repos.emptyPool': "仓库池为空，请先在仓库池面板添加仓库",
  'repos.errBusy': "该仓库正在克隆中",
  'repos.errDestExists': "目标目录已存在",
  'repos.errGitMissing': "宿主未安装 git",
  'repos.errInvalidBranch': "分支名不合法",
  'repos.errNoWorkspace': "请先设置工作区目录",
  'repos.errTooMany': "并发克隆数已达上限，请稍后再试",
  'repos.failAuth': "认证失败（凭证缺失或权限不足）",
  'repos.failGitMissing': "宿主未安装 git",
  'repos.failNetwork': "网络错误（无法连接或超时）",
  'repos.failedTag': "克隆失败",
  'repos.link': "关联并克隆",
  'repos.menuLabel': "仓库操作",
  'repos.poolError': "仓库池加载失败",
  'repos.reclone': "重新 clone",
  'repos.removeLink': "移除关联",
  'repos.removeLinkHint': "移除关联不会删除已 clone 的目录",
  'repos.removeTitle': "移除关联",
  'repos.removeDesc': "将移除该关联，并删除工作区 repos/ 目录下已克隆的源码。",
  'repos.removeConfirm': "移除",
  'repos.removeCancel': "取消",
  'repos.removedRepo': "已移除的仓库",
  'repos.selectRepo': "选择仓库",
  'repos.recommended': "推荐",
  'repos.statusForcedAuth': "已保存（无权限）",
  'repos.statusForcedNetwork': "已保存（网络不可达）",
  'repos.statusUnverified': "未验证",
  'repos.statusVerified': "已验证",
  'repos.scanTitle': "发现可关联的仓库",
  'repos.scanHint': "工作区 repos/ 目录中检测到已克隆但未关联的仓库，关联不会重新克隆。",
  'repos.adopt': "关联",
  'repos.errDestMissing': "目录已不存在，请刷新页面后重试",
  'repos.errNoBranch': "无法读取分支（非 git 仓库或 detached HEAD）",
  'prd.contentLabel': '内容',
  'prd.create': '新建文档',
  'prd.createTitle': '新建文档',
  'prd.delete': '删除',
  'prd.deleteConfirm': '删除',
  'prd.deleteDesc': '将从磁盘删除该文件，此操作不可恢复。',
  'prd.deleteTitle': '删除文档',
  'prd.emptyHint': '上传任意文件或新建 Markdown 文档，保存在工作区 prds/ 目录。',
  'prd.errDuplicate': '同名文件已存在',
  'prd.errInvalidName': '文件名无效',
  'prd.errNoWorkspace': '请先设置工作区目录',
  'prd.errTooLarge': '文件超过 32MB 上限',
  'prd.loadError': 'PRD 清单加载失败',
  'prd.manualCreate': '手动创建',
  'prd.recommend': '推荐',
  'prd.uploadHint': '点击选择文件，支持任意类型（≤32MB）',
  'prd.mdCopiedCode': '已复制',
  'prd.mdCopyCode': '复制代码',
  'prd.mdFootnotes': '脚注',
  'prd.mdSuffixHint': '未以 .md 结尾时将自动补上 .md',
  'prd.menuLabel': '文档操作',
  'prd.nameLabel': '文件名',
  'prd.namePlaceholder': '例如：搜索方案',
  'prd.preview': '预览',
  'prd.previewFailed': '预览加载失败',
  'prd.timeDays': '{n} 天前',
  'prd.timeHours': '{n} 小时前',
  'prd.timeMinutes': '{n} 分钟前',
  'prd.timeMonths': '{n} 个月前',
  'prd.timeNow': '刚刚',
  'prd.timeYears': '{n} 年前',
  'prd.upload': '上传文件',
}

const en: RequirementsDictionary = {
  'panel.title': 'Requirements',
  'page.loading': 'Loading requirements…',
  'page.degraded': 'The requirement list file could not be read; an empty list is shown.',
  'page.degradedBackupHint': 'A backup file was found: requirements.yaml.bak. Inspect $DSH_HOME/skyaxis/requirements.yaml manually and restore it; writes stay rejected until the file is fixed.',
  'view.addRequirement': 'New requirement',
  'view.filterPlaceholder': 'Filter by title / description',
  'view.filterEmpty': 'No matching requirements.',
  'view.createdPrefix': 'created',
  'view.sort': 'Sort',
  'view.sortCreatedDesc': 'Newest first',
  'view.sortCreatedAsc': 'Oldest first',
  'form.titleCreate': 'New requirement',
  'form.titleEdit': 'Edit requirement',
  'form.title': 'Title',
  'form.titlePlaceholder': 'e.g. Support parallel search across repositories',
  'form.description': 'Description',
  'form.descriptionPlaceholder': 'Optional, a short note',
  'form.cancel': 'Cancel',
  'form.submit': 'Save',
  'form.submitting': 'Saving…',
  'form.closeLabel': 'Close',
  'error.titleRequired': 'A requirement title is required',
  'error.conflict': 'The list was modified elsewhere; it has been refreshed — please retry',
  'error.network': 'Network error, please retry later',
  'error.unreadableFile': 'The requirement list file is not writable (possibly corrupted); check requirements.yaml',
  'error.notFound': 'The record no longer exists; the list has been refreshed',
  'error.internal': 'Internal service error',
  'menu.edit': 'Edit',
  'menu.remove': 'Remove',
  'delete.title': 'Remove requirement',
  'delete.description': 'Remove this requirement? The list entry and its AI workbench artifacts (plan documents, review reports) are archived into the .trash directory together — they keep occupying disk space and can be restored by hand.',
  'delete.confirm': 'Remove',
  'delete.cancel': 'Cancel',
  'detail.back': 'Back',
  'detail.switch': 'Switch requirement',
  'detail.missing': 'This requirement no longer exists.',
  'detail.tab.overview': 'Overview',
  'detail.tab.workspace': 'Workspace',
  'detail.tab.seat': 'A planned feature will land here.',
  'workspace.setUp': 'Set workspace directory',
  'workspace.emptyHint': 'Set a directory for this requirement; linked repositories and PRD documents will live inside.',
  'workspace.pathLabel': 'Workspace directory',
  'workspace.browse': 'Browse…',
  'workspace.tagOk': 'OK',
  'workspace.tagMissing': 'Directory missing',
  'workspace.tagUnregistered': 'Unregistered',
  'workspace.open': 'Open',
  'workspace.unbind': 'Unbind',
  'workspace.unbindHint': 'Unbinding never deletes files on disk',
  'workspace.rebind': 'Re-register',
  'workspace.rebindHint': 'Recreate this directory\'s registration in the host workspace list',
  'workspace.invalidPath': 'Invalid path: an absolute directory path is required',
  'workspace.pickerUnavailable': 'Directory picking is unavailable on this backend',
  'workspace.sectionRepos': 'Linked repositories',
  'workspace.sectionReposHint': 'Available after a workspace is set.',
  'workspace.sectionPrd': 'PRD documents',
  'workspace.sectionPrdHint': 'Available after a workspace is set.',
  'workspace.openInApp': 'Open in {app}',
  'workspace.openInAppMenu': 'Choose an app to open in',
  'workspace.openInAppFailed': 'Failed to open',
  'openIn.app.finder': 'Finder',
  'openIn.app.explorer': 'File Explorer',
  'openIn.app.filemanager': 'Files',
  'openIn.app.cursor': 'Cursor',
  'openIn.app.vscode': 'VS Code',
  'openIn.app.vscodeinsiders': 'VS Code Insiders',
  'openIn.app.windsurf': 'Windsurf',
  'openIn.app.zed': 'Zed',
  'openIn.app.sublimetext': 'Sublime Text',
  'openIn.app.xcode': 'Xcode',
  'openIn.app.androidstudio': 'Android Studio',
  'openIn.app.intellij': 'IntelliJ IDEA',
  'openIn.app.pycharm': 'PyCharm',
  'openIn.app.webstorm': 'WebStorm',
  'openIn.app.phpstorm': 'PhpStorm',
  'openIn.app.goland': 'GoLand',
  'openIn.app.rider': 'Rider',
  'openIn.app.rustrover': 'RustRover',
  'openIn.app.fork': 'Fork',
  'openIn.app.sourcetree': 'Sourcetree',
  'openIn.app.github': 'GitHub Desktop',
  'openIn.app.tower': 'Tower',
  'openIn.app.gitkraken': 'GitKraken',
  'openIn.app.smartgit': 'SmartGit',
  'openIn.app.sublimemerge': 'Sublime Merge',
  'openIn.app.ghostty': 'Ghostty',
  'openIn.app.warp': 'Warp',
  'openIn.app.iterm': 'iTerm2',
  'openIn.app.kitty': 'kitty',
  'openIn.app.terminal': 'Terminal',
  'openIn.app.windowsterminal': 'Windows Terminal',
  'openIn.app.gitbash': 'Git Bash',
  'openIn.app.gnometerminal': 'GNOME Terminal',
  'openIn.app.konsole': 'Konsole',
  'repos.add': "Add from repo pool",
  'repos.branchLabel': "Branch name",
  'repos.branching': "Creating branch",
  'repos.cancelled': "Cancelled",
  'repos.cancel': "Cancel clone",
  'repos.cloning': "Cloning",
  'repos.emptyHint': "Pick a repository from the pool; it will be cloned into the workspace repos/ directory.",
  'repos.emptyPool': "The repo pool is empty; add repositories in the repo pool panel first",
  'repos.errBusy': "This repository is already cloning",
  'repos.errDestExists': "Target directory already exists",
  'repos.errGitMissing': "git is not installed on the host",
  'repos.errInvalidBranch': "Invalid branch name",
  'repos.errNoWorkspace': "Set a workspace directory first",
  'repos.errTooMany': "Too many concurrent clones; retry later",
  'repos.failAuth': "Authentication failed (missing credentials or no access)",
  'repos.failGitMissing': "git is not installed on the host",
  'repos.failNetwork': "Network error (unreachable or timed out)",
  'repos.failedTag': "Clone failed",
  'repos.link': "Link and clone",
  'repos.menuLabel': "Repository actions",
  'repos.poolError': "Failed to load the repo pool",
  'repos.reclone': "Re-clone",
  'repos.removeLink': "Remove link",
  'repos.removeLinkHint': "Removing the link never deletes the cloned directory",
  'repos.removeTitle': "Remove link",
  'repos.removeDesc': "Removes the link AND deletes the cloned source under the workspace repos/ directory.",
  'repos.removeConfirm': "Remove",
  'repos.removeCancel': "Cancel",
  'repos.removedRepo': "Removed repository",
  'repos.selectRepo': "Select a repository",
  'repos.recommended': "Recommended",
  'repos.statusForcedAuth': "Saved (no access)",
  'repos.statusForcedNetwork': "Saved (unreachable)",
  'repos.statusUnverified': "Unverified",
  'repos.statusVerified': "Verified",
  'repos.scanTitle': "Discovered repositories",
  'repos.scanHint': "Cloned but unlinked repositories were found under the workspace repos/ directory; linking does not re-clone.",
  'repos.adopt': "Link",
  'repos.errDestMissing': "The directory no longer exists; refresh the page and retry",
  'repos.errNoBranch': "Cannot read the branch (not a git repository, or detached HEAD)",
  'prd.contentLabel': 'Content',
  'prd.create': 'New document',
  'prd.createTitle': 'New document',
  'prd.delete': 'Delete',
  'prd.deleteConfirm': 'Delete',
  'prd.deleteDesc': 'The file will be deleted from disk; this cannot be undone.',
  'prd.deleteTitle': 'Delete document',
  'prd.emptyHint': 'Upload any file or create Markdown; files live in the workspace prds/ directory.',
  'prd.errDuplicate': 'A file with this name already exists',
  'prd.errInvalidName': 'Invalid file name',
  'prd.errNoWorkspace': 'Set a workspace directory first',
  'prd.errTooLarge': 'The file exceeds the 32MB limit',
  'prd.loadError': 'Failed to load PRD documents',
  'prd.manualCreate': 'Create manually',
  'prd.recommend': 'Recommended',
  'prd.uploadHint': 'Click to pick a file, any type (≤32MB)',
  'prd.mdCopiedCode': 'Copied',
  'prd.mdCopyCode': 'Copy code',
  'prd.mdFootnotes': 'Footnotes',
  'prd.mdSuffixHint': 'A .md suffix is appended when missing',
  'prd.menuLabel': 'Document actions',
  'prd.nameLabel': 'File name',
  'prd.namePlaceholder': 'e.g. search-notes',
  'prd.preview': 'Preview',
  'prd.previewFailed': 'Failed to load preview',
  'prd.timeDays': '{n}d ago',
  'prd.timeHours': '{n}h ago',
  'prd.timeMinutes': '{n}m ago',
  'prd.timeMonths': '{n}mo ago',
  'prd.timeNow': 'just now',
  'prd.timeYears': '{n}y ago',
  'prd.upload': 'Upload a file',
}

export function registerRequirementsDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REQUIREMENTS_LOCALE_NS, { zh, en }),
    'skyaxis.requirements: dictionaries',
  )
}
