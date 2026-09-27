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
 * Detail tabs (0003 P2, conversation.view-shaped): the main entry DECLARES
 * a child list slot 'requirements.detail.view' — the tab ledger — and the
 * page consumes it (entriesOfSlot projection + renderSlot({only})). Tabs
 * register into that slot like any panel: adding a future feature tab =
 * one slots.inject + register entry here; detail.tsx never changes. Other
 * plugins may register into the slot as well (the dsh-workshop.panel
 * precedent).
 *
 * Data wiring follows the repos-pool closure pattern: store/controller/
 * fetcher are created here, captured by the page component, and destroyed
 * with the apply disposer. The tab ledger store mirrors the host's
 * conversationViews projection (apply.ts shape): entriesOfSlot → snapshot
 * store, refreshed on slot and locale changes with equality guarding.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel, type PropsRenderSlots, type PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { REQUIREMENTS_LOCALE_NS, registerRequirementsDictionaries, type RequirementsT } from './dictionary.js'
import { createRequirementsController } from './controller.js'
import { createRequirementTabSeats } from './detail-tabs.js'
import { createRequirementsFetcher } from './fetcher.js'
import { RequirementsIcon, RequirementsPage } from './view.js'
import { createRequirementsStore } from './store.js'
import { createWorkspaceCapabilities } from './workspace-tab.js'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'

/** Paired main-key / panellist-id — the two must stay identical. */
export const REQUIREMENTS_PANEL_ID = 'requirements'

/** List-slot order; seated after the repos-pool occupant (order 100). */
export const REQUIREMENTS_PANEL_ORDER = 110

/** The detail tab ledger slot (child of the main entry). */
export const REQUIREMENTS_DETAIL_VIEW_SLOT = 'requirements.detail.view'

/** One projected detail tab (label resolved at read time). */
export interface RequirementDetailTab {
  readonly id: string
  readonly order: number
  readonly label: string
}

/** The tab ledger store the page subscribes to (stable snapshots). */
export function createDetailTabsStore(initial: readonly RequirementDetailTab[]) {
  return createSnapshotStore<readonly RequirementDetailTab[]>(initial, { flush: 'raf' })
}

export type RequirementsDetailTabsStore = ReturnType<typeof createDetailTabsStore>

/**
 * Registration options as builders so production wiring and tests share one
 * definition (tests assert the SlotCore projections these produce).
 */
export const requirementsMainOptions = () =>
  ({
    name: 'main',
    key: REQUIREMENTS_PANEL_ID,
    children: {
      [REQUIREMENTS_DETAIL_VIEW_SLOT]: { kind: 'list', scope: 'root' },
    },
  }) as const

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

  // Optional remote capabilities for the workspace tab (P3a). Sub-scope
  // injects, NEVER top-level: a composition without these namespaces must
  // not lose the whole requirements panel — the tab core works over skyaxis's
  // own HTTP endpoints; only the picker/reveal buttons ride these faces. All
  // ctx.remote property reads live inside these two callbacks (the reflect
  // allowlist throws outside an inject scope).
  const workspaceCapabilities = createWorkspaceCapabilities()
  const pickerFiber = ctx.inject(['remote', 'remote.directoryPicker'], (scope) => {
    workspaceCapabilities.setPicker(scope.remote.directoryPicker)
    return () => workspaceCapabilities.setPicker(undefined)
  })
  const openerFiber = ctx.inject(['remote', 'remote.session'], (scope) => {
    workspaceCapabilities.setOpener(scope.remote.session)
    return () => workspaceCapabilities.setOpener(undefined)
  })

  // Tab ledger projection (host conversationViews shape): entriesOfSlot is
  // a fresh array per call, so the snapshot store is the stable source the
  // page subscribes to; equality guarding keeps unrelated refreshes silent.
  const projectTabs = (): readonly RequirementDetailTab[] =>
    ctx.slots.entriesOfSlot(REQUIREMENTS_DETAIL_VIEW_SLOT)
      .flatMap((entry) => {
        const id = entry.options.id
        if (id === undefined) return []
        return [{ id, order: entry.options.order ?? 0, label: resolveSlotLabel(entry.options.label) ?? id }]
      })
  const detailTabs = createDetailTabsStore(projectTabs())
  const refreshTabs = (): void => {
    const current = detailTabs.getSnapshot()
    const next = projectTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next[index]
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) detailTabs.set(next)
  }
  ctx.effect(() => {
    const disposeSlot = ctx.slots.subscribe(REQUIREMENTS_DETAIL_VIEW_SLOT, refreshTabs)
    const disposeLocale = ctx.locale.subscribe(refreshTabs)
    return () => {
      disposeLocale()
      disposeSlot()
    }
  }, 'skyaxis.requirements: detail tab ledger')

  const disposeMain = ctx.slots.inject('main', () =>
    ctx.slots.register(requirementsMainOptions(), (props: PropsRuntime<'main'> & PropsRenderSlots<typeof REQUIREMENTS_DETAIL_VIEW_SLOT>): ReactNode => (
      <RequirementsPage
        t={t satisfies RequirementsT}
        store={store}
        controller={controller}
        detailTabs={detailTabs}
        renderSlot={props.renderSlot}
      />
    )))

  const disposePanel = ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(requirementsPanelOptions(t), RequirementsIcon))

  // Tab seats: inject waits for the declaring register (the main entry
  // above), so order against it never matters. The placeholder seat retired
  // with the workspace tab landing (P3a).
  const seats = createRequirementTabSeats({ t, controller, capabilities: workspaceCapabilities })
  const disposeOverview = ctx.slots.inject(REQUIREMENTS_DETAIL_VIEW_SLOT, () =>
    ctx.slots.register(
      { name: REQUIREMENTS_DETAIL_VIEW_SLOT, id: 'overview', order: 10, label: () => t('detail.tab.overview') },
      seats.RequirementOverviewTab,
    ))
  const disposeWorkspace = ctx.slots.inject(REQUIREMENTS_DETAIL_VIEW_SLOT, () =>
    ctx.slots.register(
      { name: REQUIREMENTS_DETAIL_VIEW_SLOT, id: 'workspace', order: 30, label: () => t('detail.tab.workspace') },
      seats.RequirementWorkspaceTab,
    ))

  return () => {
    disposeWorkspace()
    disposeOverview()
    disposePanel()
    disposeMain()
    openerFiber.dispose()
    pickerFiber.dispose()
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
    'requirements.detail.view': { kind: 'list'; scope: 'root'; owner: { requirement: RequirementRecord } }
  }
  interface LocaleNamespaceMap {
    'skyaxis.requirements':
      | 'panel.title'
      | 'page.loading'
      | 'page.degraded'
      | 'page.degradedBackupHint'
      | 'view.addRequirement'
      | 'view.filterPlaceholder'
      | 'view.filterEmpty'
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
      | 'delete.title'
      | 'delete.description'
      | 'delete.confirm'
      | 'delete.cancel'
      | 'detail.back'
      | 'detail.missing'
      | 'detail.tab.overview'
      | 'detail.tab.workspace'
      | 'detail.tab.seat'
      | 'workspace.setUp'
      | 'workspace.emptyHint'
      | 'workspace.pathLabel'
      | 'workspace.browse'
      | 'workspace.tagOk'
      | 'workspace.tagMissing'
      | 'workspace.tagUnregistered'
      | 'workspace.open'
      | 'workspace.unbind'
      | 'workspace.unbindHint'
      | 'workspace.rebind'
      | 'workspace.rebindHint'
      | 'workspace.invalidPath'
      | 'workspace.pickerUnavailable'
      | 'workspace.sectionRepos'
      | 'workspace.sectionReposHint'
      | 'workspace.sectionPrd'
      | 'workspace.sectionPrdHint'
  }
}
