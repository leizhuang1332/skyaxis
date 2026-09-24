/**
 * Repos-pool slot registration (P1 skeleton).
 *
 * Paired registration: the page rides the `main` keyed slot under key
 * 'repos-pool'; the sidebar button rides `sidebar.panellist` under the SAME
 * id — the host layout controller dispatches central panels by that id
 * (selectPanel(id) → renderSlot('main', {}, { entryKey: id })), and a
 * mismatch throws at click time. `main.conversation` itself is never
 * touched: it is a single slot occupied by the shipped ConversationRoot.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { REPOS_POOL_LOCALE_NS, registerReposPoolDictionaries, type ReposPoolT } from './dictionary.js'
import { ReposPoolIcon, ReposPoolPage } from './view.js'

/** Paired main-key / panellist-id — the two must stay identical. */
export const REPOS_POOL_PANEL_ID = 'repos-pool'

/** List-slot order; the slot currently has zero shipped occupants. */
export const REPOS_POOL_PANEL_ORDER = 100

/**
 * Registration options as builders so production wiring and tests share one
 * definition (tests assert the SlotCore projections these produce).
 */
export const reposPoolMainOptions = () =>
  ({ name: 'main', key: REPOS_POOL_PANEL_ID }) as const

export const reposPoolPanelOptions = (t: ReposPoolT) =>
  ({
    name: 'sidebar.panellist',
    id: REPOS_POOL_PANEL_ID,
    order: REPOS_POOL_PANEL_ORDER,
    label: () => t('panel.title'),
  }) as const

export function registerReposPoolView(ctx: Context): () => void {
  registerReposPoolDictionaries(ctx)
  const t = ctx.locale.bind(REPOS_POOL_LOCALE_NS)

  const disposeMain = ctx.slots.inject('main', () =>
    ctx.slots.register(reposPoolMainOptions(), (): ReactNode => <ReposPoolPage t={t} />))

  const disposePanel = ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(reposPoolPanelOptions(t), ReposPoolIcon))

  return () => {
    disposePanel()
    disposeMain()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    reposPoolView?: never
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'main': { kind: 'keyed'; scope: 'root' }
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: { size: number; active: boolean } }
  }
  interface LocaleNamespaceMap {
    'skyaxis.reposPool': 'panel.title' | 'page.empty'
  }
}
