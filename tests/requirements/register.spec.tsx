// @vitest-environment jsdom
/**
 * Requirements registration contract, against the real SlotCore from the
 * published ui-slots package (the P0 boundary finding stands: the browser
 * SlotRegistry / host sidebar shell are loader-factory bundles, unreachable
 * outside the DSH monorepo — shell behavior is verified on the live host).
 *
 * Covers: dictionary registration (zh/en), paired main-key / panellist-id
 * projections, label thunk bilingual resolution, keyed-cell coexistence with
 * the shipped 'conversation' key, and dispose semantics.
 */
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { SlotCore, resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  REQUIREMENTS_PANEL_ID,
  REQUIREMENTS_PANEL_ORDER,
  createDetailTabsStore,
  requirementsMainOptions,
  requirementsPanelOptions,
} from '../../src/client/requirements/register.jsx'
import { createRequirementTabSeats } from '../../src/client/requirements/detail-tabs.js'
import {
  REQUIREMENTS_LOCALE_NS,
  registerRequirementsDictionaries,
  type RequirementsT,
} from '../../src/client/requirements/dictionary.js'
import { RequirementsIcon, RequirementsPage } from '../../src/client/requirements/view.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import { createWorkspaceCapabilities } from '../../src/client/requirements/workspace-tab.js'

/** Real LocaleRuntime register/bind contract, minimal implementation. */
function createLocaleHarness() {
  const dicts = new Map<string, { zh: Record<string, string>; en: Record<string, string> }>()
  const disposers: Array<() => void> = []
  const state = { current: 'en' as 'en' | 'zh' }
  const ctx = {
    effect(fn: () => () => void) {
      disposers.push(fn())
      return () => {}
    },
    locale: {
      register(ns: string, d: { zh: Record<string, string>; en: Record<string, string> }) {
        dicts.set(ns, d)
        return () => dicts.delete(ns)
      },
      bind(ns: string): RequirementsT {
        return (key) => dicts.get(ns)?.[state.current][key] ?? key
      },
    },
  }
  return {
    ctx,
    state,
    dicts,
    dispose: () => disposers.forEach((d) => d()),
  }
}

describe('requirements: dictionaries', () => {
  it('registers the skyaxis.requirements namespace with matching zh/en key sets', () => {
    const { ctx, dicts } = createLocaleHarness()
    registerRequirementsDictionaries(ctx as never)
    expect(dicts.get(REQUIREMENTS_LOCALE_NS)).toBeTruthy()
    const { zh, en } = dicts.get(REQUIREMENTS_LOCALE_NS)!
    expect(Object.keys(zh).sort()).toEqual([
      'delete.cancel',
      'delete.confirm',
      'delete.description',
      'delete.title',
      'detail.back',
      'detail.missing',
      'detail.tab.overview',
      'detail.tab.seat',
      'detail.tab.workspace',
      'error.conflict',
      'error.internal',
      'error.network',
      'error.notFound',
      'error.titleRequired',
      'error.unreadableFile',
      'form.cancel',
      'form.closeLabel',
      'form.description',
      'form.descriptionPlaceholder',
      'form.submit',
      'form.submitting',
      'form.title',
      'form.titleCreate',
      'form.titleEdit',
      'form.titlePlaceholder',
      'menu.edit',
      'menu.remove',
      'page.degraded',
      'page.degradedBackupHint',
      'page.loading',
      'panel.title',
      'repos.add',
      'repos.branchLabel',
      'repos.branching',
      'repos.cancel',
      'repos.cancelled',
      'repos.cloning',
      'repos.emptyHint',
      'repos.emptyPool',
      'repos.errBusy',
      'repos.errDestExists',
      'repos.errGitMissing',
      'repos.errInvalidBranch',
      'repos.errNoWorkspace',
      'repos.errTooMany',
      'repos.failAuth',
      'repos.failGitMissing',
      'repos.failNetwork',
      'repos.failedTag',
      'repos.link',
      'repos.menuLabel',
      'repos.poolError',
      'repos.reclone',
      'repos.removeCancel',
      'repos.removeConfirm',
      'repos.removeDesc',
      'repos.removeLink',
      'repos.removeLinkHint',
      'repos.removeTitle',
      'repos.removedRepo',
      'repos.selectRepo',
      'view.addRequirement',
      'view.filterEmpty',
      'view.filterPlaceholder',
      'workspace.browse',
      'workspace.emptyHint',
      'workspace.invalidPath',
      'workspace.open',
      'workspace.pathLabel',
      'workspace.pickerUnavailable',
      'workspace.rebind',
      'workspace.rebindHint',
      'workspace.sectionPrd',
      'workspace.sectionPrdHint',
      'workspace.sectionRepos',
      'workspace.sectionReposHint',
      'workspace.setUp',
      'workspace.tagMissing',
      'workspace.tagOk',
      'workspace.tagUnregistered',
      'workspace.unbind',
      'workspace.unbindHint',
    ])
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(zh['panel.title']).toBe('需求管理')
    expect(en['panel.title']).toBe('Requirements')
  })

  it('bind resolves per current locale without re-registration', () => {
    const { ctx, state } = createLocaleHarness()
    registerRequirementsDictionaries(ctx as never)
    const t = ctx.locale.bind(REQUIREMENTS_LOCALE_NS)
    expect(t('panel.title')).toBe('Requirements')
    state.current = 'zh'
    expect(t('panel.title')).toBe('需求管理')
  })
})

describe('requirements: SlotCore registration contract', () => {
  function mountFixture(core: SlotCore, t: RequirementsT) {
    // Host-shaped base: root frame declares the two slots (RendersCheck: the
    // declaring component must consume renderSlot in its type).
    const frame = (_props: PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>): ReactNode => null
    core.register({ name: 'root', children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root', owner: { size: 'number', active: 'boolean' } },
    } }, frame)
    const disposeConversation = core.register(
      { name: 'main', key: 'conversation' },
      () => <p>Conversation content</p> as ReactNode,
    )
    // The requirements main entry declares the detail tab ledger as its
    // child (RendersCheck: the component must consume renderSlot).
    const disposeMain = core.register(
      requirementsMainOptions(),
      (props: PropsRuntime<'main'> & PropsRenderSlots<'requirements.detail.view'>) => {
        const store = createRequirementsStore()
        const controller = createRequirementsController(store, { list: async () => ({ kind: 'network' }), repoTasks: async () => ({ kind: 'ok', tasks: [] }) } as never)
        return (
          <RequirementsPage
            t={t}
            store={store}
            controller={controller}
            detailTabs={createDetailTabsStore([])}
            renderSlot={props.renderSlot}
          />
        ) as ReactNode
      },
    )
    // The tab seats, registered AFTER the declaring entry (SlotCore throws
    // on an undeclared slot; order is fixture-controlled).
    const seats = createRequirementTabSeats({ t, controller: createRequirementsController(createRequirementsStore(), { list: async () => ({ kind: 'network' }), repoTasks: async () => ({ kind: 'ok', tasks: [] }) } as never), capabilities: createWorkspaceCapabilities() })
    const disposeOverview = core.register(
      { name: 'requirements.detail.view', id: 'overview', order: 10, label: () => t('detail.tab.overview') },
      seats.RequirementOverviewTab,
    )
    const disposeWorkspace = core.register(
      { name: 'requirements.detail.view', id: 'workspace', order: 30, label: () => t('detail.tab.workspace') },
      seats.RequirementWorkspaceTab,
    )
    const disposePanel = core.register(
      requirementsPanelOptions(t),
      (props: PropsRuntime<'sidebar.panellist'>) => RequirementsIcon(props) as ReactNode,
    )
    return { disposeConversation, disposeMain, disposeOverview, disposeWorkspace, disposePanel }
  }

  it('projects {id, order} and resolves the label thunk bilingually', () => {
    const { ctx, state } = createLocaleHarness()
    registerRequirementsDictionaries(ctx as never)
    const t = ctx.locale.bind(REQUIREMENTS_LOCALE_NS)
    const core = new SlotCore()
    const { disposeMain, disposePanel } = mountFixture(core, t)

    const entries = core.entriesOfSlot('sidebar.panellist')
    expect(entries).toHaveLength(1)
    expect(entries[0].options.id).toBe(REQUIREMENTS_PANEL_ID)
    expect(entries[0].options.order).toBe(REQUIREMENTS_PANEL_ORDER)
    expect(resolveSlotLabel(entries[0].options.label)).toBe('Requirements')
    state.current = 'zh'
    expect(resolveSlotLabel(entries[0].options.label)).toBe('需求管理')

    // Keyed coexistence: conversation + requirements, one cell each.
    const mainKeys = core.entriesOfSlot('main').map((e) => e.options.key)
    expect(mainKeys).toContain('conversation')
    expect(mainKeys).toContain(REQUIREMENTS_PANEL_ID)
    expect(mainKeys).toHaveLength(2)

    disposeMain()
    expect(core.entriesOfSlot('main').map((e) => e.options.key)).toEqual(['conversation'])
    disposePanel()
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
  })

  it('keeps id === key: the panellist id doubles as the main panel key', () => {
    const main = requirementsMainOptions()
    const { ctx } = createLocaleHarness()
    const t = ctx.locale.bind(REQUIREMENTS_LOCALE_NS)
    const panel = requirementsPanelOptions(t)
    expect(panel.id).toBe(main.key)
  })

  it('the main entry declares the tab ledger; seats project bilingually and collapse on dispose', () => {
    const { ctx, state } = createLocaleHarness()
    registerRequirementsDictionaries(ctx as never)
    const t = ctx.locale.bind(REQUIREMENTS_LOCALE_NS)
    const core = new SlotCore()
    const { disposeMain } = mountFixture(core, t)

    const entries = core.entriesOfSlot('requirements.detail.view')
    expect(entries.map((e) => [e.options.id, e.options.order])).toEqual([['overview', 10], ['workspace', 30]])
    expect(resolveSlotLabel(entries[0].options.label)).toBe('Overview')
    state.current = 'zh'
    expect(resolveSlotLabel(entries[0].options.label)).toBe('概览')
    expect(resolveSlotLabel(entries[1].options.label)).toBe('工作区')

    // Disposing the declaring main entry collapses the child slot (the
    // releaseEntry cascade); the seat disposers stay harmless afterwards.
    disposeMain()
    expect(core.entriesOfSlot('requirements.detail.view')).toHaveLength(0)
  })

  it('fails loud when registering into an undeclared slot', () => {
    const core = new SlotCore()
    expect(() => core.register(requirementsPanelOptions(((key) => key) as RequirementsT), RequirementsIcon))
      .toThrow(/not declared/)
  })
})
