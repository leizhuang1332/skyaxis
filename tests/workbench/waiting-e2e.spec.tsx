// @vitest-environment jsdom
/**
 * P2b end-to-end chain (acceptance-failure diagnostic): real cordis Context +
 * a uiSession provider + the real tracker + the real seat body. The pure
 * chip-state tests only ever pass STATIC booleans — this is the test that
 * proves a live publish re-renders a visible surface to the waiting state.
 * 0017 修订重锚：会话条退役后，可见承载面改为 S3 看板卡的 waiting 角标
 * （execution.waitingForYou Tag）与直播行（execution.liveRunning）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { createWaitingTracker } from '../../src/client/waiting-tracker.js'
import { createWorkbenchController } from '../../src/client/workbench/controller.js'
import { createWorkbenchStore } from '../../src/client/workbench/store.js'
import { WorkbenchTabBody, createWorkbenchTabSeat } from '../../src/client/workbench/view.js'
import type { RequirementWorkbenchState } from '../../src/client/workbench/store.js'

const RID = '11111111-1111-4111-8111-111111111111'
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const AT = '2026-09-30T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement: RequirementRecord = {
  id: RID, title: 'R', description: '', workspacePath: '', linkedRepos: [], createdAt: AT, updatedAt: AT,
}

const record: WorkbenchRecord = {
  requirementId: RID,
  stage: 'implement',
  stageHistory: [{ stage: 'implement', at: AT }],
  // 0017 修订重锚注记：看板（新断言承载面）在硬门①后渲染——strip 是跨阶段面
  // 从不需要它；重锚后 fixture 必须带 splitApprovedAt。
  splitApprovedAt: AT,
  criteria: [],
  findings: [],
  workPackages: [{
    id: 'WP1', title: '包一', boundary: '', order: 1, dependsOn: [], covers: [], status: 'in-dev',
    plans: [], sessions: [{ sessionId: SID, purpose: 'dev', boundAt: AT }], commits: [], acceptances: [],
  }],
  releaseItems: [], reviewReports: [], knowledgeCandidates: [],
}

const slot: RequirementWorkbenchState = {
  phase: 'ready', revision: 1, record, planFileExists: [], reviewFileExists: [], releaseDrifted: [], busy: false,
}

/** The uiSession.pendingInteractions face, shape-identical to the real one. */
function fakeFace() {
  const face = {
    map: new Map<string, unknown>(),
    listeners: new Set<() => void>(),
    getSnapshot(): ReadonlyMap<string, unknown> { return this.map },
    subscribe(listener: () => void): () => void {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }
  return face
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 30) })


afterEach(() => { cleanup() })

describe('P2b 端到端：uiSession 发布 → 看板 waiting 角标（0017 修订重锚）', () => {
  it('a live publish flips the WP card to 待输入 tag (and back on removal)', async () => {
    const face = fakeFace()
    const ctx = new Context()
    await ctx.plugin((c: Context) => { c.provide('uiSession', { pendingInteractions: face } as never) }).await()
    const tracker = createWaitingTracker(ctx)
    // cordis inject callbacks land asynchronously — the production path is the same.
    await tick()
    expect(face.listeners.size).toBe(1)

    const controller = createWorkbenchController(createWorkbenchStore(), {
      list: async () => ({ kind: 'network' }), detail: async () => ({ kind: 'network' }),
    } as never)

    render(
      <WorkbenchTabBody
        t={bindZh()}
        requirement={requirement}
        slot={slot}
        controller={controller}
        knowledge={{ phase: 'ready', revision: 0, records: [] }}
        sessions={{
          ids: [SID],
          summariesById: { [SID]: { id: SID, displayTitle: '会话一', running: true, blank: false } },
          subscribe: () => () => {},
          navigate: () => {},
        }}
        waiting={tracker}
      />,
    )

    // ③ 看板在场 + 基线：直播行（running），无 waiting 角标。
    fireEvent.click(screen.getByRole('tab', { name: /执行实施/ }))
    await waitFor(() => expect(screen.getByText(`● ${workbenchZh['execution.liveRunning']}`)).toBeTruthy())
    expect(screen.queryByText(workbenchZh['execution.waitingForYou'])).toBeNull()

    // The GUI answerer publishes the pending interaction for this session.
    act(() => {
      face.map.set(SID, { kind: 'question' })
      for (const listener of [...face.listeners]) listener()
    })
    await waitFor(() => expect(screen.getByText(workbenchZh['execution.waitingForYou'])).toBeTruthy())

    // Answered → removed → back to live-only (running is still true on the summary).
    act(() => {
      face.map.delete(SID)
      for (const listener of [...face.listeners]) listener()
    })
    await waitFor(() => expect(screen.queryByText(workbenchZh['execution.waitingForYou'])).toBeNull())
    expect(screen.getByText(`● ${workbenchZh['execution.liveRunning']}`)).toBeTruthy()

    tracker.dispose()
  })
})

describe('P2b seat 穿线回归（验收缺陷 168e80b 的钉子）', () => {
  it('waiting face reaches the board card THROUGH the seat wrapper (not only via direct Body render)', async () => {
    // The acceptance failure was a dropped prop at the seat boundary:
    // WorkbenchSeat declared waiting but never forwarded it to
    // WorkbenchTabBody. Rendering Body directly (the test above) could not
    // catch it — this test goes through createWorkbenchTabSeat.
    const face = fakeFace()
    const ctx = new Context()
    await ctx.plugin((c: Context) => { c.provide('uiSession', { pendingInteractions: face } as never) }).await()
    const tracker = createWaitingTracker(ctx)
    await tick()

    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, {
      list: async () => ({ kind: 'ok', revision: 1, records: [record] }),
      detail: async () => ({ kind: 'ok', revision: 1, record, planFileExists: [], reviewFileExists: [], releaseDrifted: [] }),
      openKnowledge: async () => undefined,
      knowledgeList: async () => ({ kind: 'ok', revision: 0, records: [] }),
    } as never)
    const Seat = createWorkbenchTabSeat({
      t: bindZh(),
      store,
      controller,
      sessions: {
        ids: [SID],
        summariesById: { [SID]: { id: SID, displayTitle: '会话一', running: true, blank: false } },
        subscribe: () => () => {},
        navigate: () => {},
      },
      waiting: tracker,
    })
    render(<Seat requirement={requirement} />)
    // 记录到位锚（0017 修订：会话条退役——ready 后点 ③ 看板，直播行为在场见证）。
    await waitFor(() => expect(screen.getByRole('tab', { name: /执行实施/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /执行实施/ }))
    await waitFor(() => expect(screen.getByText(`● ${workbenchZh['execution.liveRunning']}`)).toBeTruthy())

    act(() => {
      face.map.set(SID, { kind: 'question' })
      for (const listener of [...face.listeners]) listener()
    })
    // Through the seat: the card must flip to 待输入角标. Before the fix this
    // stayed live-only forever.
    await waitFor(() => expect(screen.getByText(workbenchZh['execution.waitingForYou'])).toBeTruthy())

    tracker.dispose()
  })
})
