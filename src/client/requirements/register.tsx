/**
 * Requirements slot registration.
 *
 * Paired registration: the page rides the `main` keyed slot under key
 * 'requirements'; the sidebar button rides `sidebar.panellist` under the
 * SAME id — the host layout controller dispatches central panels by that id
 * (selectPanel(id) → renderSlot('main', {}, { entryKey: id })), and a
 * mismatch throws at click time. `main.conversation` itself is never
 * touched: it is a single slot occupied by the shipped ConversationRoot.
 *
 * Data wiring follows the repos-pool closure pattern: store/controller/
 * fetcher are created here, captured by the page component, and destroyed
 * with the apply disposer.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { REQUIREMENTS_LOCALE_NS, registerRequirementsDictionaries, type RequirementsT } from './dictionary.js'
import { createRequirementsController } from './controller.js'
import { createRequirementsFetcher } from './fetcher.js'
import { RequirementsIcon, RequirementsPage } from './view.js'
import { createRequirementsStore } from './store.js'

/** Paired main-key / panellist-id — the two must stay identical. */
export const REQUIREMENTS_PANEL_ID = 'requirements'

/** List-slot order; seated after the repos-pool occupant (order 100). */
export const REQUIREMENTS_PANEL_ORDER = 110

/**
 * Registration options as builders so production wiring and tests share one
 * definition (tests assert the SlotCore projections these produce).
 */
export const requirementsMainOptions = () =>
  ({ name: 'main', key: REQUIREMENTS_PANEL_ID }) as const

export const requirementsPanelOptions = (t: RequirementsT) =>
  ({
    name: 'sidebar.panellist',
    id: REQUIREMENTS_PANEL_ID,
    order: REQUIREMENTS_PANEL_ORDER,
    label: () => t('panel.title'),
  }) as const

export function registerRequirementsView(ctx: Context): () => void {
  registerRequirementsDictionaries(ctx)
  const t = ctx.locale.bind(REQUIREMENTS_LOCALE_NS)

  const fetcher = createRequirementsFetcher()
  const store = createRequirementsStore()
  const controller = createRequirementsController(store, fetcher)

  const disposeMain = ctx.slots.inject('main', () =>
    ctx.slots.register(requirementsMainOptions(), (): ReactNode => (
      <RequirementsPage t={t satisfies RequirementsT} store={store} controller={controller} />
    )))

  const disposePanel = ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(requirementsPanelOptions(t), RequirementsIcon))

  return () => {
    disposePanel()
    disposeMain()
    controller.dispose()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    requirementsView?: never
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'main': { kind: 'keyed'; scope: 'root' }
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: { size: number; active: boolean } }
  }
  interface LocaleNamespaceMap {
    'skyaxis.requirements':
      | 'panel.title'
      | 'page.empty'
      | 'page.loading'
      | 'page.degraded'
      | 'page.degradedBackupHint'
      | 'view.addRequirement'
      | 'form.titleCreate'
      | 'form.titleEdit'
      | 'form.title'
      | 'form.titlePlaceholder'
      | 'form.description'
      | 'form.descriptionPlaceholder'
      | 'form.cancel'
      | 'form.submit'
      | 'form.submitting'
      | 'form.closeLabel'
      | 'error.titleRequired'
      | 'error.conflict'
      | 'error.network'
      | 'error.unreadableFile'
      | 'error.notFound'
      | 'error.internal'
      | 'menu.edit'
      | 'menu.remove'
  }
}
