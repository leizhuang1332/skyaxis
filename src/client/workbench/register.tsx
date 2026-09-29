/**
 * Workbench slot registration (0006 P1b): the AI workbench seat, migrated
 * out of the requirements module into its own (research 0006 §6.4).
 *
 * Injects into the requirements detail tab ledger slot
 * ('requirements.detail.view', declared by the requirements register's
 * SlotMap merge) as id 'aiWorkbench' / order 40 — tab-row last (overview 10 /
 * workspace 30 / aiWorkbench 40). Data wiring follows the repos-pool closure
 * pattern: fetcher/store/controller are created here, captured by the seat,
 * and destroyed with the apply disposer — the store survives keyed-main-slot
 * round-trips (no keep-alive), so coming back to the tab re-renders the last
 * snapshot instantly while a revalidation runs (SWR anti-flash).
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { WORKBENCH_LOCALE_NS, registerWorkbenchDictionaries, type WorkbenchT } from './dictionary.js'
import { createWorkbenchController } from './controller.js'
import { createWorkbenchFetcher } from './fetcher.js'
import { createWorkbenchTabSeat } from './view.js'
import { createWorkbenchStore } from './store.js'

/** The detail tab seat id/order (D5 naming, unchanged from P1a). */
export const WORKBENCH_SEAT_ID = 'aiWorkbench'
export const WORKBENCH_SEAT_ORDER = 40

export function registerWorkbenchView(ctx: Context): () => void {
  registerWorkbenchDictionaries(ctx)
  const t = ctx.locale.bind(WORKBENCH_LOCALE_NS)

  const fetcher = createWorkbenchFetcher()
  const store = createWorkbenchStore()
  const controller = createWorkbenchController(store, fetcher)
  const seat = createWorkbenchTabSeat({ t: t satisfies WorkbenchT, store, controller })

  const disposeSeat = ctx.slots.inject('requirements.detail.view', () =>
    ctx.slots.register(
      { name: 'requirements.detail.view', id: WORKBENCH_SEAT_ID, order: WORKBENCH_SEAT_ORDER, label: () => t('detail.tab.aiWorkbench') },
      seat,
    ))

  return () => {
    disposeSeat()
    controller.dispose()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbenchView?: never
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'skyaxis.workbench':
      | 'detail.tab.aiWorkbench'
      | 'workbench.railLabel'
      | 'workbench.stage.understand'
      | 'workbench.stage.plan'
      | 'workbench.stage.implement'
      | 'workbench.stage.review'
      | 'workbench.stage.deliver'
      | 'workbench.stage.retro'
      | 'workbench.stageHint.understand'
      | 'workbench.stageHint.plan'
      | 'workbench.stageHint.implement'
      | 'workbench.stageHint.review'
      | 'workbench.stageHint.deliver'
      | 'workbench.stageHint.retro'
      | 'page.loading'
      | 'page.degraded'
      | 'page.degradedBackupHint'
      | 'page.loadError'
      | 'empty.firstUseHint'
      | 'advance.stage'
      | 'advance.close'
      | 'advance.closed'
      | 'badge.findingsOpen'
      | 'badge.modules'
      | 'badge.progress'
      | 'badge.reviewOpen'
      | 'badge.releaseItems'
      | 'badge.candidates'
      | 'finding.add'
      | 'finding.addTitle'
      | 'finding.titleLabel'
      | 'finding.detailLabel'
      | 'finding.categoryLabel'
      | 'finding.severityLabel'
      | 'finding.submit'
      | 'finding.cancel'
      | 'finding.category.feasibility'
      | 'finding.category.conflict'
      | 'finding.category.compatibility'
      | 'finding.category.risk'
      | 'finding.category.capacity'
      | 'finding.category.other'
      | 'finding.severity.high'
      | 'finding.severity.medium'
      | 'finding.severity.low'
      | 'error.conflict'
      | 'error.network'
      | 'error.unreadableFile'
      | 'error.notFound'
      | 'error.internal'
  }
}
