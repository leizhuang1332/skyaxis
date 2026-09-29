// @vitest-environment jsdom
/**
 * P2 session strip（跨阶段 session 芯片条）客户端组件测试：三态点与文案
 * （running→ongoing+运行中 / idle→done+空闲 / blank→idle+未开始，全部走真
 * 词典）、消亡绑定 span 化（无 button、无 StateDot、stateGone 文案、id 前
 * 8 位回退）、空绑定整条只剩 stripEmptyHint（无零计数标签）、可导航点击落
 * onNavigate 而不可导航点击 spy 零调用（aria-disabled 标记）、join 前缀
 * {wpId}·{purpose}·{title}、dropped 工作包的绑定仍显示（账本事实）。
 *
 * 组件是纯渲染（summaries/navigableIds 由父层投影）：夹具直接构造投影，
 * 不经 store——订阅面的拼接由父层接线测试覆盖。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchRecord, WorkbenchSessionBinding, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { SessionStrip, type SessionStripSummary } from '../../src/client/workbench/session-strip.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement: RequirementRecord = {
  id: RID,
  title: '报价管理：导入导出与数据校验',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
}

function binding(sessionId: string, purpose: WorkbenchSessionBinding['purpose'] = 'dev'): WorkbenchSessionBinding {
  return { sessionId, purpose, boundAt: AT }
}

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id,
    title: `工作包-${id}`,
    boundary: `边界-${id}`,
    order: 1,
    dependsOn: [],
    covers: [],
    status: 'planned',
    plans: [],
    sessions: [],
    commits: [],
    acceptances: [],
    ...overrides,
  }
}

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'implement',
    stageHistory: [{ stage: 'implement', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function summary(id: string, overrides: Partial<Omit<SessionStripSummary, 'id'>> = {}): SessionStripSummary {
  return { id, displayTitle: `会话-${id}`, running: false, blank: false, ...overrides }
}

function renderStrip(props: {
  record: WorkbenchRecord
  summaries?: readonly SessionStripSummary[]
  navigableIds?: readonly string[]
  onNavigate?: (sessionId: string) => void
}): void {
  render(
    <SessionStrip
      t={bindZh()}
      record={props.record}
      requirement={requirement}
      summaries={props.summaries ?? []}
      navigableIds={props.navigableIds ?? []}
      onNavigate={props.onNavigate ?? (() => undefined)}
    />,
  )
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；不显式清理会让后一个用例
// 看见前一个用例的 DOM（0003 P2 记录过的同类坑）。
afterEach(() => {
  cleanup()
})

describe('SessionStrip（P2 session 芯片条）', () => {
  it('三态点与文案：running→ongoing+运行中 / 空闲→done+空闲 / blank→idle+未开始；计数标签来自芯片数', () => {
    renderStrip({
      record: record({
        workPackages: [wp('WP1', { sessions: [binding('s1'), binding('s2', 'review'), binding('s3', 'analysis')] })],
      }),
      summaries: [summary('s1', { running: true }), summary('s2'), summary('s3', { blank: true })],
    })

    expect(screen.getByText('关联 session（3）')).toBeTruthy()

    const runningChip = screen.getByRole('button', { name: /WP1·开发·会话-s1/ })
    expect(runningChip.querySelector('[data-state="ongoing"]')).toBeTruthy()
    expect(within(runningChip).getByText(workbenchZh['session.stateRunning'])).toBeTruthy()

    const idleChip = screen.getByRole('button', { name: /WP1·评审·会话-s2/ })
    expect(idleChip.querySelector('[data-state="done"]')).toBeTruthy()
    expect(within(idleChip).getByText(workbenchZh['session.stateIdle'])).toBeTruthy()

    const blankChip = screen.getByRole('button', { name: /WP1·分析·会话-s3/ })
    expect(blankChip.querySelector('[data-state="idle"]')).toBeTruthy()
    expect(within(blankChip).getByText(workbenchZh['session.stateBlank'])).toBeTruthy()
  })

  it('消亡绑定：span 化（无 button、无 StateDot）、stateGone 文案、标题回退 sessionId 前 8 位', () => {
    renderStrip({
      record: record({ workPackages: [wp('WP1', { sessions: [binding('deadbeef1234')] })] }),
      summaries: [],
    })

    expect(screen.queryByRole('button')).toBeNull()
    const gone = screen.getByText(/WP1·开发·deadbeef/)
    expect(gone.tagName).toBe('SPAN')
    expect(gone.querySelector('[data-state]')).toBeNull()
    expect(within(gone).getByText(workbenchZh['session.stateGone'])).toBeTruthy()
  })

  it('空绑定：整条只渲染 stripEmptyHint 单行引导，无零计数标签', () => {
    renderStrip({ record: record({ workPackages: [wp('WP1'), wp('WP2')] }), summaries: [summary('s1')] })

    expect(screen.getByText(workbenchZh['session.stripEmptyHint'])).toBeTruthy()
    expect(screen.queryByText(/关联 session（/)).toBeNull()
  })

  it('可导航点击落 onNavigate；不可导航点击无调用（aria-disabled 标记）', () => {
    const onNavigate = vi.fn()
    renderStrip({
      record: record({ workPackages: [wp('WP1', { sessions: [binding('s1'), binding('s2')] })] }),
      summaries: [summary('s1'), summary('s2')],
      navigableIds: ['s1'],
      onNavigate,
    })

    const navigable = screen.getByRole('button', { name: /WP1·开发·会话-s1/ })
    expect(navigable.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(navigable)
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('s1')

    const trapped = screen.getByRole('button', { name: /WP1·开发·会话-s2/ })
    expect(trapped.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(trapped)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('join 前缀 {wpId}·{purpose 文案}·{displayTitle}：多工作包各自拼接', () => {
    renderStrip({
      record: record({
        workPackages: [
          wp('WP1', { sessions: [binding('s1', 'analysis')] }),
          wp('WP2', { sessions: [binding('s2', 'review')] }),
        ],
      }),
      summaries: [summary('s1'), summary('s2')],
    })

    expect(screen.getByText('WP1·分析·会话-s1')).toBeTruthy()
    expect(screen.getByText('WP2·评审·会话-s2')).toBeTruthy()
  })

  it('dropped 工作包的绑定仍显示（账本事实，不随放弃隐藏）', () => {
    renderStrip({
      record: record({
        workPackages: [wp('WP9', { status: 'dropped', sessions: [binding('s1')] })],
      }),
      summaries: [summary('s1')],
    })

    expect(screen.getByRole('button', { name: /WP9·开发·会话-s1/ })).toBeTruthy()
    expect(screen.getByText('关联 session（1）')).toBeTruthy()
  })
})
