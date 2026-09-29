// @vitest-environment jsdom
/**
 * Workbench registration contract (0006 P1b, migrated out of the requirements
 * module): the skyaxis.workbench namespace key set (the runtime sentinel —
 * the type system pins map⊆dictionary, this list pins dictionary⊆map), the
 * detail-seat projection (id aiWorkbench / order 40, bilingual label), and
 * the two-module panorama (overview 10 / workspace 30 / aiWorkbench 40).
 */
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { SlotCore, resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { requirementsMainOptions } from '../../src/client/requirements/register.jsx'
import { createRequirementTabSeats } from '../../src/client/requirements/detail-tabs.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import { createWorkspaceCapabilities } from '../../src/client/requirements/workspace-tab.js'
import {
  WORKBENCH_LOCALE_NS,
  registerWorkbenchDictionaries,
  workbenchEn,
  workbenchZh,
  type WorkbenchT,
} from '../../src/client/workbench/dictionary.js'
import { WORKBENCH_SEAT_ID, WORKBENCH_SEAT_ORDER } from '../../src/client/workbench/register.jsx'
import { createWorkbenchTabSeat } from '../../src/client/workbench/view.js'
import { createWorkbenchStore } from '../../src/client/workbench/store.js'
import { createWorkbenchController } from '../../src/client/workbench/controller.js'

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
      bind(ns: string): WorkbenchT {
        return (key) => dicts.get(ns)?.[state.current][key] ?? key
      },
    },
  }
  return { ctx, state, dicts, dispose: () => disposers.forEach((d) => d()) }
}

describe('workbench: dictionaries', () => {
  it('registers the skyaxis.workbench namespace with the full migrated + P1b key set', () => {
    const { ctx, dicts } = createLocaleHarness()
    registerWorkbenchDictionaries(ctx as never)
    expect(dicts.get(WORKBENCH_LOCALE_NS)).toBeTruthy()
    const { zh, en } = dicts.get(WORKBENCH_LOCALE_NS)!
    expect(Object.keys(zh).sort()).toEqual([
      'advance.close',
      'advance.closed',
      'advance.stage',
      'badge.candidates',
      'badge.findingsOpen',
      'badge.progress',
      'badge.releaseItems',
      'badge.reviewOpen',
      'badge.workPackages',
      'detail.tab.aiWorkbench',
      'empty.firstUseHint',
      'error.conflict',
      'error.internal',
      'error.network',
      'error.notFound',
      'error.unreadableFile',
      'finding.add',
      'finding.addTitle',
      'finding.cancel',
      'finding.category.capacity',
      'finding.category.compatibility',
      'finding.category.conflict',
      'finding.category.feasibility',
      'finding.category.other',
      'finding.category.risk',
      'finding.categoryLabel',
      'finding.detailLabel',
      'finding.severity.high',
      'finding.severity.low',
      'finding.severity.medium',
      'finding.severityLabel',
      'finding.submit',
      'finding.titleLabel',
      'page.degraded',
      'page.degradedBackupHint',
      'page.loadError',
      'page.loading',
      'workbench.railLabel',
      'workbench.stage.deliver',
      'workbench.stage.implement',
      'workbench.stage.plan',
      'workbench.stage.retro',
      'workbench.stage.review',
      'workbench.stage.understand',
      'workbench.stageHint.deliver',
      'workbench.stageHint.implement',
      'workbench.stageHint.plan',
      'workbench.stageHint.retro',
      'workbench.stageHint.review',
      'workbench.stageHint.understand',
    ])
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    // The migrated label keeps its P1a wording verbatim (D5 naming).
    expect(zh['detail.tab.aiWorkbench']).toBe('AI 工作台')
    expect(en['detail.tab.aiWorkbench']).toBe('AI Workbench')
  })
})

describe('workbench: detail seat registration contract', () => {
  /** Host-shaped root frame declaring the slot tree (SlotCore needs 'main' declared before entries register into it). */
  function declareRoot(core: SlotCore) {
    const frame = (_props: PropsRuntime<'root'> & PropsRenderSlots<'main'>): ReactNode => null
    core.register({ name: 'root', children: { 'main': { kind: 'keyed', scope: 'root' } } }, frame)
  }

  function mountFixture(core: SlotCore, t: WorkbenchT) {
    declareRoot(core)
    // The requirements main entry declares the tab ledger (the declaring
    // component must consume renderSlot in its type — RendersCheck).
    const disposeMain = core.register(
      requirementsMainOptions(),
      (props: PropsRuntime<'main'> & PropsRenderSlots<'requirements.detail.view'>): ReactNode => null,
    )
    const disposeSeat = core.register(
      { name: 'requirements.detail.view', id: WORKBENCH_SEAT_ID, order: WORKBENCH_SEAT_ORDER, label: () => t('detail.tab.aiWorkbench') },
      createWorkbenchTabSeat({ t, store: createWorkbenchStore(), controller: createWorkbenchController(createWorkbenchStore(), { detail: async () => ({ kind: 'network' }) } as never) }),
    )
    return { disposeMain, disposeSeat }
  }

  it('projects the seat at order 40 with a bilingual label and disposes cleanly', () => {
    const { ctx, state } = createLocaleHarness()
    registerWorkbenchDictionaries(ctx as never)
    const t = ctx.locale.bind(WORKBENCH_LOCALE_NS)
    const core = new SlotCore()
    const { disposeMain, disposeSeat } = mountFixture(core, t)

    const entries = core.entriesOfSlot('requirements.detail.view')
    expect(entries.map((e) => [e.options.id, e.options.order])).toEqual([['aiWorkbench', 40]])
    expect(resolveSlotLabel(entries[0].options.label)).toBe('AI Workbench')
    state.current = 'zh'
    expect(resolveSlotLabel(entries[0].options.label)).toBe('AI 工作台')

    disposeSeat()
    expect(core.entriesOfSlot('requirements.detail.view')).toHaveLength(0)
    disposeMain()
  })

  it('two-module panorama: overview 10 / workspace 30 / aiWorkbench 40 (order beats registration order)', () => {
    const { ctx } = createLocaleHarness()
    registerWorkbenchDictionaries(ctx as never)
    const t = ctx.locale.bind(WORKBENCH_LOCALE_NS)
    const core = new SlotCore()
    declareRoot(core)
    core.register(
      requirementsMainOptions(),
      (props: PropsRuntime<'main'> & PropsRenderSlots<'requirements.detail.view'>): ReactNode => null,
    )
    const requirementsT = ((key: string) => key) as never as Parameters<typeof createRequirementTabSeats>[0]['t']
    const seats = createRequirementTabSeats({
      t: requirementsT,
      controller: createRequirementsController(createRequirementsStore(), { list: async () => ({ kind: 'network' }), repoTasks: async () => ({ kind: 'ok', tasks: [] }) } as never),
      capabilities: createWorkspaceCapabilities(),
    })
    // 刻意最后注册 requirements 的两个低序 seat：注册顺序 ≠ 呈现顺序。
    core.register({ name: 'requirements.detail.view', id: 'aiWorkbench', order: 40, label: () => t('detail.tab.aiWorkbench') }, createWorkbenchTabSeat({ t, store: createWorkbenchStore(), controller: createWorkbenchController(createWorkbenchStore(), { detail: async () => ({ kind: 'network' }) } as never) }))
    core.register({ name: 'requirements.detail.view', id: 'workspace', order: 30, label: () => 'workspace' }, seats.RequirementWorkspaceTab)
    core.register({ name: 'requirements.detail.view', id: 'overview', order: 10, label: () => 'overview' }, seats.RequirementOverviewTab)

    expect(core.entriesOfSlot('requirements.detail.view').map((e) => [e.options.id, e.options.order]))
      .toEqual([['overview', 10], ['workspace', 30], ['aiWorkbench', 40]])
  })
})
