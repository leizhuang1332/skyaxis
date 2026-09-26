/**
 * Requirements dictionaries (zh/en), prefix layers per the repos-pool
 * convention: panel./page./view./form./error./menu./delete./detail.
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
  readonly 'detail.tab.placeholder': string
  readonly 'detail.tab.seat': string
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
  'detail.tab.placeholder': '占位',
  'detail.tab.seat': '功能规划中，此页预留。',
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
  'detail.tab.placeholder': 'Placeholder',
  'detail.tab.seat': 'A planned feature will land here.',
}

export function registerRequirementsDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REQUIREMENTS_LOCALE_NS, { zh, en }),
    'skyaxis.requirements: dictionaries',
  )
}
