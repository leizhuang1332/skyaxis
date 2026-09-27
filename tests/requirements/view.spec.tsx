// @vitest-environment jsdom
/**
 * Requirements page view rendering: the real components against jsdom with
 * the real ui-primitives atoms and a fake data layer (fetcher/controller/
 * store wired exactly as register.tsx does). Covers list rows, the add
 * card, banners, degraded state, filtering, and the icon glyph sizes.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import { createDetailTabsStore } from '../../src/client/requirements/register.jsx'
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
    'form.closeLabel': '关闭',
    'menu.edit': '编辑',
    'menu.remove': '删除',
    'delete.title': '删除需求',
    'delete.description': '确定要删除该需求吗？此操作仅移除清单记录。',
    'delete.confirm': '删除',
    'delete.cancel': '取消',
    'detail.back': '返回',
    'detail.missing': '该需求已不存在。',
    'error.network': '网络错误，请稍后重试',
  },
} as const

function bindZh(): RequirementsT {
  return (key) => (DICT.zh as Record<string, string>)[key] ?? key
}

const record = (id: string): RequirementRecord => ({
  id,
  title: `需求-${id}`,
  description: `说明 ${id}`,
  workspacePath: '',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
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
  return { ...utils, store, controller, fetcher }
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
    await waitFor(() => expect(screen.getByText('确定要删除该需求吗？此操作仅移除清单记录。')).toBeTruthy())
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
