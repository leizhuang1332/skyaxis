// @vitest-environment jsdom
/**
 * Requirements page view rendering: the real components against jsdom with
 * the real ui-primitives atoms and a fake data layer (fetcher/controller/
 * store wired exactly as register.tsx does). Covers list rows, banners,
 * degraded and empty states, and the icon glyph sizes.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { createRequirementsController } from '../../src/client/requirements/controller.js'
import { createRequirementsStore } from '../../src/client/requirements/store.js'
import { RequirementsIcon, RequirementsPage } from '../../src/client/requirements/view.js'
import type { RequirementsFetcher } from '../../src/client/requirements/fetcher.js'

const DICT = {
  zh: {
    'panel.title': '需求管理',
    'page.empty': '尚未添加任何需求。点击右上角「新增需求」开始。',
    'page.loading': '正在加载需求清单…',
    'page.degraded': '需求清单文件无法读取，已显示为空清单。',
    'page.degradedBackupHint': '检测到备份文件：requirements.yaml.bak。',
    'view.addRequirement': '新增需求',
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
  const utils = render(<RequirementsPage t={bindZh()} store={store} controller={controller} />)
  return { ...utils, store, controller, fetcher }
}

describe('RequirementsPage (P2)', () => {
  it('renders the header, add button, and requirement rows', async () => {
    const { unmount } = page()
    expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增需求' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('需求-a')).toBeTruthy()
      expect(screen.getByText('说明 b')).toBeTruthy()
    })
    unmount()
  })

  it('shows the empty state when the list is empty', async () => {
    const { unmount } = page({ list: vi.fn(async () => ({ kind: 'ok' as const, revision: 0, requirements: [] })) })
    await waitFor(() => {
      expect(screen.getByText(DICT.zh['page.empty'])).toBeTruthy()
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
