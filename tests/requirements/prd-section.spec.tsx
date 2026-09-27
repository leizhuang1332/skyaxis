// @vitest-environment jsdom
/**
 * PRD section: the header actions (upload via hidden file input, create
 * dialog with .md suffix completion), the doc rows, delete confirmation,
 * preview modal fetch wiring, and inline error copy. Assertions stay at the
 * call/dialog layer — MarkdownText's rendering is a proxy stub under vitest
 * and its DOM is not predictable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsController } from '../../src/client/requirements/controller.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { PrdSection } from '../../src/client/requirements/prd-section.js'

const DICT = {
  zh: {
    'prd.upload': '上传文件',
    'prd.manualCreate': '手动创建',
    'prd.recommend': '推荐',
    'prd.uploadHint': '点击选择文件，支持任意类型（≤32MB）',
    'prd.create': '新建文档',
    'prd.createTitle': '新建文档',
    'prd.emptyHint': '上传任意文件或新建 Markdown，保存在工作区 prds/ 目录。',
    'prd.nameLabel': '文件名',
    'prd.namePlaceholder': '例如：搜索方案',
    'prd.contentLabel': '内容',
    'prd.mdSuffixHint': '未以 .md 结尾时将自动补上 .md',
    'prd.loadError': 'PRD 清单加载失败',
    'prd.menuLabel': '文档操作',
    'prd.preview': '预览',
    'prd.delete': '删除',
    'prd.deleteTitle': '删除文档',
    'prd.deleteDesc': '将从磁盘删除该文件，此操作不可恢复。',
    'prd.deleteConfirm': '删除',
    'prd.previewFailed': '预览加载失败',
    'prd.errDuplicate': '同名文件已存在',
    'prd.errTooLarge': '文件超过 32MB 上限',
    'prd.errInvalidName': '文件名无效',
    'prd.timeNow': '刚刚',
    'workspace.sectionPrd': 'PRD 文档',
    'form.cancel': '取消',
    'form.submit': '保存',
    'form.submitting': '保存中…',
    'form.closeLabel': '关闭',
  },
} as const

const bindZh = (): RequirementsT => (key) => (DICT.zh as Record<string, string>)[key] ?? key

const record = (workspacePath = '/ws'): RequirementRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '既有需求',
  description: '既有说明',
  workspacePath,
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

function fakeController(): RequirementsController {
  return {
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    workspaceStatus: vi.fn(async () => ({ kind: 'ok' as const })),
    setWorkspace: vi.fn(async () => 'ok' as const),
    clearWorkspace: vi.fn(async () => 'ok' as const),
    rebindWorkspace: vi.fn(async () => 'ok' as const),
    repoTasks: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    linkRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    unlinkRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    recloneRepo: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    cancelRepoClone: vi.fn(async () => ({ kind: 'ok' as const, tasks: [] })),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    closeForm: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as RequirementsController
}

const jsonResponse = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })

function stubDocs(docs: Array<{ name: string; size?: number; modifiedAt?: number }> = [], ok = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/prd-upload')) return jsonResponse({ ok: true, docs })
    if (url.includes('name=')) return jsonResponse('# preview text', 200, 'text/plain')
    return jsonResponse(ok ? { ok: true, docs } : { ok: false, degraded: true, reason: 'parse' as const, hasBackup: false })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function subject(controller = fakeController(), workspacePath = '/ws') {
  return render(<PrdSection t={bindZh()} requirement={record(workspacePath)} controller={controller} />)
}

describe('PrdSection (0003 P3c: PRD documents)', () => {
  it('empty listing renders the dashed action card (repos-section twin), no head button', async () => {
    vi.stubGlobal('fetch', stubDocs())
    const { unmount } = subject()
    await waitFor(() => expect(screen.getByRole('button', { name: DICT.zh['prd.create'] })).toBeTruthy())
    // The whole card IS the button, carrying the empty hint and the action.
    expect(screen.getByText(DICT.zh['prd.emptyHint'])).toBeTruthy()
    // No standalone upload button — the affordance lives in the create dialog.
    expect(screen.queryByRole('button', { name: DICT.zh['prd.upload'] })).toBeNull()

    // Non-empty listing swaps the card for the head row with the same action.
    unmount()
    vi.stubGlobal('fetch', stubDocs([{ name: 'a.md', size: 1, modifiedAt: 1 }]))
    const second = subject()
    await waitFor(() => expect(screen.getByText('a.md')).toBeTruthy())
    expect(screen.getByRole('button', { name: DICT.zh['prd.create'] })).toBeTruthy()
    second.unmount()
  })

  it('renders rows with name, size and time; non-md rows lack the preview menu item', async () => {
    vi.stubGlobal('fetch', stubDocs([
      { name: '方案.md', size: 12, modifiedAt: Date.now() },
      { name: 'spec.pdf', size: 4096, modifiedAt: Date.now() },
    ]))
    const { unmount } = subject()
    await waitFor(() => expect(screen.getByText('方案.md')).toBeTruthy())
    expect(screen.getByText('spec.pdf')).toBeTruthy()
    // prdMeta renders 'size · time' as one span — match by fragment.
    expect(screen.getByText(/12B/)).toBeTruthy()
    expect(screen.getAllByText(new RegExp(DICT.zh['prd.timeNow']))).toHaveLength(2)

    const menus = screen.getAllByRole('button', { name: DICT.zh['prd.menuLabel'] })
    fireEvent.click(menus[1]!) // spec.pdf row
    await waitFor(() => expect(screen.getByRole('menuitem', { name: DICT.zh['prd.delete'] })).toBeTruthy())
    expect(screen.queryByRole('menuitem', { name: DICT.zh['prd.preview'] })).toBeNull()
    unmount()
  })

  it('create dialog: empty name blocked, .md appended, success seeds the listing', async () => {
    // GET answers empty; the create POST answers with the created row.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/prd-upload')) return jsonResponse({ ok: true, docs: [] })
      if (init?.method === 'POST') {
        return jsonResponse({ ok: true, docs: [{ name: '搜索方案.md', size: 7, modifiedAt: 1 }] })
      }
      return jsonResponse({ ok: true, docs: [] })
    }))
    const { unmount } = subject()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['prd.create'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['form.submit'] }))
    // Empty name: inline error, dialog stays, no create request.
    await waitFor(() => expect(screen.getByText(DICT.zh['prd.errInvalidName'])).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(DICT.zh['prd.namePlaceholder']), { target: { value: '搜索方案' } })
    fireEvent.change(screen.getByRole('textbox', { name: DICT.zh['prd.contentLabel'] }), { target: { value: '# 内容' } })
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['form.submit'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getByText('搜索方案.md')).toBeTruthy())
    unmount()
  })

  it('delete asks for confirmation and seeds the response listing', async () => {
    vi.stubGlobal('fetch', stubDocs([{ name: 'old.md', size: 5, modifiedAt: 1 }]))
    const { unmount } = subject()
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: DICT.zh['prd.menuLabel'] })))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: DICT.zh['prd.delete'] })))
    await waitFor(() => expect(screen.getByText(DICT.zh['prd.deleteDesc'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['prd.deleteConfirm'] }))
    // The stub answers with the same doc list; the dialog must be gone.
    await waitFor(() => expect(screen.queryByText(DICT.zh['prd.deleteDesc'])).toBeNull())
    unmount()
  })

  it('preview: clicking the markdown card opens the modal and fetches its content', async () => {
    vi.stubGlobal('fetch', stubDocs([{ name: 'plan.md', size: 9, modifiedAt: 1 }]))
    const { unmount } = subject()
    // Card click (P3c feedback) — no menu round-trip needed.
    fireEvent.click(await waitFor(() => screen.getByText('plan.md')))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    await waitFor(() => {
      const called = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => String(call[0]))
        .some((url) => url.includes('name=plan.md'))
      expect(called).toBe(true)
    })
    unmount()
  })

  it('upload rides in the create dialog: pick a file there and it uploads', async () => {
    vi.stubGlobal('fetch', stubDocs())
    const { unmount } = subject()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['prd.create'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByRole('button', { name: DICT.zh['prd.upload'] })).toBeTruthy()
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    expect(input).toBeTruthy()
    const file = new File(['abc'], '上传.pdf')
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => [String(c[0]), c[1]] as const)
        .find(([url]) => url.includes('/prd-upload'))
      expect(call).toBeTruthy()
      expect(call![0]).toContain(encodeURIComponent('上传.pdf'))
      expect((call![1] as RequestInit).body).toBe(file)
    })
    expect(input.value).toBe('')
    unmount()
  })

  it('oversized files are rejected client-side without a request', async () => {
    const fetchMock = stubDocs()
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = subject()
    fireEvent.click(screen.getByRole('button', { name: DICT.zh['prd.create'] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const huge = new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'huge.bin')
    fireEvent.change(input, { target: { files: [huge] } })
    await waitFor(() => expect(screen.getByText(DICT.zh['prd.errTooLarge'])).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/prd-upload'), expect.anything())
    unmount()
  })

  it('non-markdown cards are not clickable for preview', async () => {
    vi.stubGlobal('fetch', stubDocs([{ name: 'spec.pdf', size: 4, modifiedAt: 1 }]))
    const { unmount } = subject()
    const name = await waitFor(() => screen.getByText('spec.pdf'))
    // The pdf card renders a plain div — the closest button is absent.
    expect(name.closest('button')).toBeNull()
    unmount()
  })
})
