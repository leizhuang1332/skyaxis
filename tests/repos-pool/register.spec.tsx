// @vitest-environment jsdom
/**
 * Repos-pool registration contract, against the real SlotCore from the
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
  REPOS_POOL_PANEL_ID,
  REPOS_POOL_PANEL_ORDER,
  reposPoolMainOptions,
  reposPoolPanelOptions,
} from '../../src/client/repos-pool/register.jsx'
import {
  REPOS_POOL_LOCALE_NS,
  registerReposPoolDictionaries,
  type ReposPoolT,
} from '../../src/client/repos-pool/dictionary.js'
import { ReposPoolIcon } from '../../src/client/repos-pool/view.js'

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
      bind(ns: string): ReposPoolT {
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

describe('repos-pool: dictionaries', () => {
  it('registers the skyaxis.reposPool namespace with matching zh/en key sets', () => {
    const { ctx, dicts } = createLocaleHarness()
    registerReposPoolDictionaries(ctx as never)
    expect(dicts.get(REPOS_POOL_LOCALE_NS)).toBeTruthy()
    const { zh, en } = dicts.get(REPOS_POOL_LOCALE_NS)!
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(zh).length).toBeGreaterThanOrEqual(50) // four-prefix full set
    expect(zh['panel.title']).toBe('仓库池')
    expect(en['panel.title']).toBe('Repos Pool')
    for (const key of ['form.submit', 'error.conflict', 'status.verified', 'risk.acknowledge', 'menu.remove'] as const) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  it('bind resolves per current locale without re-registration', () => {
    const { ctx, state } = createLocaleHarness()
    registerReposPoolDictionaries(ctx as never)
    const t = ctx.locale.bind(REPOS_POOL_LOCALE_NS)
    expect(t('panel.title')).toBe('Repos Pool')
    state.current = 'zh'
    expect(t('panel.title')).toBe('仓库池')
  })
})

describe('repos-pool: SlotCore registration contract', () => {
  function mountFixture(core: SlotCore, t: ReposPoolT) {
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
    const disposeMain = core.register(
      reposPoolMainOptions(),
      () => null as ReactNode,
    )
    const disposePanel = core.register(
      reposPoolPanelOptions(t),
      (props: PropsRuntime<'sidebar.panellist'>) => ReposPoolIcon(props) as ReactNode,
    )
    return { disposeConversation, disposeMain, disposePanel }
  }

  it('projects {id, order} and resolves the label thunk bilingually', () => {
    const { ctx, state } = createLocaleHarness()
    registerReposPoolDictionaries(ctx as never)
    const t = ctx.locale.bind(REPOS_POOL_LOCALE_NS)
    const core = new SlotCore()
    const { disposeMain, disposePanel } = mountFixture(core, t)

    const entries = core.entriesOfSlot('sidebar.panellist')
    expect(entries).toHaveLength(1)
    expect(entries[0].options.id).toBe(REPOS_POOL_PANEL_ID)
    expect(entries[0].options.order).toBe(REPOS_POOL_PANEL_ORDER)
    expect(resolveSlotLabel(entries[0].options.label)).toBe('Repos Pool')
    state.current = 'zh'
    expect(resolveSlotLabel(entries[0].options.label)).toBe('仓库池')

    // Keyed coexistence: conversation + repos-pool, one cell each.
    const mainKeys = core.entriesOfSlot('main').map((e) => e.options.key)
    expect(mainKeys).toContain('conversation')
    expect(mainKeys).toContain(REPOS_POOL_PANEL_ID)
    expect(mainKeys).toHaveLength(2)

    disposeMain()
    expect(core.entriesOfSlot('main').map((e) => e.options.key)).toEqual(['conversation'])
    disposePanel()
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
  })

  it('keeps id === key: the panellist id doubles as the main panel key', () => {
    const main = reposPoolMainOptions()
    const { ctx } = createLocaleHarness()
    const t = ctx.locale.bind(REPOS_POOL_LOCALE_NS)
    const panel = reposPoolPanelOptions(t)
    expect(panel.id).toBe(main.key)
  })

  it('fails loud when registering into an undeclared slot', () => {
    const core = new SlotCore()
    expect(() => core.register(reposPoolPanelOptions(((key) => key) as ReposPoolT), ReposPoolIcon))
      .toThrow(/not declared/)
  })
})
