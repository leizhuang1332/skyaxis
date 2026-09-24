// @vitest-environment jsdom
/**
 * RepoForm validation flow against a mocked fetcher/controller — the
 * decision-matrix behaviors: verified saves directly, unverified saves
 * without a gate, auth/network gate behind RiskConfirmation, unknown and
 * illegitimate outcomes have no save path, and unchanged-URL edits skip
 * reachability entirely.
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
  'form.url': '仓库地址',
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
  'error.urlRequired': '请输入仓库地址',
  'error.invalidUrl': '仓库地址不合法',
  'error.urlSchemeForbidden': '协议不在允许范围',
  'error.urlLocalPath': '不能使用本地路径',
  'error.network': '网络错误，请稍后重试',
  'risk.titleAuth': '暂无该仓库的访问权限',
  'risk.titleNetwork': '仓库当前不可达',
  'risk.descriptionAuth': '可达性校验报告需要认证/权限。',
  'risk.descriptionNetwork': '可达性校验报告网络不可达。',
  'risk.acknowledge': '我了解该仓库当前无法访问',
  'risk.confirm': '仍要保存',
  'risk.cancel': '返回修改',
  'risk.closeLabel': '关闭',
} as const

const t: ReposPoolT = (key) => (DICT as Record<string, string>)[key] ?? key

// vitest runs without globals, so RTL's auto-cleanup stays off — modals
// portal into document.body and would otherwise accumulate across tests.
afterEach(cleanup)

const REPO: RepoRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'existing',
  url: 'https://example.com/existing.git',
  description: 'old',
  status: 'verified',
  validatedAt: null,
  lastError: null,
}

function setup(options?: { validate?: ValidateOutcome; editing?: { kind: 'create' } | { kind: 'edit'; repo: RepoRecord } }) {
  const save = vi.fn(async () => true)
  const closeForm = vi.fn()
  const validate = vi.fn(async () => ({
    kind: 'ok' as const,
    outcome: options?.validate ?? { syntax: { acceptable: true as const, kind: 'https' as const }, reachability: { classification: 'reachable' as const } },
  }))
  const controller = { save, closeForm } as never
  const fetcher = { validate } as never
  const utils = render(
    <RepoForm
      t={t}
      editing={options?.editing ?? { kind: 'create' }}
      revision={3}
      fetcher={fetcher}
      controller={controller}
    />,
  )
  return { ...utils, save, closeForm, validate }
}

function fillAndSubmit(utils: ReturnType<typeof setup>, url = 'https://example.com/new.git'): void {
  // Placeholder-based targeting: the fake t() falls back to raw keys, which
  // are unique per field (the host Input atom + label pairing confuses
  // getByLabelText with multiple matches).
  fireEvent.change(screen.getByPlaceholderText('form.namePlaceholder'), { target: { value: 'demo' } })
  fireEvent.change(screen.getByPlaceholderText('form.urlPlaceholder'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

describe('RepoForm validation flow', () => {
  it('saves directly when the repository is reachable (verified)', async () => {
    const utils = setup()
    fillAndSubmit(utils)
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    const [body] = utils.save.mock.calls[0] as unknown as [{ expectedRevision: number; repo: { name: string; url: string }; validation: { kind: string } }]
    expect(body.expectedRevision).toBe(3)
    expect(body.repo).toMatchObject({ name: 'demo', url: 'https://example.com/new.git' })
    expect(body.validation).toEqual({ kind: 'verified' })
  })

  it('saves unverified outcomes without a confirmation gate (decision D3)', async () => {
    const utils = setup({ validate: { syntax: { acceptable: true, kind: 'https' }, reachability: { classification: 'unverified', reason: 'git-missing' } } })
    fillAndSubmit(utils)
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect((utils.save.mock.calls[0] as unknown[])[0]).toMatchObject({ validation: { kind: 'unverified' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('gates auth failures behind RiskConfirmation: confirm stays disabled until acknowledged', async () => {
    const utils = setup({ validate: { syntax: { acceptable: true, kind: 'https' }, reachability: { classification: 'auth', detail: 'could not read Username' } } })
    fillAndSubmit(utils)
    await waitFor(() => expect(screen.getByText('暂无该仓库的访问权限')).toBeTruthy())
    expect(utils.save).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: '仍要保存' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect((screen.getByRole('button', { name: '仍要保存' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '仍要保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect((utils.save.mock.calls[0] as unknown[])[0]).toMatchObject({ validation: { kind: 'forced', from: 'auth' } })
  })

  it('hard-rejects unknown outcomes: no save path, submit disabled (decision D4)', async () => {
    const utils = setup({ validate: { syntax: { acceptable: true, kind: 'https' }, reachability: { classification: 'unknown', detail: 'fatal: exotic' } } })
    fillAndSubmit(utils)
    await waitFor(() => expect(screen.getByText(/fatal: exotic/)).toBeTruthy())
    expect(utils.save).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the rejection reason for illegitimate URLs and never saves', async () => {
    const utils = setup({ validate: { syntax: { acceptable: false, reason: 'scheme-forbidden' } } })
    fillAndSubmit(utils)
    await waitFor(() => expect(screen.getByText('协议不在允许范围')).toBeTruthy())
    expect(utils.save).not.toHaveBeenCalled()
  })

  it('skips reachability entirely on an unchanged-URL edit (validation: unchanged)', async () => {
    const utils = setup({ editing: { kind: 'edit', repo: REPO } })
    fireEvent.change(screen.getByPlaceholderText('form.namePlaceholder'), { target: { value: 'renamed' } })
    // URL untouched — prefilled with the original.
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect(utils.validate).not.toHaveBeenCalled()
    expect((utils.save.mock.calls[0] as unknown[])[0]).toMatchObject({ validation: { kind: 'unchanged' } })
  })

  it('unblocks the submit button once the URL is edited after a rejection (P2 acceptance regression)', async () => {
    // First attempt: local-path rejection → submit disabled while the stale verdict holds.
    const utils = setup({ validate: { syntax: { acceptable: false, reason: 'no-scheme-local-path' } } })
    fillAndSubmit(utils, './relative/path')
    await waitFor(() => expect(screen.getByText('不能使用本地路径')).toBeTruthy())
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)

    // Edit the URL: the stale verdict resets, the button unblocks, and the
    // next submit runs validation again (now passing).
    fireEvent.change(screen.getByPlaceholderText('form.urlPlaceholder'), { target: { value: 'https://example.com/fixed.git' } })
    await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false))
    ;(utils.validate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'ok',
      outcome: { syntax: { acceptable: true, kind: 'https' }, reachability: { classification: 'reachable' } },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(utils.save).toHaveBeenCalledTimes(1))
    expect((utils.save.mock.calls[0] as unknown[])[0]).toMatchObject({ validation: { kind: 'verified' } })
  })

  it('validates locally before anything else (empty name)', () => {
    const utils = setup()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('请输入仓库名称')).toBeTruthy()
    expect(utils.validate).not.toHaveBeenCalled()
  })
})
