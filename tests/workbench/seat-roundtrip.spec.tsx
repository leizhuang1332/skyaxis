// @vitest-environment jsdom
/**
 * Live-acceptance repro (issues #2/#3): real store + real controller wiring
 * through the seat wrapper, stage round-trips S1→S2→S1→S3→S1 — the findings
 * module must appear EXACTLY once per S1 view and never on other stages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { createWorkbenchController } from '../../src/client/workbench/controller.js'
import { createWorkbenchFetcher } from '../../src/client/workbench/fetcher.js'
import { createWorkbenchStore } from '../../src/client/workbench/store.js'
import { createWorkbenchTabSeat } from '../../src/client/workbench/view.js'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const record: WorkbenchRecord = {
  requirementId: RID,
  stage: 'understand',
  stageHistory: [{ stage: 'understand', at: AT }],
  criteria: [{ id: 'C1', text: '标准一', coveredBy: [] }],
  findings: [{ id: '22222222-2222-4222-8222-222222222222', category: 'risk', severity: 'medium', title: '发现一', detail: '', status: 'open', createdAt: AT }],
  workPackages: [],
  releaseItems: [],
  reviewReports: [],
  knowledgeCandidates: [],
}

const requirement: RequirementRecord = {
  id: RID, title: 'R', description: '', workspacePath: '', linkedRepos: [], createdAt: AT, updatedAt: AT,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('seat round-trip: no stage-view duplication', () => {
  it('S1→S2→S1→S3→S1 keeps exactly one findings module, and none on S2/S3', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record,
      planFileExists: [],
      reviewFileExists: [],
    }))))
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, createWorkbenchFetcher())
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller })
    render(<Seat requirement={requirement} />)

    await waitFor(() => expect(screen.getByText('发现一')).toBeTruthy())
    expect(screen.getAllByText(workbenchZh['finding.add'])).toHaveLength(1)

    // S1 → S2: findings must VANISH (both the row and the add card).
    fireEvent.click(screen.getByRole('tab', { name: /探索规划/ }))
    await waitFor(() => expect(screen.queryByText('发现一')).toBeNull())
    expect(screen.queryByText(workbenchZh['finding.add'])).toBeNull()

    // S2 → S1: exactly ONE findings module again.
    fireEvent.click(screen.getByRole('tab', { name: /需求理解/ }))
    await waitFor(() => expect(screen.getByText('发现一')).toBeTruthy())
    expect(screen.getAllByText(workbenchZh['finding.add'])).toHaveLength(1)

    // S1 → S3 → S1: still exactly one.
    fireEvent.click(screen.getByRole('tab', { name: /执行实施/ }))
    await waitFor(() => expect(screen.queryByText('发现一')).toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: /需求理解/ }))
    await waitFor(() => expect(screen.getByText('发现一')).toBeTruthy())
    expect(screen.getAllByText(workbenchZh['finding.add'])).toHaveLength(1)
    // Exactly one tabpanel in the tree at all times.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('remount round-trip (tab away and back = seat unmount/mount) keeps one findings module', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record,
      planFileExists: [],
      reviewFileExists: [],
    }))))
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, createWorkbenchFetcher())
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller })
    const { unmount } = render(<Seat requirement={requirement} />)
    await waitFor(() => expect(screen.getByText('发现一')).toBeTruthy())
    unmount()
    cleanup()

    const second = render(<Seat requirement={requirement} />)
    await waitFor(() => expect(second.getAllByText(workbenchZh['finding.add'])).toHaveLength(1))
    expect(second.getAllByRole('tabpanel')).toHaveLength(1)
    second.unmount()
  })
})
