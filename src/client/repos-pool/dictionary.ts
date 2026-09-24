/**
 * Repos-pool dictionaries (zh/en), four-prefix layers per the task-graph
 * convention: panel./page./view./form./error./status./risk./menu.
 *
 * Key set is mirrored verbatim into the LocaleNamespaceMap merge in
 * register.tsx — a key present here but missing there (or vice versa) is a
 * type error, which is the point: the two lists cannot drift.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'

export const REPOS_POOL_LOCALE_NS = 'skyaxis.reposPool'

interface ReposPoolDictionary {
  /** Sidebar panel label and page heading. */
  readonly 'panel.title': string
  // page.*
  readonly 'page.empty': string
  readonly 'page.loading': string
  readonly 'page.degraded': string
  readonly 'page.degradedBackupHint': string
  // view.*
  readonly 'view.addRepo': string
  readonly 'view.filterPlaceholder': string
  readonly 'view.filterEmpty': string
  // form.*
  readonly 'form.titleCreate': string
  readonly 'form.titleEdit': string
  readonly 'form.name': string
  readonly 'form.namePlaceholder': string
  readonly 'form.url': string
  readonly 'form.urlPlaceholder': string
  readonly 'form.description': string
  readonly 'form.descriptionPlaceholder': string
  readonly 'form.cancel': string
  readonly 'form.submit': string
  readonly 'form.submitting': string
  readonly 'form.closeLabel': string
  readonly 'form.validating': string
  readonly 'form.validateOk': string
  readonly 'form.validateUnverified': string
  readonly 'form.validateSkipped': string
  // error.* — copy for field/banner failures
  readonly 'error.nameRequired': string
  readonly 'error.urlRequired': string
  readonly 'error.invalidUrl': string
  readonly 'error.unknownReachability': string
  readonly 'error.duplicateUrl': string
  readonly 'error.conflict': string
  readonly 'error.network': string
  readonly 'error.unreadableFile': string
  readonly 'error.notFound': string
  readonly 'error.internal': string
  // error.url* — rejection-reason specifics
  readonly 'error.urlEmpty': string
  readonly 'error.urlTooLong': string
  readonly 'error.urlSchemeForbidden': string
  readonly 'error.urlLocalPath': string
  readonly 'error.urlScpAmbiguous': string
  readonly 'error.urlCredentials': string
  readonly 'error.urlMalformed': string
  // status.* — persisted RepoStatus labels
  readonly 'status.verified': string
  readonly 'status.unverified': string
  readonly 'status.forcedNetwork': string
  readonly 'status.forcedAuth': string
  // risk.* — RiskConfirmation copy (label props are all required)
  readonly 'risk.titleNetwork': string
  readonly 'risk.titleAuth': string
  readonly 'risk.titleUnknown': string
  readonly 'risk.descriptionNetwork': string
  readonly 'risk.descriptionAuth': string
  readonly 'risk.descriptionUnknown': string
  readonly 'risk.acknowledge': string
  readonly 'risk.confirm': string
  readonly 'risk.cancel': string
  readonly 'risk.closeLabel': string
  // menu.*
  readonly 'menu.edit': string
  readonly 'menu.remove': string
}

export type ReposPoolT = (key: keyof ReposPoolDictionary) => string

const zh: ReposPoolDictionary = {
  'panel.title': '仓库池',
  'page.empty': '尚未添加任何仓库。点击右上角「添加仓库」开始。',
  'page.loading': '正在加载仓库清单…',
  'page.degraded': '仓库清单文件无法读取，已显示为空清单。',
  'page.degradedBackupHint': '检测到备份文件：repos.yaml.bak。请人工检查 $DSH_HOME/skyaxis/ 下的 repos.yaml 后恢复；文件修复前写入已被拒绝。',
  'view.addRepo': '添加仓库',
  'view.filterPlaceholder': '按名称 / 地址 / 简介筛选',
  'view.filterEmpty': '没有匹配的仓库。',
  'form.titleCreate': '添加仓库',
  'form.titleEdit': '编辑仓库',
  'form.name': '名称',
  'form.namePlaceholder': '例如：chinese-poetry',
  'form.url': '仓库地址',
  'form.urlPlaceholder': '例如：https://github.com/org/repo.git',
  'form.description': '简介',
  'form.descriptionPlaceholder': '选填，一段简短说明',
  'form.cancel': '取消',
  'form.submit': '保存',
  'form.submitting': '保存中…',
  'form.closeLabel': '关闭',
  'form.validating': '正在校验仓库地址…',
  'form.validateOk': '仓库可达',
  'form.validateUnverified': '已跳过可达性校验（未检测到 git 或校验服务不可用）',
  'form.validateSkipped': '地址未变化，沿用上次校验结果',
  'error.nameRequired': '请输入仓库名称',
  'error.urlRequired': '请输入仓库地址',
  'error.invalidUrl': '仓库地址不合法',
  'error.unknownReachability': '无法确认仓库可达性（原因不明），已拒绝保存',
  'error.duplicateUrl': '该仓库地址已存在于清单中',
  'error.conflict': '清单已在别处被修改，已自动刷新，请重试',
  'error.network': '网络错误，请稍后重试',
  'error.unreadableFile': '仓库清单文件不可写（可能已损坏），请检查 repos.yaml',
  'error.notFound': '该记录已不存在，已自动刷新清单',
  'error.internal': '服务内部错误',
  'error.urlEmpty': '地址为空',
  'error.urlTooLong': '地址过长（上限 2048 字符）',
  'error.urlSchemeForbidden': '协议不在允许范围（仅 https / http / ssh / scp）',
  'error.urlLocalPath': '不能使用本地路径',
  'error.urlScpAmbiguous': '无法区分主机名与本地路径，请使用完整 ssh:// 或 https:// 地址',
  'error.urlCredentials': '地址内嵌了账号凭据，请改用凭据管理而非 URL 保存密码',
  'error.urlMalformed': '地址格式无法解析',
  'status.verified': '已验证',
  'status.unverified': '未验证',
  'status.forcedNetwork': '已保存（网络不可达）',
  'status.forcedAuth': '已保存（无权限）',
  'risk.titleNetwork': '仓库当前不可达',
  'risk.titleAuth': '暂无该仓库的访问权限',
  'risk.titleUnknown': '无法确认仓库可达性',
  'risk.descriptionNetwork': '可达性校验报告网络不可达。如果你确认该地址正确（例如目标在内网、需要代理或稍后才可达），可以仍然保存。',
  'risk.descriptionAuth': '可达性校验报告需要认证/权限。如果你稍后会配置凭据，可以仍然保存。',
  'risk.descriptionUnknown': '可达性校验返回了无法归类的原因（例如 ssh 主机密钥校验失败等环境因素）。如果你确认该地址正确，可以仍然保存。',
  'risk.acknowledge': '我了解该仓库当前无法访问',
  'risk.confirm': '仍要保存',
  'risk.cancel': '返回修改',
  'risk.closeLabel': '关闭',
  'menu.edit': '编辑',
  'menu.remove': '删除',
}

const en: ReposPoolDictionary = {
  'panel.title': 'Repos Pool',
  'page.empty': 'No repositories yet. Use “Add repository” in the top-right corner to start.',
  'page.loading': 'Loading repositories…',
  'page.degraded': 'The repository list file could not be read; an empty list is shown.',
  'page.degradedBackupHint': 'A backup file was found: repos.yaml.bak. Inspect $DSH_HOME/skyaxis/repos.yaml manually and restore it; writes stay rejected until the file is fixed.',
  'view.addRepo': 'Add repository',
  'view.filterPlaceholder': 'Filter by name / URL / description',
  'view.filterEmpty': 'No matching repositories.',
  'form.titleCreate': 'Add repository',
  'form.titleEdit': 'Edit repository',
  'form.name': 'Name',
  'form.namePlaceholder': 'e.g. chinese-poetry',
  'form.url': 'Repository URL',
  'form.urlPlaceholder': 'e.g. https://github.com/org/repo.git',
  'form.description': 'Description',
  'form.descriptionPlaceholder': 'Optional, a short note',
  'form.cancel': 'Cancel',
  'form.submit': 'Save',
  'form.submitting': 'Saving…',
  'form.closeLabel': 'Close',
  'form.validating': 'Validating repository URL…',
  'form.validateOk': 'Repository is reachable',
  'form.validateUnverified': 'Reachability check skipped (git not found or validation service unavailable)',
  'form.validateSkipped': 'URL unchanged; keeping the previous validation result',
  'error.nameRequired': 'A repository name is required',
  'error.urlRequired': 'A repository URL is required',
  'error.invalidUrl': 'The repository URL is not acceptable',
  'error.unknownReachability': 'Reachability could not be determined (unknown cause); saving was rejected',
  'error.duplicateUrl': 'This URL is already in the list',
  'error.conflict': 'The list was modified elsewhere; it has been refreshed — please retry',
  'error.network': 'Network error, please retry later',
  'error.unreadableFile': 'The repository list file is not writable (possibly corrupted); check repos.yaml',
  'error.notFound': 'The record no longer exists; the list has been refreshed',
  'error.internal': 'Internal service error',
  'error.urlEmpty': 'The URL is empty',
  'error.urlTooLong': 'The URL exceeds 2048 characters',
  'error.urlSchemeForbidden': 'Scheme not allowed (only https / http / ssh / scp)',
  'error.urlLocalPath': 'Local paths are not accepted',
  'error.urlScpAmbiguous': 'Cannot tell a hostname from a local path; use a full ssh:// or https:// URL',
  'error.urlCredentials': 'Credentials embedded in the URL; use a credential store instead of a password in the URL',
  'error.urlMalformed': 'The URL cannot be parsed',
  'status.verified': 'Verified',
  'status.unverified': 'Unverified',
  'status.forcedNetwork': 'Saved (unreachable)',
  'status.forcedAuth': 'Saved (no access)',
  'risk.titleNetwork': 'Repository is currently unreachable',
  'risk.titleAuth': 'No access to this repository',
  'risk.titleUnknown': 'Reachability could not be determined',
  'risk.descriptionNetwork': 'The reachability check reports a network failure. If you are sure the URL is correct (intranet target, proxy needed, reachable later), you can still save it.',
  'risk.descriptionAuth': 'The reachability check reports that authentication is required. If you will configure credentials later, you can still save it.',
  'risk.descriptionUnknown': 'The reachability check returned an unclassified cause (e.g. an ssh host-key verification failure in the probing environment). If you are sure the URL is correct, you can still save it.',
  'risk.acknowledge': 'I understand this repository is not currently accessible',
  'risk.confirm': 'Save anyway',
  'risk.cancel': 'Back to the form',
  'risk.closeLabel': 'Close',
  'menu.edit': 'Edit',
  'menu.remove': 'Remove',
}

export function registerReposPoolDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REPOS_POOL_LOCALE_NS, { zh, en }),
    'skyaxis.reposPool: dictionaries',
  )
}
