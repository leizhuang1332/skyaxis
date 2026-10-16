// @vitest-environment jsdom
/**
 * SOW 生成 Modal（0006 P2；analysis 重设计 = research 0008；0009 任务书
 * 精简轮）：注入 fake fetchPrdList/fetchPrdText/fetchPlanText/copy——
 * analysis/split/consolidate 无左侧 PRD 组（0009：路径引用全部必读、split
 * 无 PRD 面、正文零嵌入、revision 戳退役），dev/review 保留章节勾选组与
 * 多文档 select；知识命中计数行与默认勾选态、勾选联动知识预览、超上限
 * 禁复制 + 警示、copy 成功/失败、dev 语境 [工作包] 段、0009 可编辑
 * textarea（键入即改、copy 收编辑后全文、恢复生成内容、脏锁不覆盖）。
 *
 * 预览断言走 data-testid 的 textarea value（buildSow 产物是整块字符串）；
 * Modal portal 进 body，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkbenchKnowledgeRecord, WorkbenchRecord, WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { SowModal } from '../../src/client/workbench/sow-modal.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const requirement: RequirementRecord = {
  id: RID,
  title: '导出功能改造',
  description: '支持大数据量异步导出',
  // Analysis previews cite workspace-relative paths; a bound path exercises
  // the normalization (backslashes → forward) without touching dev cases.
  workspacePath: 'C:\\ws\\demo',
  linkedRepos: [],
  createdAt: AT,
  updatedAt: AT,
}

function knowledge(id: string, overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
  return {
    id,
    scope: 'requirement',
    type: 'business',
    title: `知识-${id}`,
    content: `内容-${id}`,
    requirementId: RID,
    trigger: { mode: 'always' },
    status: 'active',
    provenance: { at: AT },
    ...overrides,
  }
}

function wp(id: string, overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id,
    title: `工作包-${id}`,
    boundary: `边界-${id}`,
    order: 1,
    dependsOn: [],
    covers: [],
    status: 'plan-approved',
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

afterEach(() => {
  cleanup()
})

type SowModalProps = Parameters<typeof SowModal>[0]

function subject(overrides: Partial<SowModalProps> = {}) {
  return render(
    <SowModal
      t={bindZh()}
      open
      purpose="analysis"
      requirement={requirement}
      record={null}
      knowledgeRecords={[]}
      revision={7}
      onClose={() => { /* noop */ }}
      fetchPrdList={async () => []}
      fetchPrdText={async () => ''}
      fetchPlanText={async () => undefined}
      copy={async () => true}
      {...overrides}
    />,
  )
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

// 0009: the preview is an editable textarea — assertions read its value.
const previewText = (rendered: ReturnType<typeof subject>): string =>
  (rendered.getByTestId('sow-preview') as HTMLTextAreaElement).value

describe('SowModal（SOW 生成 Modal）', () => {
  it('analysis 预览（0009 指针退役）：PRD 路径引用全部必读（正文零嵌入、不拉正文）；无左侧 PRD 组、无 select', async () => {
    const fetchPrdText = vi.fn(async () => '# 背景\n背景正文\n\n## 方案\n方案正文')
    const rendered = subject({ fetchPrdList: async () => [{ name: 'a.md' }, { name: 'b.md', sizeBytes: 4096 }], fetchPrdText })

    await waitFor(() => expect(previewText(rendered)).toContain('必读 prds/a.md'))
    // 0009：无焦点文档链——正文一次都不拉。
    expect(fetchPrdText).not.toHaveBeenCalled()
    const text = previewText(rendered)
    expect(text).toContain('工作区根目录：C:/ws/demo（下列相对路径以此为根）')
    expect(text).toContain('- 必读 prds/a.md')
    expect(text).toContain('- 必读 prds/b.md（4.0 KB）')
    expect(text).not.toContain('按需 prds/')
    expect(text).not.toContain('重点章节')
    // 路径引用本体：章节正文一个字不进任务书；戳退役。
    expect(text).not.toContain('背景正文')
    expect(text).not.toContain('此后账本变更不自动同步')
    // 左侧 PRD 组退役：无文档 select、无章节 checkbox。
    expect(rendered.queryByRole('combobox')).toBeNull()
    expect(rendered.queryByRole('checkbox', { name: '背景' })).toBeNull()
  })

  it('多文档 select 切换（0009 起左侧组仅 dev/review）：焦点文档换位、切到 b.md 重取正文并重置全勾', async () => {
    const fetchPrdText = vi.fn(async (name: string) =>
      name === 'a.md' ? '# a 标题\na 正文' : '## b 背景\nb 正文')
    const target = wp('WP1')
    const rendered = subject({
      purpose: 'dev',
      workPackage: target,
      record: record({ workPackages: [target] }),
      fetchPrdList: async () => [{ name: 'a.md' }, { name: 'b.md' }],
      fetchPrdText,
    })

    await waitFor(() => expect(fetchPrdText).toHaveBeenCalledWith('a.md'))
    await waitFor(() => expect(previewText(rendered)).toContain('[PRD 节选]\n文档：a.md\n\n## a 标题\na 正文'))
    const select = (await rendered.findByRole('combobox')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b.md' } })
    await waitFor(() => expect(fetchPrdText).toHaveBeenCalledWith('b.md'))
    await waitFor(() => expect(previewText(rendered)).toContain('[PRD 节选]\n文档：b.md\n\n## b 背景\nb 正文'))
    expect(fetchPrdText).toHaveBeenCalledTimes(2)
  })

  it('PRD 列表加载失败/无文档：analysis 无组内 UI（输入段诚实行承载）；dev 组内提示照旧', async () => {
    const rendered = subject({ fetchPrdList: async () => null })
    await waitFor(() => expect(previewText(rendered)).toContain('（PRD 文档列表未可得——可列举 prds/ 目录确认）'))
    expect(rendered.queryByText(workbenchZh['sow.prdLoadError'])).toBeNull()
    rendered.unmount()

    const rendered2 = subject({ fetchPrdList: async () => [] })
    await waitFor(() => expect(previewText(rendered2)).toContain('（prds/ 目录暂无文档——分析只能基于需求描述与代码）'))
    expect(rendered2.queryByText(workbenchZh['sow.prdEmpty'])).toBeNull()
    rendered2.unmount()

    // dev 语境：左侧组在场，组内提示照旧。
    const target = wp('WP1')
    const devFail = subject({ purpose: 'dev', workPackage: target, record: record({ workPackages: [target] }), fetchPrdList: async () => null })
    expect(await devFail.findByText(workbenchZh['sow.prdLoadError'])).toBeTruthy()
    devFail.unmount()
    const devEmpty = subject({ purpose: 'dev', workPackage: target, record: record({ workPackages: [target] }), fetchPrdList: async () => [] })
    expect(await devEmpty.findByText(workbenchZh['sow.prdEmpty'])).toBeTruthy()
  })

  it('0009 split 预览：无 PRD 面（列表/正文均不拉）+ 定稿带锚基线必读行 + 未定稿诚实行；五段头与正文嵌入退役', async () => {
    const fetchPrdList = vi.fn(async () => [{ name: 'a.md' }])
    const fetchPrdText = vi.fn(async () => '# 背景\n背景正文')
    const rendered = subject({
      purpose: 'split',
      record: record({
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
      }),
      fetchPrdList,
      fetchPrdText,
    })

    await waitFor(() => expect(previewText(rendered)).toContain('# skyaxis 拆分任务书 · '))
    // 0009 D2：split 无 PRD 面——列表与正文一次都不拉。
    expect(fetchPrdList).not.toHaveBeenCalled()
    expect(fetchPrdText).not.toHaveBeenCalled()
    const text = previewText(rendered)
    expect(text).toContain(`- 必读 .skyaxis/requirements/${RID}.md——需求基线文档，本拆分的唯一需求真源`)
    expect(text).not.toContain('必读 prds/')
    // 五段老形态（split 专属退役）：方括号段头与章节正文不出现；戳退役。
    expect(text).not.toContain('[需求]')
    expect(text).not.toContain('[PRD 节选]')
    expect(text).not.toContain('背景正文')
    expect(text).not.toContain('此后账本变更不自动同步')
    // declare plain 骨架照旧（knowledge + stageReady，无提议键）。
    expect(text).toContain('knowledge: []')
    expect(text).toContain('stageReady: false')
    expect(text).not.toContain('findings 每条')
    expect(rendered.queryByRole('combobox')).toBeNull()

    // 未定稿（record null ⇒ 无锚）⇒ 诚实行。
    rendered.unmount()
    const notFinalized = subject({ purpose: 'split', fetchPrdList, fetchPrdText })
    await waitFor(() => expect(previewText(notFinalized)).toContain('# skyaxis 拆分任务书 · '))
    expect(previewText(notFinalized)).toContain('（需求理解未定稿——尚无锚定的需求基线文档；本次拆分以需求描述为唯一需求依据。）')
  })

  it('0012 plan 预览：无 PRD 面（列表/正文均不拉）+ 基线必读行（「本次规划」措辞）+ 规划文件路径；无 declare 块、无左组', async () => {
    const fetchPrdList = vi.fn(async () => [{ name: 'a.md' }])
    const fetchPrdText = vi.fn(async () => '# 背景\n背景正文')
    const rendered = subject({
      purpose: 'plan',
      record: record({
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        planAdoptedAt: AT,
        planBaseline: { at: AT, docHash: 'p'.repeat(64) },
      }),
      fetchPrdList,
      fetchPrdText,
    })

    await waitFor(() => expect(previewText(rendered)).toContain('# skyaxis 规划任务书 · '))
    // plan 与 split 同形：无 PRD 面——列表与正文一次都不拉。
    expect(fetchPrdList).not.toHaveBeenCalled()
    expect(fetchPrdText).not.toHaveBeenCalled()
    const text = previewText(rendered)
    expect(text).toContain(`- 必读 .skyaxis/requirements/${RID}.md——需求基线文档，本次规划的唯一需求真源`)
    // 输出段：写规划文件（工作区已绑定 fixture）+ 重新规划状态行；不读自己的产物。
    expect(text).toContain(`路径：C:/ws/demo/.skyaxis/planning/${RID}.md`)
    expect(text).toContain('技术规划采纳：已采纳（')
    expect(text).not.toContain('必读 .skyaxis/planning/')
    // 整理任务书先例：无 declare 块、无戳。
    expect(text).not.toContain('skyaxis-declare')
    expect(text).not.toContain('此后账本变更不自动同步')
    expect(rendered.queryByRole('combobox')).toBeNull()
  })

  it('0008/0009 consolidate 预览：无左侧 PRD 面（提示组退役）+ 全必读清单 + 基线文件路径段；正文零嵌入', async () => {
    const fetchPrdText = vi.fn(async () => '# 背景\n背景正文')
    const rendered = subject({ purpose: 'consolidate' as never, fetchPrdList: async () => [{ name: 'a.md' }, { name: 'b.md' }], fetchPrdText })

    // consolidate 不拉正文（无章节可勾）——唯一一次 fetch 是列表。
    await waitFor(() => expect(previewText(rendered)).toContain('# skyaxis 需求整理任务书 · '))
    expect(fetchPrdText).not.toHaveBeenCalled()
    // 0009：左侧 PRD 提示组退役——无 combobox / 无章节 checkbox。
    expect(rendered.queryByRole('combobox')).toBeNull()
    expect(rendered.queryByRole('checkbox', { name: '背景' })).toBeNull()
    // 全部文档必读（无重点章节指针），正文零嵌入；戳退役。
    const text = previewText(rendered)
    expect(text).toContain('- 必读 prds/a.md')
    expect(text).toContain('- 必读 prds/b.md')
    expect(text).not.toContain('重点章节')
    expect(text).not.toContain('背景正文')
    expect(text).not.toContain('此后账本变更不自动同步')
    // 输出节带基线文件路径 + 十节模板头。
    expect(text).toContain('.skyaxis/requirements/')
    expect(text).toContain('# 需求基线 · <需求标题>')
  })

  it('知识命中计数行：{n} 只计 always+keyword，{size}/{cap} KB 一位小数；行渲染 [mode] 标题', async () => {
    const rendered = subject({
      knowledgeRecords: [
        knowledge('k1', { trigger: { mode: 'always' } }),
        knowledge('k2', { trigger: { mode: 'keyword', value: '导出' } }),
        knowledge('k3', { trigger: { mode: 'keyword', value: '不存在词' } }),
        knowledge('k4', { trigger: { mode: 'manual' } }),
      ],
    })

    expect(await rendered.findByText(/命中 2 · 0\.0 KB \/ 上限 8\.0 KB/)).toBeTruthy()
    expect(rendered.getByLabelText('[always] 知识-k1')).toBeTruthy()
    expect(rendered.getByLabelText('[keyword: 导出] 知识-k2')).toBeTruthy()
    expect(rendered.getByLabelText('[manual] 知识-k4')).toBeTruthy()
    expect(rendered.queryByLabelText('[keyword] 知识-k3')).toBeNull()
    // 默认勾选态：always+keyword 入预览，manual 不入；未命中 k3 全程不入。
    expect(previewText(rendered)).toContain('### 知识-k1')
    expect(previewText(rendered)).toContain('### 知识-k2')
    expect(previewText(rendered)).not.toContain('知识-k4')
    expect(previewText(rendered)).not.toContain('知识-k3')
  })

  it('知识勾选联动：取消 always → 知识段（无）；勾上 manual → 进入预览', async () => {
    const rendered = subject({
      knowledgeRecords: [knowledge('k1'), knowledge('k4', { trigger: { mode: 'manual' } })],
    })

    await rendered.findByLabelText('[always] 知识-k1')
    fireEvent.click(rendered.getByLabelText('[always] 知识-k1'))
    await waitFor(() => expect(previewText(rendered)).toContain('## 参考知识（工作台注入，已审定）\n（无）'))
    fireEvent.click(rendered.getByLabelText('[manual] 知识-k4'))
    await waitFor(() => expect(previewText(rendered)).toContain('### 知识-k4\n（触发：manual）\n内容-k4'))
  })

  it('超上限（条数）：copy 禁用 + 警示行；取消一条即恢复可复制', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => knowledge(`k${index + 1}`))
    const copy = vi.fn(async () => true)
    const rendered = subject({ knowledgeRecords: nine, copy })

    const warn = await rendered.findByRole('alert')
    expect(warn.textContent).toContain('超出注入上限（9 条 /')
    const copyButton = rendered.getByRole('button', { name: workbenchZh['sow.copy'] }) as HTMLButtonElement
    expect(copyButton.disabled).toBe(true)
    fireEvent.click(copyButton)
    await tick()
    expect(copy).not.toHaveBeenCalled()

    fireEvent.click(rendered.getByLabelText('[always] 知识-k1'))
    await waitFor(() => expect(rendered.queryByRole('alert')).toBeNull())
    expect(((rendered.getByRole('button', { name: workbenchZh['sow.copy'] }) as HTMLButtonElement)).disabled).toBe(false)
  })

  it('copy 成功：copy 收到预览全文，按钮 copied 一秒后复位', async () => {
    const copy = vi.fn(async (_text: string) => true)
    const rendered = subject({ copy })

    const copyButton = (): HTMLButtonElement => rendered.getByRole('button', { name: workbenchZh['sow.copy'] }) as HTMLButtonElement
    await waitFor(() => expect(copyButton().disabled).toBe(false))
    fireEvent.click(copyButton())
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1))
    const sent = copy.mock.calls[0][0]
    expect(sent).toContain('# skyaxis 分析任务书 · 导出功能改造')
    expect(sent).toContain('标题：导出功能改造')
    expect(rendered.getByText(workbenchZh['sow.copied'])).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(rendered.getByText(workbenchZh['sow.copy'])).toBeTruthy()
  })

  it('copy 失败：copyFailed 警示（可重试），重试成功警示消失', async () => {
    const copy = vi.fn(async (_text: string) => true).mockResolvedValueOnce(false)
    const rendered = subject({ copy })

    const copyButton = (): HTMLButtonElement => rendered.getByRole('button', { name: workbenchZh['sow.copy'] }) as HTMLButtonElement
    await waitFor(() => expect(copyButton().disabled).toBe(false))
    fireEvent.click(copyButton())
    expect(await rendered.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(workbenchZh['sow.copyFailed'])
    expect(copyButton().disabled).toBe(false)
    fireEvent.click(copyButton())
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(rendered.queryByRole('alert')).toBeNull())
    expect(rendered.getByText(workbenchZh['sow.copied'])).toBeTruthy()
  })

  it('0009 编辑：键入即改文本、copy 收到编辑后全文；恢复生成内容复位并隐藏', async () => {
    const copy = vi.fn(async (_text: string) => true)
    const rendered = subject({ copy })

    const editor = (): HTMLTextAreaElement => rendered.getByTestId('sow-preview') as HTMLTextAreaElement
    await waitFor(() => expect(editor().value).toContain('# skyaxis 分析任务书'))
    // 未编辑 ⇒ 无恢复按钮。
    expect(rendered.queryByRole('button', { name: workbenchZh['sow.resetEdit'] })).toBeNull()

    fireEvent.change(editor(), { target: { value: '# 我改过的任务书\n只有这些' } })
    expect(editor().value).toBe('# 我改过的任务书\n只有这些')
    expect(rendered.getByRole('button', { name: workbenchZh['sow.resetEdit'] })).toBeTruthy()

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.copy'] }))
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1))
    expect(copy.mock.calls[0][0]).toBe('# 我改过的任务书\n只有这些')

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.resetEdit'] }))
    await waitFor(() => expect(editor().value).toContain('# skyaxis 分析任务书'))
    expect(rendered.queryByRole('button', { name: workbenchZh['sow.resetEdit'] })).toBeNull()
  })

  it('0009 编辑脏锁：编辑后左列勾选不覆盖用户文本；恢复后同步最新生成内容', async () => {
    const rendered = subject({
      knowledgeRecords: [knowledge('k1'), knowledge('k4', { trigger: { mode: 'manual' } })],
    })

    const editor = (): HTMLTextAreaElement => rendered.getByTestId('sow-preview') as HTMLTextAreaElement
    await waitFor(() => expect(editor().value).toContain('### 知识-k1'))
    fireEvent.change(editor(), { target: { value: '我的版本' } })
    // 勾选 manual：live 生成内容变化，但用户编辑不被覆盖（恢复按钮负责同步）。
    fireEvent.click(rendered.getByLabelText('[manual] 知识-k4'))
    expect(editor().value).toBe('我的版本')
    // 恢复 ⇒ 同步最新生成内容（含新勾的 k4）。
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.resetEdit'] }))
    await waitFor(() => expect(editor().value).toContain('### 知识-k4'))
  })

  it('dev 语境：预览含 [工作包] 段 + 已批准计划正文 + dev declare；有计划不出无计划提示', async () => {
    const target = wp('WP1', { title: '导出队列', boundary: '做队列；不做存储' })
    const fetchPlanText = vi.fn(async () => '1. 建任务表')
    const rendered = subject({
      purpose: 'dev',
      workPackage: target,
      record: record({ workPackages: [target] }),
      fetchPlanText,
    })

    await waitFor(() => expect(fetchPlanText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewText(rendered)).toContain('### 已批准计划\n1. 建任务表'))
    const text = previewText(rendered)
    expect(text).toContain('[工作包]\nWP1　导出队列\n边界：做队列；不做存储')
    expect(text).toContain('workPackage: WP1\nclaims:\n  - built: true')
    expect(text).toContain('生成于 revision 7 ·')
    expect(rendered.queryByText(workbenchZh['sow.wpNoApprovedPlan'])).toBeNull()
    // 无依赖工作包 → 依赖摘要勾选行不出现。
    expect(rendered.queryByLabelText(workbenchZh['sow.wpDeps'])).toBeNull()
  })

  it('dev 语境无已批准计划：wpNoApprovedPlan 提示 + 预览占位行', async () => {
    const rendered = subject({
      purpose: 'dev',
      workPackage: wp('WP1'),
      record: record({ workPackages: [wp('WP1')] }),
      fetchPlanText: async () => undefined,
    })

    expect(await rendered.findByText(workbenchZh['sow.wpNoApprovedPlan'])).toBeTruthy()
    await waitFor(() => expect(previewText(rendered)).toContain('（尚无已批准计划）'))
  })

  it('dev 语境依赖摘要勾选：默认不勾不产摘要，勾上后预览逐依赖一行', async () => {
    const target = wp('WP1', { title: '导出队列', dependsOn: ['WP2'] })
    const rendered = subject({
      purpose: 'dev',
      workPackage: target,
      record: record({
        workPackages: [target, wp('WP2', { title: '存储层', boundary: '只做表结构', order: 2 })],
      }),
      fetchPlanText: async () => undefined,
    })

    const depsBox = await rendered.findByLabelText(workbenchZh['sow.wpDeps']) as HTMLInputElement
    expect(depsBox.checked).toBe(false)
    await waitFor(() => expect(previewText(rendered)).toContain('[工作包]'))
    expect(previewText(rendered)).not.toContain('依赖工作包摘要')
    fireEvent.click(depsBox)
    await waitFor(() => expect(previewText(rendered)).toContain('依赖工作包摘要：\n- WP2 存储层 · 只做表结构'))
  })
})

describe('SowModal 投递 v2（P5a）', () => {
  const previewOf = (rendered: ReturnType<typeof subject>): string =>
    (rendered.getByTestId('sow-preview') as HTMLTextAreaElement).value

  it('deliver 缺席 ⇒ 投递按钮不渲染（诚实降级，复制为 primary）；在场 ⇒ 投递 primary / 复制降 ghost', async () => {
    const noFace = subject({})
    expect(noFace.queryByRole('button', { name: workbenchZh['sow.deliver'] })).toBeNull()
    expect(noFace.getByRole('button', { name: workbenchZh['sow.copy'] }).className).toContain('primary')
    cleanup()

    const deliver = vi.fn(async (_text: string, _ws: string | undefined): Promise<{ ok: true; sessionId: string } | { ok: false; reason: 'failed' }> => ({ ok: true, sessionId: 'sess-1' }))
    const withFace = subject({ deliver })
    expect(withFace.getByRole('button', { name: workbenchZh['sow.deliver'] }).className).toContain('primary')
    expect(withFace.getByRole('button', { name: workbenchZh['sow.copy'] }).className).toContain('ghost')
  })

  it('投递 payload：全文 + requirement.workspacePath 作 cwd；成功关窗', async () => {
    const deliver = vi.fn(async (_text: string, _ws: string | undefined): Promise<{ ok: true; sessionId: string } | { ok: false; reason: 'failed' }> => ({ ok: true, sessionId: 'sess-1' }))
    const onClose = vi.fn()
    const rendered = subject({ deliver, onClose })
    await waitFor(() => expect(previewOf(rendered)).toContain('# skyaxis 分析任务书'))

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(deliver.mock.calls[0]?.[0]).toContain('# skyaxis 分析任务书 · 导出功能改造')
    expect(deliver.mock.calls[0]?.[0]).not.toContain('此后账本变更不自动同步')
    expect(deliver.mock.calls[0]?.[1]).toBe('C:\\ws\\demo') // requirement 夹具的 workspacePath（非空 ⇒ 作 cwd）
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('投递失败：警示行（可复制兜底），窗不关；重试成功后关', async () => {
    const deliver = vi.fn(async (_text: string, _ws: string | undefined): Promise<{ ok: true; sessionId: string } | { ok: false; reason: 'failed' }> => ({ ok: false, reason: 'failed' }))
    const onClose = vi.fn()
    const rendered = subject({ deliver, onClose })
    await waitFor(() => expect(previewOf(rendered)).toContain('# skyaxis 分析任务书'))

    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.deliver'] }))
    expect(await rendered.findByRole('alert')).toBeTruthy()
    expect(rendered.getByRole('alert').textContent).toBe(workbenchZh['sow.deliverFailed'])
    expect(onClose).not.toHaveBeenCalled()
    expect(rendered.getByRole('button', { name: workbenchZh['sow.copy'] })).toBeTruthy() // 复制兜底在场

    deliver.mockImplementation(async () => ({ ok: true as const, sessionId: 's' }))
    fireEvent.click(rendered.getByRole('button', { name: workbenchZh['sow.deliver'] }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
