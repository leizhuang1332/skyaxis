// @vitest-environment jsdom
/**
 * Live-acceptance repro (issues #2/#3): real store + real controller wiring
 * through the seat wrapper, stage round-trips S1→S2→S1→S3→S1 — the findings
 * module must appear EXACTLY once per S1 view and never on other stages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      reviewFileExists: [], releaseDrifted: [],
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
      reviewFileExists: [], releaseDrifted: [],
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

describe('seat round-trip: S5 deliver（P3a 穿线钉）', () => {
  it('S5 经 seat 包装渲染上线清单真内容（drift 投影随 slot 到达 gonogo 计数）', async () => {
    const withRelease: WorkbenchRecord = {
      ...record,
      releaseItems: [{
        id: 'R0001',
        type: 'sql',
        title: 't_order 加索引',
        content: 'ALTER TABLE t_order ADD INDEX i(c)',
        contentHash: 'a'.repeat(64),
        envs: ['prod'],
        status: 'confirmed',
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      revision: 1,
      record: withRelease,
      planFileExists: [],
      reviewFileExists: [],
      releaseDrifted: ['R0001'],
    }))))
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, createWorkbenchFetcher())
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller })
    render(<Seat requirement={requirement} />)

    // 等 record 真到位（⑤ 徽章来自数据）再点——避开「首次 ready 跟随
    // record.stage」把 viewing 拉回 understand 的覆盖窗口（seat 首测等
    // 「发现一」出现后才点 tab 的同款时序）。
    await waitFor(() => expect(screen.getByText(/上线项/)).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /交付/ }))
    await waitFor(() => expect(screen.getByText(workbenchZh['release.sectionTitle'])).toBeTruthy())
    // 漂移投影穿到 gonogo 计数与行内披露——releaseDrifted 在 detail 响应里，
    // 经 store/controller 透传后必须到达视图（P2b seat 穿线断裂的同款防线）。
    await waitFor(() => expect(screen.getByText(/漂移 1/)).toBeTruthy())
    expect(screen.getByText(`⚠ ${workbenchZh['release.driftNote']}`)).toBeTruthy()
    // RTL 把 U+3000 归一为半角空格（handoff §5.6）——getByText 用半角。
    expect(screen.getByText('R0001 t_order 加索引')).toBeTruthy()
  })
})

describe('seat round-trip: S5 导入声明的 sessions 穿线（P3b 钉）', () => {
  it('sessions face 经 seat → Body → DeliverSection 到达导入 Modal 的会话下拉（P2b 断裂同款防线）', async () => {
    const bound: WorkbenchRecord = {
      ...record,
      workPackages: [{
        id: 'WP1', title: 'WP1', boundary: '', order: 1, dependsOn: [], covers: [],
        status: 'in-dev', plans: [],
        sessions: [{ sessionId: 'sess-declare', purpose: 'dev', boundAt: AT }],
        commits: [], acceptances: [],
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true, revision: 1, record: bound, planFileExists: [], reviewFileExists: [], releaseDrifted: [],
    }))))
    const sessions = {
      ids: ['sess-declare'],
      summariesById: { 'sess-declare': { id: 'sess-declare', displayTitle: 'WP1·开发 声明会话', running: false, blank: false } },
      subscribe: (): (() => void) => () => {},
      navigate: (): void => {},
    }
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, createWorkbenchFetcher())
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller, sessions })
    render(<Seat requirement={requirement} />)

    // 记录到位锚（0017 修订：会话条退役）。见证必须是**记录衍生物**——rail 徽章
    // 「1 工作包」只在 record 就绪（ready + mount-sync 已跑）后渲染；若只看
    // 「某 tab 被选中」（viewing 初始即 understand，① 首帧就选中）则点击会
    // 撞进 store 落账前的窗口，被 mount-sync 的 setViewing(stage) 覆盖。
    await waitFor(() => expect(screen.getByRole('tab', { name: /② 探索规划 1 工作包/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /交付/ }))
    await waitFor(() => expect(screen.getByText(workbenchZh['release.sectionTitle'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['declare.importButton'] }))
    const dialog = await screen.findByRole('dialog')
    // 会话标题来自 sessions face —— 断在 seat 边界这里就看不到标题。
    expect(within(dialog).getByRole('option', { name: /WP1·开发 声明会话/ })).toBeTruthy()
  })
})

describe('seat round-trip: SOW 投递 face 穿线（P5a 钉）', () => {
  it('deliver face 经 seat → Body 到达 SowModal（缺席 ⇒ 按钮不渲染——P2b 断裂同款防线）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true, revision: 1, record, planFileExists: [], reviewFileExists: [], releaseDrifted: [],
    }))))
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, {
      list: async () => ({ kind: 'ok' as const, revision: 1, records: [record] }),
      detail: async () => ({ kind: 'ok' as const, revision: 1, record, planFileExists: [], reviewFileExists: [], releaseDrifted: [] }),
      openKnowledge: async () => undefined,
      knowledgeList: async () => ({ kind: 'ok' as const, revision: 0, records: [] }),
    } as never)
    const deliver = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller, deliver })
    render(<Seat requirement={requirement} />)
    await waitFor(() => expect(screen.getByText(/发现一/)).toBeTruthy())

    // 打开任一 SOW 入口（S1 的生成分析任务书）——投递按钮只能来自 deliver face。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.analysisButton'] }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: workbenchZh['sow.deliver'] })).toBeTruthy()

    // 对照：不传 deliver 的 seat（jsdom 天然缺席）——按钮不渲染。
    cleanup()
    const store2 = createWorkbenchStore()
    const controller2 = createWorkbenchController(store2, {
      list: async () => ({ kind: 'ok' as const, revision: 1, records: [record] }),
      detail: async () => ({ kind: 'ok' as const, revision: 1, record, planFileExists: [], reviewFileExists: [], releaseDrifted: [] }),
      openKnowledge: async () => undefined,
      knowledgeList: async () => ({ kind: 'ok' as const, revision: 0, records: [] }),
    } as never)
    const Seat2 = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store: store2, controller: controller2 })
    render(<Seat2 requirement={requirement} />)
    await waitFor(() => expect(screen.getByText(/发现一/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.analysisButton'] }))
    const dialog2 = await screen.findByRole('dialog')
    expect(within(dialog2).queryByRole('button', { name: workbenchZh['sow.deliver'] })).toBeNull()
  })
})

describe('seat round-trip: S4 评审节穿线（P5b 钉）', () => {
  it('requirement/onOpenSow/sessions 三 prop 经 seat → Body 到达 ReviewSection（P2b 断裂同款防线）', async () => {
    const reviewRecord: WorkbenchRecord = {
      ...record,
      stage: 'review',
      stageHistory: [{ stage: 'review', at: AT }],
      workPackages: [{
        id: 'WP1', title: 'WP1', boundary: '', order: 1, dependsOn: [], covers: [],
        status: 'in-dev', plans: [],
        sessions: [{ sessionId: 'sess-review', purpose: 'review', boundAt: AT }],
        commits: [], acceptances: [],
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true, revision: 1, record: reviewRecord, planFileExists: [], reviewFileExists: [], releaseDrifted: [],
    }))))
    const sessions = {
      ids: ['sess-review'],
      summariesById: { 'sess-review': { id: 'sess-review', displayTitle: '评审·09-27', running: false, blank: false } },
      subscribe: (): (() => void) => () => {},
      navigate: (): void => {},
    }
    const store = createWorkbenchStore()
    const controller = createWorkbenchController(store, createWorkbenchFetcher())
    const Seat = createWorkbenchTabSeat({ t: (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key, store, controller, sessions })
    render(<Seat requirement={requirement} />)

    // 记录到位锚（0017 修订：会话条退役）——记录衍生徽章见证（同 S5 钉：
    // 防点击撞进 store 落账前窗口被 mount-sync 覆盖）。
    await waitFor(() => expect(screen.getByRole('tab', { name: /② 探索规划 1 工作包/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /评审/ }))
    await waitFor(() => expect(screen.getByText(workbenchZh['review.sectionTitle'])).toBeTruthy())

    // onOpenSow 穿线见证：评审任务书入口按钮在场（缺席则该按钮不渲染）。
    expect(screen.getByRole('button', { name: workbenchZh['sow.reviewButton'] })).toBeTruthy()
    // 点开任务书 → 预览出现 review 约定骨架（requirement 穿线见证：标题进 [需求] 段）。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['sow.reviewButton'] }))
    const sowDialog = await screen.findByRole('dialog', { name: workbenchZh['sow.title'] })
    // 0021 渲染轮：默认渲染面——先切编辑态再读文本。
    fireEvent.click(within(sowDialog).getByRole('button', { name: workbenchZh['md.edit'] }))
    await waitFor(() => expect((within(sowDialog).getByTestId('sow-preview').textContent ?? '')).toContain('# skyaxis-review'))
    // requirement 穿线见证：需求标题进 [需求] 段（seat 传的是 requirement={requirement}，title='R'）。
    expect(within(sowDialog).getByTestId('sow-preview').textContent).toContain('标题：R')
    // 关闭任务书 Modal。
    fireEvent.click(within(sowDialog).getAllByRole('button', { name: workbenchZh['action.cancel'] }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: workbenchZh['sow.title'] })).toBeNull())

    // sessions 穿线见证：导入报告 Modal 的会话列表列出绑定会话标题（缺席则整块不渲染；
    // 0024 D3-B 起为滚动单选列表形——原生 select 弹层在宿主 webview 不滚动）。
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['review.importButton'] }))
    const importDialog = await screen.findByRole('dialog', { name: workbenchZh['review.importTitle'] })
    expect(within(importDialog).getByText(workbenchZh['review.sessionLabel'])).toBeTruthy()
    expect(within(importDialog).getByRole('radio', { name: /评审·09-27/ })).toBeTruthy()
  })
})
