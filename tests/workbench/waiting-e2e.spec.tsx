// @vitest-environment jsdom
/**
 * P2b end-to-end chain (acceptance-failure diagnostic): real cordis Context +
 * a uiSession provider + the real tracker + the real seat body. The strip
 * unit tests only ever passed a STATIC Set — this is the first test that
 * proves a live publish re-renders the chip to the amber waiting state.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  criteria: [],
  findings: [],
  workPackages: [{
    id: 'WP1', title: '包一', boundary: '', order: 1, dependsOn: [], covers: [], status: 'in-dev',
    plans: [], sessions: [{ sessionId: SID, purpose: 'dev', boundAt: AT }], commits: [], acceptances: [],
  }],
  releaseItems: [], reviewReports: [], knowledgeCandidates: [],
}

const slot: RequirementWorkbenchState = {
  phase: 'ready', revision: 1, record, planFileExists: [], reviewFileExists: [], busy: false,
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

describe('P2b 端到端：uiSession 发布 → strip 第四态', () => {
  it('a live publish flips the bound chip to amber 待输入 (and back on removal)', async () => {
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

    // Baseline: running, not waiting.
    expect(screen.queryByText(workbenchZh['session.stateWaiting'])).toBeNull()
    expect(screen.getByText(workbenchZh['session.stateRunning'])).toBeTruthy()

    // The GUI answerer publishes the pending interaction for this session.
    act(() => {
      face.map.set(SID, { kind: 'question' })
      for (const listener of [...face.listeners]) listener()
    })
    await waitFor(() => expect(screen.getByText(workbenchZh['session.stateWaiting'])).toBeTruthy())
    expect(screen.queryByText(workbenchZh['session.stateRunning'])).toBeNull()

    // Answered → removed → back to running (running is still true on the summary).
    act(() => {
      face.map.delete(SID)
      for (const listener of [...face.listeners]) listener()
    })
    await waitFor(() => expect(screen.queryByText(workbenchZh['session.stateWaiting'])).toBeNull())
    expect(screen.getByText(workbenchZh['session.stateRunning'])).toBeTruthy()

    tracker.dispose()
  })
})

describe('P2b seat 穿线回归（验收缺陷 168e80b 的钉子）', () => {
  it('waiting face reaches the strip THROUGH the seat wrapper (not only via direct Body render)', async () => {
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
      detail: async () => ({ kind: 'ok', revision: 1, record, planFileExists: [], reviewFileExists: [] }),
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
    await waitFor(() => expect(screen.getByText(workbenchZh['session.stateRunning'])).toBeTruthy())

    act(() => {
      face.map.set(SID, { kind: 'question' })
      for (const listener of [...face.listeners]) listener()
    })
    // Through the seat: the chip must flip to 待输入. Before the fix this
    // stayed 运行中 forever.
    await waitFor(() => expect(screen.getByText(workbenchZh['session.stateWaiting'])).toBeTruthy())
    expect(screen.queryByText(workbenchZh['session.stateRunning'])).toBeNull()

    tracker.dispose()
  })
})
