// @vitest-environment jsdom
/**
 * ImportDialog flow against a fake controller: pick → dry-run preview →
 * confirm (anchored to the DRY-RUN response revision, never the store's) →
 * done report, plus the failure branches (409 stale with manual re-preview
 * only — no auto-chaining, unreadable terminal, parse error re-pick), the
 * two-stage size guard (bytes before reading, code units after), and the
 * importing-state close lock.
 *
 * jsdom's File has no .text() — every fixture duck-patches it (the plan's
 * documented workaround).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImportReport } from '../../src/repos-pool-shared/protocol.js'
import type { ReposPoolT } from '../../src/client/repos-pool/dictionary.js'
import { ImportDialog } from '../../src/client/repos-pool/import-dialog.js'

const DICT = {
  'import.title': '导入仓库配置',
  'import.pick': '选择配置文件',
  'import.pickHint': '点击选择 JSON / YAML 配置文件',
  'import.reading': '正在读取文件…',
  'import.previewing': '正在生成导入预览…',
  'import.importing': '正在导入…',
  'import.previewHint': '以下为导入预览（尚未写入）：',
  'import.created': '新增',
  'import.updated': '更新',
  'import.unchanged': '不变',
  'import.skipped': '跳过',
  'import.skippedTitle': '跳过的条目：',
  'import.unnamed': '（未命名）',
  'import.confirm': '确认导入',
  'import.rePreview': '重新预览',
  'import.doneTitle': '导入完成',
  'import.finish': '完成',
  'import.rePick': '重新选择文件',
  'import.staleHint': '清单已在别处被修改，请重新预览后再确认',
  'import.errTooLarge': '文件超出大小上限（约 2M 字符）',
  'import.errParse': '文件内容无法解析，请检查格式（JSON 数组或 repos.yaml 格式）',
  'import.errConflict': '清单已在别处被修改，请重新预览',
  'import.errUnreadable': '仓库清单文件不可读（可能已损坏），请检查 repos.yaml',
  'import.errNetwork': '网络错误，请稍后重试',
  'form.cancel': '取消',
  'form.closeLabel': '关闭',
  'skipReason.emptyUrls': '未提供任何地址',
  'skipReason.invalidUrl': '地址不合法',
  'skipReason.slotConflict': '两个地址同族争抢同一槽位',
  'error.urlSchemeForbidden': '协议不在允许范围',
} as const

const t: ReposPoolT = (key) => (DICT as Record<string, string>)[key] ?? key

afterEach(cleanup)

const REPORT: ImportReport = {
  created: 2,
  updated: 1,
  unchanged: 3,
  skipped: [
    { name: 'bad-repo', reason: 'invalid-url', detail: 'scheme-forbidden' },
    { name: '', reason: 'empty-urls' },
    { name: 'twin', reason: 'slot-conflict', detail: '两个 http 地址争抢同一槽位' },
  ],
}

const CONTENT = '[{"name":"demo","url-http":"https://example.com/demo.git"}]'

/** A jsdom File with a duck-patched text() (jsdom ships none). */
function makeFile(content: string, name = 'repos.json'): File {
  const file = new File([content], name, { type: 'application/json' })
  return Object.assign(file, { text: async () => content })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

interface SetupOptions {
  /** Resolves every importRepos call; override per test for branches. */
  result?: unknown
  revision?: number
}

function setup(options?: SetupOptions) {
  const importRepos = vi.fn(async () =>
    options?.result ?? { kind: 'ok' as const, revision: 7, repos: [], report: REPORT })
  const controller = { importRepos } as never
  const onClose = vi.fn()
  const utils = render(
    <ImportDialog t={t} open revision={options?.revision ?? 3} controller={controller} onClose={onClose} />,
  )
  return { ...utils, importRepos, onClose }
}

type Utils = ReturnType<typeof setup>
const calls = (utils: Utils): Array<[string, { dryRun: boolean; expectedRevision: number }]> =>
  utils.importRepos.mock.calls as unknown as Array<[string, { dryRun: boolean; expectedRevision: number }]>

/** Pick the file through the hidden input (the card button proxies to it).
 *  The Modal portals into document.body — query at document scope, not the
 *  render container. */
function pickFile(file: File): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(input).toBeTruthy()
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
}

describe('ImportDialog 预览与确认', () => {
  it('pick → dry-run → preview renders the four counts and the skipped detail', async () => {
    const utils = setup()
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    expect(screen.getByText('新增')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('更新')).toBeTruthy()
    expect(screen.getByText('不变')).toBeTruthy()
    // Skipped list is expanded by default, one line per entry.
    expect(screen.getByText('跳过的条目：')).toBeTruthy()
    expect(screen.getByText(/bad-repo/)).toBeTruthy()
    expect(screen.getByText(/地址不合法（协议不在允许范围）/)).toBeTruthy()
    // Unnamed entries fall back to the placeholder; the host-localized
    // slot-conflict detail is NEVER echoed (language-leak guard).
    expect(screen.getByText(/（未命名）/)).toBeTruthy()
    expect(screen.queryByText(/两个 http 地址争抢同一槽位/)).toBeNull()
    expect(screen.getByText(/两个地址同族争抢同一槽位/)).toBeTruthy()
    // The dry-run went out with the STORE revision as the anchor.
    expect(calls(utils)).toHaveLength(1)
    expect(calls(utils)[0]).toEqual([CONTENT, { dryRun: true, expectedRevision: 3 }])
  })

  it('confirm carries the DRY-RUN RESPONSE revision, not the store revision (3.1 regression anchor)', async () => {
    // Store revision 3, dry-run responds revision 7 (pool moved in between):
    // the real import must anchor to 7 — the snapshot the user previewed.
    const utils = setup({ result: { kind: 'ok', revision: 7, repos: [], report: REPORT }, revision: 3 })
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(screen.getByText('导入完成')).toBeTruthy())
    expect(calls(utils)).toHaveLength(2)
    expect(calls(utils)[1]).toEqual([CONTENT, { dryRun: false, expectedRevision: 7 }])
    // Done state shows the real report and a single finish action.
    expect(screen.getByText('新增')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(utils.onClose).toHaveBeenCalledTimes(1)
  })

  it('dry-run 409 lands in the stale state; only the USER re-runs the preview (no auto-chain)', async () => {
    let conflict = true
    const importRepos = vi.fn(async () =>
      conflict ? { kind: 'failed' as const, code: 'conflict' as const } : { kind: 'ok' as const, revision: 9, repos: [], report: REPORT })
    const onClose = vi.fn()
    const utils = render(
      <ImportDialog t={t} open revision={3} controller={{ importRepos } as never} onClose={onClose} />,
    )
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('清单已在别处被修改，请重新预览后再确认')).toBeTruthy())
    expect(importRepos).toHaveBeenCalledTimes(1)
    // Manual re-preview against the refreshed snapshot.
    conflict = false
    fireEvent.click(screen.getByRole('button', { name: '重新预览' }))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    const all = importRepos.mock.calls as unknown as Array<[string, { dryRun: boolean; expectedRevision: number }]>
    expect(all).toHaveLength(2)
    expect(all[1][1].dryRun).toBe(true) // re-preview is a dry-run, never an import
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(screen.getByText('导入完成')).toBeTruthy())
    const final = importRepos.mock.calls as unknown as Array<[string, { dryRun: boolean; expectedRevision: number }]>
    expect(final).toHaveLength(3)
    expect(final[2][1]).toEqual({ dryRun: false, expectedRevision: 9 })
  })

  it('confirm-time 409 returns to the stale state (the preview is NOT silently re-run)', async () => {
    let phase = 'preview'
    const importRepos = vi.fn(async () => {
      if (phase === 'preview') return { kind: 'ok' as const, revision: 7, repos: [], report: REPORT }
      return { kind: 'failed' as const, code: 'conflict' as const }
    })
    const utils = render(
      <ImportDialog t={t} open revision={3} controller={{ importRepos } as never} onClose={vi.fn()} />,
    )
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    phase = 'confirm'
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(screen.getByText('清单已在别处被修改，请重新预览后再确认')).toBeTruthy())
    // Exactly two calls so far: the conflict did NOT auto-chain a third.
    expect(importRepos).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '重新预览' })).toBeTruthy()
  })
})

describe('ImportDialog 失败分支', () => {
  it('unreadable-file is a terminal error with a re-pick action', async () => {
    const utils = setup({ result: { kind: 'failed', code: 'unreadable-file' } })
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('仓库清单文件不可读（可能已损坏），请检查 repos.yaml')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }))
    await waitFor(() => expect(screen.getByText('点击选择 JSON / YAML 配置文件')).toBeTruthy())
  })

  it('a bad-parse response surfaces the format hint', async () => {
    const utils = setup({ result: { kind: 'failed', code: 'bad-request' } })
    pickFile(makeFile('}}}not yaml{{{', 'broken.yaml'))
    await waitFor(() => expect(screen.getByText('文件内容无法解析，请检查格式（JSON 数组或 repos.yaml 格式）')).toBeTruthy())
    expect(screen.getByRole('button', { name: '重新选择文件' })).toBeTruthy()
  })

  it('a network failure on confirm shows the retry error copy', async () => {
    let phase = 'preview'
    const importRepos = vi.fn(async () =>
      phase === 'preview'
        ? { kind: 'ok' as const, revision: 7, repos: [], report: REPORT }
        : { kind: 'failed' as const, code: 'network' as const })
    const utils = render(
      <ImportDialog t={t} open revision={3} controller={{ importRepos } as never} onClose={vi.fn()} />,
    )
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    phase = 'confirm'
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(screen.getByText('网络错误，请稍后重试')).toBeTruthy())
  })
})

describe('ImportDialog 两段 size 防线', () => {
  it('stage 1 (bytes): an over-8MiB file is rejected WITHOUT being read', async () => {
    const utils = setup()
    const huge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'huge.yaml')
    const text = vi.fn(async () => { throw new Error('must not be read') })
    Object.assign(huge, { text })
    pickFile(huge)
    await waitFor(() => expect(screen.getByText('文件超出大小上限（约 2M 字符）')).toBeTruthy())
    expect(text).not.toHaveBeenCalled()
    expect(utils.importRepos).not.toHaveBeenCalled()
  })

  it('stage 2 (code units): a small-bytes file whose text exceeds the char cap never hits the network', async () => {
    const utils = setup()
    const wide = makeFile('x'.repeat(2_000_001))
    Object.defineProperty(wide, 'size', { value: 1024 }) // bytes small, chars huge
    pickFile(wide)
    await waitFor(() => expect(screen.getByText('文件超出大小上限（约 2M 字符）')).toBeTruthy())
    expect(utils.importRepos).not.toHaveBeenCalled()
  })
})

describe('ImportDialog importing 态闭锁', () => {
  it('closing is refused while the real import is in flight, and allowed again once done', async () => {
    const done = deferred<{ kind: 'ok'; revision: number; repos: []; report: ImportReport }>()
    let phase = 'preview'
    const importRepos = vi.fn(() =>
      phase === 'preview'
        ? Promise.resolve({ kind: 'ok' as const, revision: 7, repos: [] as [], report: REPORT })
        : done.promise)
    const onClose = vi.fn()
    const utils = render(
      <ImportDialog t={t} open revision={3} controller={{ importRepos } as never} onClose={onClose} />,
    )
    pickFile(makeFile(CONTENT))
    await waitFor(() => expect(screen.getByText('以下为导入预览（尚未写入）：')).toBeTruthy())
    phase = 'confirm'
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(screen.getByText('正在导入…')).toBeTruthy())
    // The Modal close button exists but its onClose is locked while importing
    // (the server has committed — closing must not read as a cancel).
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).not.toHaveBeenCalled()
    done.resolve({ kind: 'ok', revision: 8, repos: [], report: REPORT })
    await waitFor(() => expect(screen.getByText('导入完成')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(utils.unmount).toBeTypeOf('function')
    utils.unmount()
  })
})
