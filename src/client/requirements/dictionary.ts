/**
 * Requirements dictionaries (zh/en).
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
  /** Empty-state copy while the list is a P1 placeholder. */
  readonly 'page.empty': string
}

export type RequirementsT = (key: keyof RequirementsDictionary) => string

const zh: RequirementsDictionary = {
  'panel.title': '需求管理',
  'page.empty': '暂无需求。需求管理将在下一阶段就绪。',
}

const en: RequirementsDictionary = {
  'panel.title': 'Requirements',
  'page.empty': 'No requirements yet. Requirement management arrives in the next phase.',
}

export function registerRequirementsDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REQUIREMENTS_LOCALE_NS, { zh, en }),
    'skyaxis.requirements: dictionaries',
  )
}
