// @vitest-environment jsdom
/**
 * Requirements page view rendering: the real components against jsdom with
 * the real ui-primitives atoms and a fake data layer (fetcher/controller/
 * store wired exactly as register.tsx does). Covers list rows, the add
 * card, banners, degraded state, filtering, the icon glyph sizes, and the
 * list-page iteration (one column, row creation time, sort control).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import { createDetailTabsStore } from '../../src/client/requirements/register.jsx'
import { createdAtText } from '../../src/client/requirements/list.js'
import { RequirementsIcon, RequirementsPage } from '../../src/client/requirements/view.js'
import type { RequirementsFetcher } from '../../src/client/requirements/fetcher.js'

const DICT = {
  zh: {
    'panel.title': '需求管理',
    'page.loading': '正在加载需求清单…',
    'page.degraded': '需求清单文件无法读取，已显示为空清单。',
    'page.degradedBackupHint': '检测到备份文件：requirements.yaml.bak。',
    'view.addRequirement': '新增需求',
    'view.filterPlaceholder': '按标题 / 描述筛选',
    'view.filterEmpty': '没有匹配的需求。',
    'view.createdPrefix': '创建于',
    'view.sort': '排序',
    'view.sortCreatedDesc': '创建时间倒序',
    'view.sortCreatedAsc': '创建时间正序',
    'form.closeLabel': '关闭',
    'menu.edit': '编辑',
    'menu.remove': '删除',
    'delete.title': '删除需求',
    'delete.description': '确定要删除该需求吗？清单记录与 AI 工作台产物（计划文档、评审报告等）将一并归档至 .trash 目录，继续占用磁盘空间，可手动找回。',
    'delete.confirm': '删除',
    'delete.cancel': '取消',
    'detail.back': '返回',
    'detail.switch': '切换需求',
    'detail.missing': '该需求已不存在。',
    'error.network': '网络错误，请稍后重试',
  },
} as const

function bindZh(): RequirementsT {
  return (key) => (DICT.zh as Record<string, string>)[key] ?? key
}

const record = (id: string, createdAt = '2026-09-25T09:30:00.000Z'): RequirementRecord => ({
  id,
  title: `需求-${id}`,
  description: `说明 ${id}`,
  workspacePath: '',
  linkedRepos: [],
  createdAt,
  updatedAt: createdAt,
})

function page(fetcherOverrides: Partial<RequirementsFetcher> = {}) {
  const fetcher: RequirementsFetcher = {
    list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, requirements: [record('a'), record('b')] })),
    save: vi.fn(async () => ({ kind: 'network' as const })),
    remove: vi.fn(async () => ({ kind: 'network' as const })),
    ...fetcherOverrides,
  } as RequirementsFetcher
  const store = createRequirementsStore()
  const controller = createRequirementsController(store, fetcher)
  // Tab ledger + renderSlot fakes: the real slot contract lives in
  // register.spec (SlotCore); here the page wiring is what matters.
  const detailTabs = createDetailTabsStore([
    { id: 'overview', order: 10, label: '概览' },
    { id: 'workspace', order: 30, label: '工作区' },
  ])
  const renderSlot = ((_key: string, owner: { requirement: { title: string } }, opts?: { only?: string }) => (
    <div data-tab-panel={opts?.only}>{owner.requirement.title}</div>
  )) as never
  const utils = render(
    <RequirementsPage t={bindZh()} store={store} controller={controller} detailTabs={detailTabs} renderSlot={renderSlot} />,
  )
  // detailTabs/renderSlot ride out for the panel-round-trip remount case:
  // the same store/controller must re-enter a freshly rendered page.
  return { ...utils, store, controller, fetcher, detailTabs, renderSlot }
}

describe('RequirementsPage (P2)', () => {
  it('renders the header, requirement rows, and the leading add card', async () => {
    const { unmount } = page()
    expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy()
    // The list (and its leading add card) renders once refresh lands.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新增需求' })).toBeTruthy()
      expect(screen.getByText('需求-a')).toBeTruthy()
      expect(screen.getByText('说明 b')).toBeTruthy()
    })
    unmount()
  })

  it('renders an empty list as the add card alone', async () => {
    const { unmount } = page({ list: vi.fn(async () => ({ kind: 'ok' as const, revision: 0, requirements: [] })) })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新增需求' })).toBeTruthy()
    })
    unmount()
  })

  it('shows the degraded banner with the backup hint', async () => {
    const { unmount } = page({ list: vi.fn(async () => ({ kind: 'degraded' as const, reason: 'parse' as const, hasBackup: true })) })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText(DICT.zh['page.degraded'])).toBeTruthy()
      expect(screen.getByText(DICT.zh['page.degradedBackupHint'])).toBeTruthy()
    })
    unmount()
  })

  it('filters rows by title/description and reports empty matches', async () => {
    const { unmount } = page()
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    const filter = screen.getByPlaceholderText('按标题 / 描述筛选')
    fireEvent.change(filter, { target: { value: '需求-a' } })
    await waitFor(() => {
      expect(screen.getByText('需求-a')).toBeTruthy()
      expect(screen.queryByText('需求-b')).toBeNull()
    })
    fireEvent.change(filter, { target: { value: '说明 b' } })
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    fireEvent.change(filter, { target: { value: 'zzz-no-match' } })
    await waitFor(() => expect(screen.getByText('没有匹配的需求。')).toBeTruthy())
    // The add card stays in place under an empty filter.
    expect(screen.getByRole('button', { name: '新增需求' })).toBeTruthy()
    unmount()
  })
})

describe('RequirementsPage (P3: delete confirm, focus refresh, skeleton, banner dismiss)', () => {
  it('delete goes through the confirm dialog: cancel does nothing, confirm removes', async () => {
    const { unmount, fetcher } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())

    // Open the row menu and pick 删除 → the confirm dialog appears.
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    await waitFor(() => screen.getByRole('menuitem', { name: '删除' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    await waitFor(() => expect(screen.getByText('确定要删除该需求吗？清单记录与 AI 工作台产物（计划文档、评审报告等）将一并归档至 .trash 目录，继续占用磁盘空间，可手动找回。')).toBeTruthy())
    expect(fetcher.remove).not.toHaveBeenCalled()

    // Cancel: dialog closes, nothing removed.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText(/确定要删除该需求/)).toBeNull())
    expect(fetcher.remove).not.toHaveBeenCalled()

    // Confirm: removal dispatched with the row id.
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    await waitFor(() => screen.getByRole('menuitem', { name: '删除' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    await waitFor(() => screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(fetcher.remove).toHaveBeenCalledTimes(1))
    expect((fetcher.remove as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ id: 'a' })
    unmount()
  })

  it('refreshes the list when the window regains focus', async () => {
    const { unmount, fetcher } = page()
    await waitFor(() => expect(fetcher.list).toHaveBeenCalledTimes(1))
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(fetcher.list).toHaveBeenCalledTimes(2))
    unmount()
  })

  it('shows two skeleton cards while loading', async () => {
    const pendingList = vi.fn(() => new Promise(() => {})) as unknown as RequirementsFetcher['list']
    const { container, unmount } = page({ list: pendingList })
    expect(container.querySelectorAll('[aria-hidden] > div')).toHaveLength(2)
    unmount()
  })

  it('banner is dismissible', async () => {
    const { unmount, store } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    store.set({ ...store.getSnapshot(), banner: { code: 'network' } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    unmount()
  })
})

describe('RequirementsPage (0003 P1: in-panel detail navigation)', () => {
  it('clicking a row body opens the detail view; back returns to the list', async () => {
    const { unmount, container } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    // The row main body is the open affordance; its accessible name is the
    // record text (title + description).
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy()
    })
    // The detail owns the header: the panel title is replaced by the record
    // title with the description riding directly under it, and the back
    // button rides the header.
    const header = container.querySelector('header')
    expect(header?.textContent).toContain('说明 a')
    expect(screen.queryByRole('heading', { name: '需求管理' })).toBeNull()
    // List-only chrome (the filter bar) is gone while the detail shows.
    expect(screen.queryByPlaceholderText('按标题 / 描述筛选')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('按标题 / 描述筛选')).toBeTruthy()
      expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy()
    })
    unmount()
  })

  it('the filter input keeps its value across a detail round-trip', async () => {
    const { unmount } = page()
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('按标题 / 描述筛选'), { target: { value: '需求-b' } })
    await waitFor(() => expect(screen.queryByText('需求-a')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /需求-b/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-b' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => {
      const filter = screen.getByPlaceholderText('按标题 / 描述筛选') as HTMLInputElement
      expect(filter.value).toBe('需求-b')
      expect(screen.getByText('需求-b')).toBeTruthy()
      expect(screen.queryByText('需求-a')).toBeNull()
    })
    unmount()
  })

  it('a selected id with no record renders the missing branch, and back still works', async () => {
    const { unmount, store } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    // The record vanishes under the selection (external removal path) —
    // selectedId survives, the view falls to the missing branch, and the
    // header heading falls back to the panel title.
    store.set({ ...store.getSnapshot(), requirements: store.getSnapshot().requirements.filter((r) => r.id !== 'a') })
    await waitFor(() => expect(screen.getByText('该需求已不存在。')).toBeTruthy())
    expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => expect(screen.getByPlaceholderText('按标题 / 描述筛选')).toBeTruthy())
    unmount()
  })
})

describe("RequirementsPage (0003 P2: detail tab skeleton)", () => {
  it('detail header carries the tab strip; the body renders the active tab panel', async () => {
    const { unmount, container } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())

    // Strip over the ledger (fake two tabs); first tab active.
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['概览', '工作区'])
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')
    // Panel outlet renders the active tab with the live record as owner —
    // queried by attribute: the record title also lives in the heading.
    const panel = () => container.querySelector('[data-tab-panel]')
    expect(panel()?.getAttribute('data-tab-panel')).toBe('overview')
    expect(panel()?.textContent).toBe('需求-a')

    // Clicking the second tab swaps the outlet (only-switch) and the aria.
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true')
      expect(panel()?.getAttribute('data-tab-panel')).toBe('workspace')
    })
    unmount()
  })

  it('entering another requirement resets the tab selection', async () => {
    const { unmount } = page()
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true'))

    // Back to the list, enter the other record — first tab again.
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-b/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-b' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true')
    unmount()
  })

  it('a missing record shows the notice and no tab strip', async () => {
    const { unmount, store } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    store.set({ ...store.getSnapshot(), requirements: store.getSnapshot().requirements.filter((r) => r.id !== 'a') })
    await waitFor(() => expect(screen.getByText('该需求已不存在。')).toBeTruthy())
    expect(screen.queryByRole('tablist')).toBeNull()
    unmount()
  })

  // 0004 P1: the host's keyed main slot unmounts the page on a panel switch
  // (no keep-alive) — remounting the SAME store/controller must restore the
  // detail tab and the list filter, not reset them.
  it('a panel round-trip (unmount + remount on the same store) keeps the detail tab and the filter', async () => {
    const { unmount, store, controller, detailTabs, renderSlot } = page()
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('按标题 / 描述筛选'), { target: { value: '需求-a' } })
    await waitFor(() => expect(screen.queryByText('需求-b')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true'))

    unmount() // panel switched away — component state dies
    const remount = render(
      <RequirementsPage t={bindZh()} store={store} controller={controller} detailTabs={detailTabs} renderSlot={renderSlot} />,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true')
    expect(remount.container.querySelector('[data-tab-panel]')?.getAttribute('data-tab-panel')).toBe('workspace')

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => {
      const filter = screen.getByPlaceholderText('按标题 / 描述筛选') as HTMLInputElement
      expect(filter.value).toBe('需求-a')
      expect(screen.queryByText('需求-b')).toBeNull()
    })
    remount.unmount()
  })

  // 0004 P2: the header switcher swaps requirements in ONE step, and the
  // tab is a PER-REQUIREMENT memory — a lands on its remembered tab, b on
  // its own (first visit falls back to 概览), swaps never cross-pollinate.
  it('the switcher swaps in one step; each requirement lands on its own remembered tab', async () => {
    const { unmount } = page()
    await waitFor(() => expect(screen.getByText('需求-b')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true'))

    const switchTo = async (name: string): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '切换需求' }))
      await waitFor(() => screen.getByRole('menuitem', { name }))
      fireEvent.click(screen.getByRole('menuitem', { name }))
      await waitFor(() => expect(screen.getByRole('heading', { name })).toBeTruthy())
    }
    const active = (): string | null =>
      screen.getAllByRole('tab').find((el) => el.getAttribute('aria-selected') === 'true')?.textContent ?? null

    await switchTo('需求-b') // b's first visit — falls back to the first tab
    expect(active()).toBe('概览')
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    await waitFor(() => expect(active()).toBe('工作区'))

    await switchTo('需求-a') // a remembered 工作区, not b's state
    expect(active()).toBe('工作区')
    await switchTo('需求-b') // b remembered 工作区 too — its own memory
    expect(active()).toBe('工作区')
    unmount()
  })

  // 0004 P2 bug fix: the close-on-scroll listener is a window capture
  // listener, which hears the menu's own list scrolling too — scrolling the
  // list must not close the menu; scrolling the page must.
  it('the switcher menu survives its own list scroll and closes on page scroll', async () => {
    const { unmount } = page()
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '切换需求' }))
    await waitFor(() => screen.getByRole('menuitem', { name: '需求-b' }))

    const viewport = document.querySelector("[role='menu'] > [role='presentation']")
    expect(viewport).not.toBeNull()
    fireEvent.scroll(viewport as Element) // the list's own scroll — must stay open
    expect(screen.getByRole('menuitem', { name: '需求-b' })).toBeTruthy()

    fireEvent.scroll(document.body) // the page scrolled away — a leave intent
    expect(screen.queryByRole('menuitem', { name: '需求-b' })).toBeNull()
    unmount()
  })

  it('hides the switcher when only one requirement exists', async () => {
    const { unmount } = page({ list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, requirements: [record('a')] })) })
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /需求-a/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '需求-a' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: '切换需求' })).toBeNull()
    unmount()
  })
})

describe('RequirementsIcon', () => {
  it('draws the real ui-primitives glyph at the requested size', () => {
    const { container, unmount } = render(<RequirementsIcon size={16} active={false} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
    unmount()
    const { container: c2 } = render(<RequirementsIcon size={18} active />)
    expect(c2.querySelector('svg')?.getAttribute('width')).toBe('18')
    c2.querySelector('svg')?.remove()
  })
})

/**
 * The row time and the sort control (需求列表页迭代). TZ is pinned because
 * createdAtText reads the LOCAL date fields — an unpinned expectation would
 * ride the runner's clock. pinTz/restore spans a render (the row formats at
 * render time); withTz wraps a synchronous call.
 */
function pinTz(tz: string): () => void {
  const previous = process.env.TZ
  process.env.TZ = tz
  return () => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

function withTz(tz: string, run: () => void): void {
  const restore = pinTz(tz)
  try {
    run()
  } finally {
    restore()
  }
}

describe('createdAtText', () => {
  it('renders the browser-local wall clock, not the stored UTC string', () => {
    withTz('Asia/Shanghai', () => {
      expect(createdAtText('2026-09-25T09:30:00.000Z')).toBe('2026-09-25 17:30')
    })
    withTz('America/New_York', () => {
      expect(createdAtText('2026-09-25T09:30:00.000Z')).toBe('2026-09-25 05:30')
    })
  })

  it('crosses to the previous local day when UTC is still ahead', () => {
    // The slice(0, 16) shortcut would print 2026-09-25 here — a day off for
    // anyone east of Greenwich. This is the regression the formatter exists for.
    withTz('Asia/Shanghai', () => {
      expect(createdAtText('2026-09-24T20:00:00.000Z')).toBe('2026-09-25 04:00')
    })
    withTz('America/New_York', () => {
      expect(createdAtText('2026-09-25T02:00:00.000Z')).toBe('2026-09-24 22:00')
    })
  })

  it('accepts an offset-bearing timestamp and rejects an unparsable one with ""', () => {
    withTz('UTC', () => {
      expect(createdAtText('2026-09-25T17:30:00+08:00')).toBe('2026-09-25 09:30')
      expect(createdAtText('not-a-time')).toBe('')
      expect(createdAtText('')).toBe('')
    })
  })
})

describe('RequirementsPage (需求列表页迭代: one column, creation time, sorting)', () => {
  /** Row ids in DOM order — the list renders exactly what it is handed. */
  const rowOrder = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('li button')]
      .map((el) => (el.textContent ?? '').match(/需求-([a-z]+)/)?.[1] ?? '')
      .filter((id) => id.length > 0)

  /**
   * The sort trigger, scoped to this render's container. The anchor is
   * in-place, so a container-scoped query is both accurate and immune to a
   * portal leaked by an earlier failing test — without it, one red test turns
   * the rest into "found multiple 排序 buttons" noise instead of showing the
   * real failure. The menu LIST still portals, so its items are queried
   * globally, exactly as the row-menu tests do.
   */
  const sortTrigger = (container: HTMLElement): HTMLElement =>
    within(container).getByRole('button', { name: /排序/ })

  it('shows each record\'s creation time on the title line, with the wire timestamp on hover', async () => {
    // TZ must be set BEFORE render: the row prints the local clock at render
    // time, so an unpinned expectation would ride the runner's zone.
    const restore = pinTz('Asia/Shanghai')
    try {
      const { container, unmount } = page({
        list: vi.fn(async () => ({
          kind: 'ok' as const,
          revision: 1,
          requirements: [record('a', '2026-09-25T09:30:00.000Z')],
        })),
      })
      await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
      const time = screen.getByText('创建于 2026-09-25 17:30')
      expect(time.getAttribute('title')).toBe('2026-09-25T09:30:00.000Z')
      // The time rides the title line inside the row's open button, not a
      // separate trailing cell (the menu anchor owns that spot).
      expect(time.closest('button')?.textContent).toContain('需求-a')
      expect(container.querySelector('ul')).toBeTruthy()
      unmount()
    } finally {
      restore()
    }
  })

  it('drops the time cell when the stored timestamp is unparsable', async () => {
    const { unmount } = page({
      list: vi.fn(async () => ({
        kind: 'ok' as const,
        revision: 1,
        requirements: [record('a', 'not-a-time')],
      })),
    })
    await waitFor(() => expect(screen.getByText('需求-a')).toBeTruthy())
    // No "Invalid Date" ever reaches a row — the cell is absent instead.
    expect(screen.queryByText(/创建于/)).toBeNull()
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    unmount()
  })

  it('orders newest-first by default and flips from the sort menu', async () => {
    const { container, unmount } = page({
      list: vi.fn(async () => ({
        kind: 'ok' as const,
        revision: 1,
        // Ledger (file) order is oldest-first — the default view must NOT match it.
        requirements: [
          record('old', '2026-09-10T08:00:00.000Z'),
          record('new', '2026-09-25T08:00:00.000Z'),
        ],
      })),
    })
    await waitFor(() => expect(screen.getByText('需求-old')).toBeTruthy())
    expect(rowOrder(container)).toEqual(['new', 'old'])
    // The trigger labels the current direction — visibly AND in its accessible
    // name. A bare aria-label="排序" would override the visible text and leave
    // a screen-reader user unable to tell which order they are looking at.
    expect(sortTrigger(container).textContent).toContain('创建时间倒序')
    expect(sortTrigger(container).getAttribute('aria-label')).toBe('排序: 创建时间倒序')

    fireEvent.click(sortTrigger(container))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: '创建时间正序' })))
    await waitFor(() => expect(rowOrder(container)).toEqual(['old', 'new']))
    expect(sortTrigger(container).textContent).toContain('创建时间正序')
    expect(sortTrigger(container).getAttribute('aria-label')).toBe('排序: 创建时间正序')
    unmount()
  })

  it('sorts the filtered subset, keeping the filter\'s own matches', async () => {
    const { container, unmount } = page({
      list: vi.fn(async () => ({
        kind: 'ok' as const,
        revision: 1,
        requirements: [
          record('old', '2026-09-10T08:00:00.000Z'),
          record('new', '2026-09-25T08:00:00.000Z'),
          { ...record('other', '2026-09-20T08:00:00.000Z'), title: '别的需求', description: '不匹配' },
        ],
      })),
    })
    await waitFor(() => expect(screen.getByText('需求-old')).toBeTruthy())
    fireEvent.change(within(container).getByPlaceholderText('按标题 / 描述筛选'), { target: { value: '需求-' } })
    await waitFor(() => expect(rowOrder(container)).toEqual(['new', 'old']))
    fireEvent.click(sortTrigger(container))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: '创建时间正序' })))
    await waitFor(() => expect(rowOrder(container)).toEqual(['old', 'new']))
    // The non-matching record stays out under both directions.
    expect(within(container).queryByText('别的需求')).toBeNull()
    unmount()
  })

  it('the chosen direction survives a panel round-trip (unmount + remount on the same store)', async () => {
    // The host's keyed main slot has no keep-alive: a panel switch unmounts
    // this component. The direction rides the store, like the filter does.
    const { container, unmount, store, controller, detailTabs, renderSlot } = page({
      list: vi.fn(async () => ({
        kind: 'ok' as const,
        revision: 1,
        requirements: [
          record('old', '2026-09-10T08:00:00.000Z'),
          record('new', '2026-09-25T08:00:00.000Z'),
        ],
      })),
    })
    await waitFor(() => expect(within(container).getByText('需求-old')).toBeTruthy())
    fireEvent.click(sortTrigger(container))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: '创建时间正序' })))
    await waitFor(() => expect(rowOrder(container)).toEqual(['old', 'new']))
    unmount()

    const remount = render(
      <RequirementsPage
        t={bindZh()}
        store={store}
        controller={controller}
        detailTabs={detailTabs}
        renderSlot={renderSlot}
      />,
    )
    // Scoped to this render's container on both waits: an earlier test that
    // failed before its unmount() leaves its rows mounted globally, and a
    // global getByText then reports "found multiple" instead of showing what
    // actually broke.
    await waitFor(() => expect(within(remount.container).getByText('需求-old')).toBeTruthy())
    expect(rowOrder(remount.container)).toEqual(['old', 'new'])
    expect(sortTrigger(remount.container).textContent).toContain('创建时间正序')
    remount.unmount()
  })

  it('stays reorderable while busy — reordering hits no endpoint, so it waits on nothing', async () => {
    // Deliberate divergence from the detailSwitch idiom this button copies,
    // which carries disabled={state.busy}. Pinning it because the regression
    // would arrive as a plausible-looking copy of the neighbour: a user saving
    // one requirement would find the whole list's order locked until the
    // round-trip lands.
    const { container, unmount, store } = page({
      list: vi.fn(async () => ({
        kind: 'ok' as const,
        revision: 1,
        requirements: [
          record('old', '2026-09-10T08:00:00.000Z'),
          record('new', '2026-09-25T08:00:00.000Z'),
        ],
      })),
    })
    await waitFor(() => expect(within(container).getByText('需求-old')).toBeTruthy())
    const rowMenus = (): HTMLButtonElement[] =>
      [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑"]')]
    expect(rowMenus()[0].disabled).toBe(false)

    store.set({ ...store.getSnapshot(), busy: true })
    // The store is raf-flushed, so getSnapshot() already reports busy while the
    // DOM still shows the previous render — waiting on the snapshot would let
    // the assertion below read a stale button and pass for nothing. Wait on a
    // row menu anchor instead: it shares disabled={state.busy}, so its flip
    // proves React has actually re-rendered with busy=true.
    await waitFor(() => expect(rowMenus()[0].disabled).toBe(true))
    expect((sortTrigger(container) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(sortTrigger(container))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: '创建时间正序' })))
    await waitFor(() => expect(rowOrder(container)).toEqual(['old', 'new']))
    unmount()
  })

  it('the list container declares a single grid track', () => {
    // jsdom computes no layout, so the one-column shape is pinned at its only
    // source of truth: the stylesheet. A repeat(2, …) regression is a silent
    // visual one — nothing in the DOM changes. Read by cwd-relative path:
    // under the jsdom environment import.meta.url is not a file: URL.
    // The assertion carries the property name so `repeat(2, minmax(0, 1fr))`
    // — which contains the track function — still fails it.
    const css = readFileSync('src/client/requirements/view.module.css', 'utf8')
    const listBlock = /\.list\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(listBlock).toContain('grid-template-columns: minmax(0, 1fr)')
  })
})
