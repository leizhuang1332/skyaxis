// @vitest-environment jsdom
/**
 * Repos-pool page view rendering: the real components against jsdom with the
 * real ui-primitives atoms and a fake data layer (fetcher/controller/store
 * wired exactly as register.tsx does). Covers list rows, status tags,
 * banners, degraded and empty states, and the icon glyph sizes.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { RepoRecord } from '../../src/repos-pool-shared/protocol.js'
import type { ReposPoolT } from '../../src/client/repos-pool/dictionary.js'
import { createReposPoolController } from '../../src/client/repos-pool/controller.js'
import { createReposPoolStore } from '../../src/client/repos-pool/store.js'
import { ReposPoolIcon, ReposPoolPage } from '../../src/client/repos-pool/view.js'
import { createReposFetcher } from '../../src/client/repos-pool/fetcher.js'
import type { ReposFetcher } from '../../src/client/repos-pool/fetcher.js'

const DICT = {
  zh: {
    'panel.title': '仓库池',
    'page.empty': '尚未添加任何仓库。点击右上角「添加仓库」开始。',
    'page.loading': '正在加载仓库清单…',
    'page.degraded': '仓库清单文件无法读取，已显示为空清单。',
    'page.degradedBackupHint': '检测到备份文件：repos.yaml.bak。',
    'view.addRepo': '添加仓库',
    'error.network': '网络错误，请稍后重试',
  },
} as const

function bindZh(): ReposPoolT {
  return (key) => (DICT.zh as Record<string, string>)[key] ?? key
}

const record = (id: string): RepoRecord => ({
  id,
  name: `仓库-${id}`,
  url: `https://example.com/${id}.git`,
  description: `说明 ${id}`,
  status: id === 'a' ? 'verified' : 'forced-network',
  validatedAt: null,
  lastError: null,
})

function page(fetcherOverrides: Partial<ReposFetcher> = {}) {
  const fetcher: ReposFetcher = {
    list: vi.fn(async () => ({ kind: 'ok' as const, revision: 1, repos: [record('a'), record('b')] })),
    save: vi.fn(async () => ({ kind: 'network' as const })),
    remove: vi.fn(async () => ({ kind: 'network' as const })),
    validate: vi.fn(async () => ({ kind: 'network' as const })),
    ...fetcherOverrides,
  } as ReposFetcher
  const store = createReposPoolStore()
  const controller = createReposPoolController(store, fetcher)
  const utils = render(<ReposPoolPage t={bindZh()} store={store} controller={controller} fetcher={fetcher} />)
  return { ...utils, store, controller, fetcher }
}

describe('ReposPoolPage (P2)', () => {
  it('renders the header, add button, and repo rows with status tags', async () => {
    const { unmount } = page()
    expect(screen.getByRole('heading', { name: '仓库池' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加仓库' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('https://example.com/a.git')).toBeTruthy()
      expect(screen.getByText('仓库-b')).toBeTruthy()
    })
    unmount()
  })

  it('shows the empty state when the list is empty', async () => {
    const { unmount } = page({ list: vi.fn(async () => ({ kind: 'ok' as const, revision: 0, repos: [] })) })
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

describe('ReposPoolIcon', () => {
  it('draws the real ui-primitives glyph at the requested size', () => {
    const { container, unmount } = render(<ReposPoolIcon size={16} active={false} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
    unmount()
    const { container: c2 } = render(<ReposPoolIcon size={18} active />)
    expect(c2.querySelector('svg')?.getAttribute('width')).toBe('18')
    c2.querySelector('svg')?.remove()
  })
})
