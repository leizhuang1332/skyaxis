/**
 * Repos-pool dictionaries (zh/en).
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
  /** Empty-state copy while the list is a P1 placeholder. */
  readonly 'page.empty': string
}

export type ReposPoolT = (key: keyof ReposPoolDictionary) => string

const zh: ReposPoolDictionary = {
  'panel.title': '仓库池',
  'page.empty': '尚未添加任何仓库。仓库清单管理将在下一阶段就绪。',
}

const en: ReposPoolDictionary = {
  'panel.title': 'Repos Pool',
  'page.empty': 'No repositories yet. Repository management arrives in the next phase.',
}

export function registerReposPoolDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(REPOS_POOL_LOCALE_NS, { zh, en }),
    'skyaxis.reposPool: dictionaries',
  )
}
