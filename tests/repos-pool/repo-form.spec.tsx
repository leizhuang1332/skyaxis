// @vitest-environment jsdom
/**
 * RepoForm P3 two-box flow against a mocked fetcher/controller — each box IS
 * its slot (SSH box → urlSsh, HTTP box → urlHttp). Covers: per-slot probe +
 * verdict matrix (verified/unverified/gates), submit-time local interception
 * (syntax, family mismatch, same-value, duplicates), per-slot settle with the
 * stale-response guard, the single canSave derivation (blocked sibling +
 * unacked gates disable EVERY confirm path), unchanged-slot skipping, and
 * name auto-derivation from both boxes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RepoRecord, ValidateOutcome } from '../../src/repos-pool-shared/protocol.js'
import type { ReposPoolT } from '../../src/client/repos-pool/dictionary.js'
import { RepoForm } from '../../src/client/repos-pool/repo-form.js'

const DICT = {
  'form.titleCreate': '添加仓库',
  'form.titleEdit': '编辑仓库',
  'form.name': '名称',
  'form.urlSsh': 'SSH 地址',
  'form.urlHttp': 'HTTP 地址',
  'form.slotSsh': 'SSH 地址',
  'form.slotHttp': 'HTTP 地址',
  'form.description': '简介',
  'form.cancel': '取消',
  'form.submit': '保存',
  'form.submitting': '保存中…',
  'form.closeLabel': '关闭',
  'form.validating': '正在校验仓库地址…',
  'form.validateOk': '仓库可达',
  'form.validateUnverified': '已跳过可达性校验',
  'form.validateSkipped': '地址未变化，沿用上次校验结果',
  'error.nameRequired': '请输入仓库名称',
  'error.urlRequired': '请至少填写一个地址（SSH 或 HTTP）',
  'error.invalidUrl': '仓库地址不合法',
  'error.slotFamily': '地址类型与输入框不符，请填入另一个输入框',
  'error.sameAddress': '两个输入框的地址相同，同一地址只需填写一次',
  'error.duplicateUrl': '该仓库地址已存在于清单中',
  'error.unknownReachability': '无法确认仓库可达性（原因不明），已拒绝保存',
  'error.urlSchemeForbidden': '协议不在允许范围',
  'error.urlLocalPath': '不能使用本地路径',
  'error.urlTooLong': '地址过长',
  'error.network': '网络错误，请稍后重试',
  'error.conflict': '清单已在别处被修改，已自动刷新，请重试',
  'risk.titleAuth': '暂无该仓库的访问权限',
  'risk.titleNetwork': '仓库当前不可达',
  'risk.titleUnknown': '无法确认仓库可达性',
  'risk.descriptionAuth': '可达性校验报告需要认证/权限。',
  'risk.descriptionNetwork': '可达性校验报告网络不可达。',
  'risk.descriptionUnknown': '可达性校验返回了无法归类的原因。',
  'risk.acknowledge': '我了解该仓库当前无法访问',
  'risk.confirm': '仍要保存',
  'risk.cancel': '返回修改',
  'risk.closeLabel': '关闭',
} as const

const t: ReposPoolT = (key) => (DICT as Record<string, string>)[key] ?? key

// vitest runs without globals, so RTL's auto-cleanup stays off — modals
// portal into document.body and would otherwise accumulate across tests.
afterEach(cleanup)

const SSH_URL = 'ssh://git@code.jms.com:2222/ylspm/demo.git'
const HTTP_URL = 'https://example.com/new.git'
const SCP_URL = 'git@github.com:org/twin.git'

const REPO: RepoRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'existing',
  urlHttp: 'https://example.com/existing.git',
  description: 'old',
  statusHttp: 'verified',
  validatedAtHttp: null,
  lastErrorHttp: null,
}

const REPO_DUAL: RepoRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'dual',
  description: '',
  urlSsh: 'git@github.com:org/dual.git',
  statusSsh: 'verified',
  validatedAtSsh: '2026-09-24T09:30:00.000Z',
  lastErrorSsh: null,
  urlHttp: 'https://github.com/org/dual.git',
  statusHttp: 'unverified',
  validatedAtHttp: null,
  lastErrorHttp: null,
}

type Resolution =
  | { kind: 'ok'; outcome: ValidateOutcome }
  | { kind: 'network' }

const ok = (
  kind: 'ssh' | 'scp' | 'https',
  classification: 'reachable' | 'unverified' | 'auth' | 'network' | 'unknown' = 'reachable',
  extra?: { detail?: string; reason?: 'git-missing' | 'no-service' },
): ValidateOutcome => ({
  syntax: { acceptable: true, kind },
  ...(classification === 'reachable' ? { reachability: { classification } } : { reachability: { classification, ...extra } }),
})

interface SetupOptions {
  /** Constant outcome, or a per-url resolver (failures / deferrals). */
  validate?: ValidateOutcome | ((url: string) => Resolution | Promise<Resolution>)
  editing?: { kind: 'create' } | { kind: 'edit'; repo: RepoRecord }
  saveOutcome?: unknown
  repos?: readonly RepoRecord[]
}

function setup(options?: SetupOptions) {
  const save = vi.fn(async () => (options?.saveOutcome ?? { kind: 'ok' as const }))
  const closeForm = vi.fn()
  const validate = vi.fn(async (url: string) => {
    const v = options?.validate
    if (typeof v === 'function') return v(url)
    return { kind: 'ok' as const, outcome: v ?? ok('https') }
  })
  const controller = { save, closeForm } as never
  const fetcher = { validate } as never
  const utils = render(
    <RepoForm
      t={t}
      editing={options?.editing ?? { kind: 'create' }}
      revision={3}
      repos={options?.repos ?? [REPO]}
      fetcher={fetcher}
      controller={controller}
    />,
  )
  return { ...utils, save, closeForm, validate }
}

type Utils = ReturnType<typeof setup>
type SaveBody = {
  expectedRevision: number
  repo: { id?: string; name: string; description: string; urlSsh?: string; urlHttp?: string }
  validation: Record<string, { kind: string; from?: string }>
}

const lastSaveBody = (utils: Utils): SaveBody =>
  (utils.save.mock.calls.at(-1) as unknown[])[0] as SaveBody

// Placeholder-based targeting: the fake t() falls back to raw keys, which are
// unique per field (the host Input atom + label pairing confuses
// getByLabelText with multiple matches).
const nameBox = (): HTMLInputElement => screen.getByPlaceholderText('form.namePlaceholder') as HTMLInputElement
const sshBox = (): HTMLInputElement => screen.getByPlaceholderText('form.urlSshPlaceholder') as HTMLInputElement
const httpBox = (): HTMLInputElement => screen.getByPlaceholderText('form.urlHttpPlaceholder') as HTMLInputElement
const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: '保存' }) as HTMLButtonElement

function fillName(value = 'demo'): void {
  fireEvent.change(nameBox(), { target: { value } })
}
function fillSsh(value: string): void {
  fireEvent.change(sshBox(), { target: { value } })
}
function fillHttp(value: string): void {
  fireEvent.change(httpBox(), { target: { value } })
}

describe('RepoForm 双框基础流（每框即其槽）', () => {
  it('saves an HTTP-box address into the http slot (verified, no gate)', async () => {
    const utils = setup()
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    const body = lastSaveBody(utils)
    expect(body.expectedRevision).toBe(3)
    expect(body.repo).toMatchObject({ name: 'demo', urlHttp: HTTP_URL })
    expect('urlSsh' in body.repo).toBe(false)
    expect(body.validation).toEqual({ http: { kind: 'verified' } })
  })

  it('saves an SSH-box address into the ssh slot', async () => {
    const utils = setup({ validate: ok('ssh') })
    fillName()
    fillSsh(SSH_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    const body = lastSaveBody(utils)
    expect(body.repo.urlSsh).toBe(SSH_URL)
    expect('urlHttp' in body.repo).toBe(false)
    expect(body.validation).toEqual({ ssh: { kind: 'verified' } })
  })

  it('probes both boxes in parallel and saves one body with both slots', async () => {
    const utils = setup({
      validate: (url) => ({ kind: 'ok', outcome: url === SSH_URL ? ok('ssh') : ok('https') }),
    })
    fillName()
    fillSsh(SSH_URL)
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).toHaveBeenCalledTimes(2)
    const probed = utils.validate.mock.calls.map((call) => (call as unknown[])[0]).sort()
    expect(probed).toEqual([HTTP_URL, SSH_URL].sort())
    const body = lastSaveBody(utils)
    expect(body.repo).toMatchObject({ urlSsh: SSH_URL, urlHttp: HTTP_URL })
    expect(body.validation).toEqual({ ssh: { kind: 'verified' }, http: { kind: 'verified' } })
  })

  it('saves unverified outcomes without a confirmation gate', async () => {
    const utils = setup({ validate: ok('https', 'unverified', { reason: 'git-missing' }) })
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({ http: { kind: 'unverified' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('gates auth failures behind RiskConfirmation, titled with the slot label', async () => {
    const utils = setup({ validate: ok('https', 'auth', { detail: 'could not read Username' }) })
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('暂无该仓库的访问权限（HTTP 地址）')).toBeTruthy())
    expect(utils.save).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '仍要保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({ http: { kind: 'forced', from: 'auth' } })
  })

  it('gates network failures on the ssh slot too', async () => {
    const utils = setup({ validate: ok('ssh', 'network', { detail: 'connect timed out' }) })
    fillName()
    fillSsh(SSH_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('仓库当前不可达（SSH 地址）')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '仍要保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({ ssh: { kind: 'forced', from: 'network' } })
  })

  it('gates unknown outcomes (persisted as forced/unknown)', async () => {
    const utils = setup({ validate: ok('ssh', 'unknown', { detail: 'Host key verification failed.' }) })
    fillName()
    fillSsh(SSH_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('无法确认仓库可达性（SSH 地址）')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '仍要保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({ ssh: { kind: 'forced', from: 'unknown' } })
  })

  it('gate cancel resets the slot: the next submit re-probes', async () => {
    const utils = setup({ validate: ok('https', 'auth') })
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('暂无该仓库的访问权限（HTTP 地址）')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }))
    await waitFor(() => expect(screen.queryByText('暂无该仓库的访问权限（HTTP 地址）')).toBeNull())
    expect(utils.save).not.toHaveBeenCalled()
    // Re-submit: the verdict was dropped by cancel, so the probe runs again.
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.validate).toHaveBeenCalledTimes(2))
    expect(utils.save).not.toHaveBeenCalled()
  })
})

describe('提交时本地拦截（不触网）', () => {
  it('rejects an empty name first', () => {
    const utils = setup()
    fireEvent.click(saveButton())
    expect(screen.getByText('请输入仓库名称')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
  })

  it('rejects when both boxes are empty (at-least-one rule)', () => {
    const utils = setup()
    fillName()
    fireEvent.click(saveButton())
    expect(screen.getByText('请至少填写一个地址（SSH 或 HTTP）')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
  })

  it('shows the rejection reason for an illegitimate URL and disables submit until edited', async () => {
    const utils = setup()
    fillName()
    fillHttp('ftp://example.com/x.git')
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('协议不在允许范围')).toBeTruthy())
    expect(utils.validate).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(true)
    // Editing the box clears the block; the next submit probes and saves.
    fillHttp(HTTP_URL)
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({ http: { kind: 'verified' } })
  })

  it('blocks a family mismatch: an https value in the SSH box is never validated', () => {
    const utils = setup()
    fillName()
    fillSsh(HTTP_URL) // https family in the ssh box
    fireEvent.click(saveButton())
    expect(screen.getByText('地址类型与输入框不符，请填入另一个输入框')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
    expect(utils.save).not.toHaveBeenCalled()
  })

  it('blocks the same address in both boxes', () => {
    const utils = setup()
    fillName()
    fillSsh(SCP_URL)
    fillHttp(SCP_URL)
    fireEvent.click(saveButton())
    expect(screen.getByText('两个输入框的地址相同，同一地址只需填写一次')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate URL locally, before any network roundtrip', () => {
    const utils = setup()
    fillName()
    fillHttp('https://example.com/existing.git') // already in props.repos
    fireEvent.click(saveButton())
    expect(screen.getByText('该仓库地址已存在于清单中')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
    expect(utils.save).not.toHaveBeenCalled()
  })
})

describe('per-slot settle、值守卫与结论按值缓存', () => {
  it('settles slots independently: a failed probe keeps the sibling verdict, retry re-probes only the failed slot', async () => {
    let failHttp = true
    const utils = setup({
      validate: (url) => (url === HTTP_URL && failHttp ? { kind: 'network' } : { kind: 'ok', outcome: url === SSH_URL ? ok('ssh') : ok('https') }),
    })
    fillName()
    fillSsh(SSH_URL)
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('仓库可达')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('网络错误，请稍后重试')).toBeTruthy())
    expect(utils.save).not.toHaveBeenCalled()
    expect(utils.validate).toHaveBeenCalledTimes(2)

    // Retry: retype the http box (a real edit — clears its error) — the ssh
    // verdict is still fresh for its value, so ONLY the http slot is probed
    // again. (A same-value programmatic change would be deduped by React's
    // value tracker, so the retry uses a different URL like a real user.)
    failHttp = false
    const retryUrl = 'https://example.com/retry.git'
    fillHttp(retryUrl)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).toHaveBeenCalledTimes(3)
    const urls = utils.validate.mock.calls.map((call) => (call as unknown[])[0])
    expect(urls.filter((url) => url === SSH_URL)).toHaveLength(1)
    expect(lastSaveBody(utils).repo.urlHttp).toBe(retryUrl)
    expect(lastSaveBody(utils).validation).toEqual({ ssh: { kind: 'verified' }, http: { kind: 'verified' } })
  })

  it('drops a stale probe response: editing a box mid-flight never saves the old verdict', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const utils = setup({
      validate: async (url) => {
        await gate
        return { kind: 'ok', outcome: url === SSH_URL ? ok('ssh') : ok('https') }
      },
    })
    fillName()
    fillSsh(SSH_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('正在校验仓库地址…')).toBeTruthy())
    // Edit the box while the probe is in flight, then let it land.
    fillSsh(HTTP_URL.replace('https://', 'ssh://git@host/').replace('.git', '-v2.git'))
    release()
    await waitFor(() => expect(utils.validate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('正在校验仓库地址…')).toBeNull())
    expect(utils.save).not.toHaveBeenCalled()
  })

  it('caches verdicts by value: a failed save retries without re-probing', async () => {
    const utils = setup({ saveOutcome: { kind: 'failed', code: 'network' } })
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('网络错误，请稍后重试')).toBeTruthy())
    // The verdict describes reachability, not pool state — the retry reuses it.
    utils.save.mockImplementation(async () => ({ kind: 'ok' as const }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(2))
    expect(utils.validate).toHaveBeenCalledTimes(1)
  })
})

describe('canSave 单一派生（footer 与所有 gate confirm 共用）', () => {
  it('a blocked sibling disables the gate confirm of the healthy slot', async () => {
    const utils = setup({
      validate: (url) => (url === SSH_URL ? { kind: 'network' } : { kind: 'ok', outcome: ok('https', 'auth') }),
    })
    fillName()
    fillSsh(SSH_URL)
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('暂无该仓库的访问权限（HTTP 地址）')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('网络错误，请稍后重试')).toBeTruthy())
    // The http gate exists but NEITHER confirm path may save: the ssh box
    // holds an error (canSave === false).
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('button', { name: '仍要保存' })).toBeTruthy())
    expect((screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(saveButton().disabled).toBe(true)
    expect(utils.save).not.toHaveBeenCalled()
  })

  it('dual gates: both must be acknowledged before ANY confirm saves, once, with both forced verdicts', async () => {
    const utils = setup({
      validate: (url) => ({ kind: 'ok', outcome: url === SSH_URL ? ok('ssh', 'auth') : ok('https', 'network') }),
    })
    fillName()
    fillSsh(SSH_URL)
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('暂无该仓库的访问权限（SSH 地址）')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('仓库当前不可达（HTTP 地址）')).toBeTruthy())
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    // Ack one gate only: the unacked gate's confirm stays disabled, and the
    // acked gate's confirm is a canSave-guarded NO-OP (the primitive couples
    // checkbox+confirm disabling, so the lone gate cannot be force-disabled
    // without deadlocking ack — the footer button carries the visible block).
    fireEvent.click(checkboxes[0])
    await waitFor(() => expect(screen.getAllByRole('button', { name: '仍要保存' })).toHaveLength(2))
    const confirms = screen.getAllByRole('button', { name: '仍要保存' }) as HTMLButtonElement[]
    expect(confirms[1].disabled).toBe(true) // http gate still unacked
    expect(saveButton().disabled).toBe(true) // footer blocked by canSave
    fireEvent.click(confirms[0])
    expect(utils.save).not.toHaveBeenCalled()
    // Ack the second — the confirm path opens; one click saves BOTH slots.
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect((screen.getAllByRole('button', { name: '仍要保存' })[0] as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getAllByRole('button', { name: '仍要保存' })[0])
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(lastSaveBody(utils).validation).toEqual({
      ssh: { kind: 'forced', from: 'auth' },
      http: { kind: 'forced', from: 'network' },
    })
  })
})

describe('编辑态：unchanged 槽与槽移除', () => {
  it('rename-only edit of a single-address record sends it unchanged (no probe)', async () => {
    const utils = setup({ editing: { kind: 'edit', repo: REPO } })
    fillName('renamed')
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).not.toHaveBeenCalled()
    const body = lastSaveBody(utils)
    expect(body.repo.id).toBe(REPO.id)
    expect(body.repo.urlHttp).toBe(REPO.urlHttp)
    expect(body.validation).toEqual({ http: { kind: 'unchanged' } })
  })

  it('rename-only edit of a dual-address record sends BOTH slots unchanged', async () => {
    const utils = setup({ editing: { kind: 'edit', repo: REPO_DUAL } })
    fillName('renamed')
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).not.toHaveBeenCalled()
    const body = lastSaveBody(utils)
    expect(body.repo.urlSsh).toBe(REPO_DUAL.urlSsh)
    expect(body.repo.urlHttp).toBe(REPO_DUAL.urlHttp)
    expect(body.validation).toEqual({ ssh: { kind: 'unchanged' }, http: { kind: 'unchanged' } })
  })

  it('clearing a box removes that slot: the body omits the field entirely', async () => {
    const utils = setup({ editing: { kind: 'edit', repo: REPO_DUAL } })
    fillSsh('')
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).not.toHaveBeenCalled()
    const body = lastSaveBody(utils)
    expect('urlSsh' in body.repo).toBe(false)
    expect(body.repo.urlHttp).toBe(REPO_DUAL.urlHttp)
    expect(body.validation).toEqual({ http: { kind: 'unchanged' } })
  })

  it('editing only the http slot probes only it; the ssh slot rides along unchanged', async () => {
    const changed = 'https://example.com/changed.git'
    const utils = setup({ editing: { kind: 'edit', repo: REPO_DUAL }, validate: ok('https') })
    fillHttp(changed)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).toHaveBeenCalledTimes(1)
    expect((utils.validate.mock.calls[0] as unknown[])[0]).toBe(changed)
    const body = lastSaveBody(utils)
    expect(body.repo).toMatchObject({ urlSsh: REPO_DUAL.urlSsh, urlHttp: changed })
    expect(body.validation).toEqual({ ssh: { kind: 'unchanged' }, http: { kind: 'verified' } })
  })
})

describe('nameAuto：双源推导', () => {
  it('derives from the SSH box first, falls back to HTTP, and stops once edited manually', () => {
    const utils = setup()
    // SSH non-empty → name comes from the SSH box.
    fillSsh('ssh://git@code.jms.com:2222/ylspm/yl-web-pcp-analysis.git')
    expect(nameBox().value).toBe('yl-web-pcp-analysis')
    // SSH cleared → the HTTP box becomes the source.
    fillSsh('')
    fillHttp('https://github.com/u/another-repo.git')
    expect(nameBox().value).toBe('another-repo')
    // SSH non-empty again → editing the HTTP box must NOT touch the name.
    fillSsh(SSH_URL)
    expect(nameBox().value).toBe('demo')
    fillHttp('https://github.com/u/third-repo.git')
    expect(nameBox().value).toBe('demo')
    // Manual edit wins and is never clobbered again.
    fillName('my-own-name')
    fillHttp('https://github.com/u/fourth-repo.git')
    fillSsh('ssh://git@host/p/fifth-repo.git')
    expect(nameBox().value).toBe('my-own-name')
    expect(utils.validate).not.toHaveBeenCalled()
  })
})

describe('服务端失败的呈现与归因', () => {
  it('routes a 422 invalid-url with field onto the offending box', async () => {
    const utils = setup({
      validate: ok('ssh'),
      saveOutcome: { kind: 'failed', code: 'invalid-url', reason: 'too-long', field: 'ssh' },
    })
    fillName()
    fillSsh(SSH_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('地址过长')).toBeTruthy())
    expect(screen.getByText('添加仓库')).toBeTruthy() // form stays open
  })

  it('attributes a server duplicate-url to the form error when the pool scan finds no hit', async () => {
    const utils = setup({ saveOutcome: { kind: 'failed', code: 'duplicate-url' } })
    fillName()
    fillHttp('https://example.com/somehow-new.git')
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('该仓库地址已存在于清单中')).toBeTruthy())
    expect(screen.getByText('添加仓库')).toBeTruthy()
  })

  it('keeps the form open on a conflict, and the retry after self-heal reuses the verdict', async () => {
    const utils = setup({ saveOutcome: { kind: 'failed', code: 'conflict' } })
    fillName()
    fillHttp(HTTP_URL)
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByText('清单已在别处被修改，已自动刷新，请重试')).toBeTruthy())
    utils.save.mockImplementation(async () => ({ kind: 'ok' as const }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(2))
    expect(utils.validate).toHaveBeenCalledTimes(1)
  })
})
