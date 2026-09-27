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
  'delete.description': '确定要删除该需求吗？此操作仅移除清单记录。',
  'delete.confirm': '删除',
  'delete.cancel': '取消',
  'detail.back': '返回',
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
  'workspace.sectionReposHint': '设置工作区后可用（即将上线）。',
  'workspace.sectionPrd': 'PRD 文档',
  'workspace.sectionPrdHint': '设置工作区后可用（即将上线）。',
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
}

const en: RequirementsDictionary = {
  'panel.title': 'Requirements',
  'page.loading': 'Loading requirements…',
  'page.degraded': 'The requirement list file could not be read; an empty list is shown.',
  'page.degradedBackupHint': 'A backup file was found: requirements.yaml.bak. Inspect $DSH_HOME/skyaxis/requirements.yaml manually and restore it; writes stay rejected until the file is fixed.',
  'view.addRequirement': 'New requirement',
  'view.filterPlaceholder': 'Filter by title / description',
  'view.filterEmpty': 'No matching requirements.',
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
  'delete.description': 'Remove this requirement from the list? Only the list entry is deleted.',
  'delete.confirm': 'Remove',
  'delete.cancel': 'Cancel',
  'detail.back': 'Back',
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
  'workspace.sectionReposHint': 'Available after a workspace is set (coming soon).',
  'workspace.sectionPrd': 'PRD documents',
  'workspace.sectionPrdHint': 'Available after a workspace is set (coming soon).',
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
}

export function registerRequirementsDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REQUIREMENTS_LOCALE_NS, { zh, en }),
    'skyaxis.requirements: dictionaries',
  )
}
