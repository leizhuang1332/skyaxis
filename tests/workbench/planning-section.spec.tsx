// @vitest-environment jsdom
/**
 * 0012: S2 planning face — the 技术规划文档 card (WorkspaceDocSection instance)
 * plus the 采纳软门 chrome: [生成规划任务书] entry (plan bar, 布局轮), [采纳规划]
 * ack (doc-presence probe disclosure + checkbox-gated confirm — the understand
 * ack twin), the adopted Tag arm in the plan bar with [撤销采纳], and the
 * upstream stale badge riding the card head (planBaseline.requirementDocHash
 * vs the CURRENT understandBaseline.docHash, bare !==).
 * 布局轮: PlanningSection dissolved into view.tsx — the subject is now
 * WorkbenchTabBody (record.stage 'plan'); assertions stay at the call/dialog
 * layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { WorkbenchTabBody } from '../../src/client/workbench/view.js'

const RID = '11111111-1111-4111-8111-111111111111'
const WS = 'C:\\ws\\需求'
const AT = '2026-10-15T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement = (workspacePath: string): RequirementRecord => ({
  id: RID,
  title: '规划改造',
  description: '',
  workspacePath,
  linkedRepos: [],
  createdAt: AT,
  updatedAt: AT,
})

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'plan',
    stageHistory: [{ stage: 'plan', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function fakeController(impl: () => Promise<unknown>): WorkbenchController & { planningDocContent: ReturnType<typeof vi.fn>; adoptPlan: ReturnType<typeof vi.fn>; revokePlanAdoption: ReturnType<typeof vi.fn> } {
  return {
    open: vi.fn(async () => undefined),
    openKnowledge: vi.fn(async () => undefined),
    advanceStage: vi.fn(async () => true),
    saveFinding: vi.fn(async () => true),
    removeFinding: vi.fn(async () => true),
    saveCriterion: vi.fn(async () => true),
    dismissBanner: vi.fn(),
    analysisReportContent: vi.fn(async () => undefined),
    requirementDocContent: vi.fn(async () => undefined),
    splitResultContent: vi.fn(async () => undefined),
    planningDocContent: vi.fn(impl),
    adoptPlan: vi.fn(async () => true),
    revokePlanAdoption: vi.fn(async () => true),
    dispose: vi.fn(),
  } as never
}

const slot = (rec: WorkbenchRecord) => ({ phase: 'ready', revision: 3, record: rec, planFileExists: [], reviewFileExists: [], releaseDrifted: [], busy: false }) as never

const subject = (rec: WorkbenchRecord, controller: WorkbenchController, workspacePath = WS) =>
  render(
    <WorkbenchTabBody
      t={bindZh()}
      requirement={requirement(workspacePath)}
      slot={slot(rec)}
      controller={controller}
      knowledge={{ phase: 'ready', revision: 1, records: [] }}
    />,
  )

afterEach(() => {
  cleanup()
})

describe('0012 S2 技术规划卡片（采纳软门）', () => {
  it('未采纳 ⇒ 规划卡 + [生成规划任务书]（分层实心）+ [采纳规划]；ack 开门即探测、勾选门控、确认调用 adoptPlan(RID)', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    subject(record(), controller)

    await waitFor(() => expect(controller.planningDocContent).toHaveBeenCalledTimes(1)) // 存在性探测
    const sowButton = screen.getByRole('button', { name: workbenchZh['sow.planButton'] }) as HTMLButtonElement
    // 布局轮分层钉：未采纳 ⇒ 生成规划任务书实心、生成拆分任务书描边。
    expect(sowButton.className).toContain('primaryButton')
    expect((screen.getByRole('button', { name: workbenchZh['sow.splitButton'] }) as HTMLButtonElement).className).toContain('ghostButton')
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.adoptButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.adoptTitle'] })
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['planning.ackDocWillAnchor'])).toBeTruthy()) // 探测结果披露
    // 勾选门控：未勾选时确认禁用。
    const confirm = within(dialog).getByRole('button', { name: workbenchZh['planning.adoptConfirm'] })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(controller.adoptPlan).toHaveBeenCalledWith(RID))
  })

  it('探测 no-doc（undefined）⇒ ack 披露 ackNoDoc（软门：采纳仍成立）', async () => {
    const controller = fakeController(async () => undefined)
    subject(record(), controller)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.adoptButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.adoptTitle'] })
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['planning.ackNoDoc'])).toBeTruthy())
  })

  it('已采纳 ⇒ 顶栏已采纳 Tag + [撤销采纳] 勾选确认调用 revokePlanAdoption；无 stale 徽章（上游锚一致）', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    const adopted = record({
      planAdoptedAt: AT,
      planBaseline: { at: AT, docHash: 'p'.repeat(64), requirementDocHash: 'r'.repeat(64) },
      understandApprovedAt: AT,
      understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'r'.repeat(64) },
    })
    subject(adopted, controller)

    expect(screen.queryByRole('button', { name: workbenchZh['planning.adoptButton'] })).toBeNull()
    expect(screen.getByText(workbenchZh['planning.adoptedTag'])).toBeTruthy()
    expect(screen.queryByText(workbenchZh['planning.staleBadge'])).toBeNull() // 上游一致 ⇒ 安静
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.revokeButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.revokeTitle'] })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['planning.revokeConfirm'] }))
    await waitFor(() => expect(controller.revokePlanAdoption).toHaveBeenCalledWith(RID))
  })

  it('上游基线变更（requirementDocHash 与现行 understandBaseline.docHash 不一致）⇒ stale 徽章骑规划卡头', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    const stale = record({
      planAdoptedAt: AT,
      planBaseline: { at: AT, docHash: 'p'.repeat(64), requirementDocHash: 'r'.repeat(64) },
      understandApprovedAt: AT,
      understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'z'.repeat(64) }, // 重定稿换锚
    })
    subject(stale, controller)
    expect(screen.getByText(workbenchZh['planning.staleBadge'])).toBeTruthy()
  })

  it('无工作区 ⇒ 卡片区诚实提示 + 采纳按钮仍在（ackNoDoc 路径），零探测 fetch', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '#', contentTampered: false }))
    subject(record(), controller, '')
    expect(screen.getByText(workbenchZh['planning.noWorkspace'])).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.planningDocContent).not.toHaveBeenCalled()
  })
})
