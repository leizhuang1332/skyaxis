/**
 * SOW 纯函数（0006 P2；analysis 重设计 = research 0008；0009 任务书精简轮）：
 * splitPrdSections（ATX 切分 / preamble 归一 / 空文）+ matchKnowledge（always
 * 全 / keyword 大小写命中 / manual 列出不命中标记 / archived 排除 / path 不
 * 列）+ knowledgeBytes（UTF-8 逐条求和）+ buildSow 三形态分派：analysis/
 * split/consolidate 九节骨架（0009：PRD 重点指针退役——analysis 全必读、
 * split 只引需求基线文档且快照瘦身；revision 戳退役）与 dev/review 五段旧
 * 路径（criteria 清单、dev 全段两态、declare 骨架 workPackage 键、revision
 * 戳保留）。
 */
import { describe, expect, it } from 'vitest'
import type {
  WorkbenchCriterion,
  WorkbenchFinding,
  WorkbenchKnowledgeRecord,
  WorkbenchRecord,
  WorkbenchWorkPackage,
} from '../../src/workbench-shared/protocol.js'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import { buildSow, globToRegExp, knowledgeBytes, matchKnowledge, splitPrdSections } from '../../src/client/workbench/sow.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

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
    status: 'planned',
    plans: [],
    sessions: [],
    commits: [],
    acceptances: [],
    ...overrides,
  }
}

function finding(id: string, overrides: Partial<WorkbenchFinding> = {}): WorkbenchFinding {
  return {
    id,
    category: 'conflict',
    severity: 'high',
    title: `发现-${id}`,
    detail: '详情',
    status: 'open',
    createdAt: AT,
    ...overrides,
  }
}

const requirement: RequirementRecord = {
  id: RID,
  title: '导出功能改造',
  description: '支持大数据量异步导出',
  workspacePath: '',
  linkedRepos: [],
  createdAt: AT,
  updatedAt: AT,
}

const criteria: WorkbenchCriterion[] = [
  { id: 'C1', text: '十万行导出 30 秒内完成', coveredBy: ['WP1'] },
  { id: 'C2', text: '导出任务可取消', coveredBy: [] },
]

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

const baseCtx = {
  purpose: 'analysis',
  requirement,
  record: null,
  revision: 3,
  generatedAt: '2026-09-29T12:34:56.789Z',
} as const

describe('splitPrdSections', () => {
  it('ATX 多级标题切分，正文原文保留、按文档序', () => {
    const sections = splitPrdSections('# 总览\n总览正文\n\n## 背景\n背景正文\n### 细节\n细节正文')
    expect(sections).toEqual([
      { heading: '总览', text: '总览正文' },
      { heading: '背景', text: '背景正文' },
      { heading: '细节', text: '细节正文' },
    ])
  })

  it('首标题前非空 preamble 归一节（heading 空串），节体 trim', () => {
    const sections = splitPrdSections('前置说明\n\n# 标题\n\n正文')
    expect(sections).toEqual([
      { heading: '', text: '前置说明' },
      { heading: '标题', text: '正文' },
    ])
  })

  it('无标题全文归 preamble 一节；空文切不出节', () => {
    expect(splitPrdSections('只有正文一段\n还有第二段')).toEqual([{ heading: '', text: '只有正文一段\n还有第二段' }])
    expect(splitPrdSections('')).toEqual([])
    expect(splitPrdSections('\n\n')).toEqual([])
  })
})

describe('matchKnowledge', () => {
  it('always 全列；keyword 大小写不敏感命中才列，未命中不列', () => {
    const picks = matchKnowledge(
      [
        knowledge('k1', { trigger: { mode: 'always' } }),
        knowledge('k2', { trigger: { mode: 'keyword', value: ' Export ' } }),
        knowledge('k3', { trigger: { mode: 'keyword', value: '不存在词' } }),
      ],
      '支持 export 功能改造\n异步导出',
    )
    expect(picks.map((pick) => ({ id: pick.record.id, match: pick.match }))).toEqual([
      { id: 'k1', match: 'always' },
      { id: 'k2', match: 'keyword' },
    ])
  })

  it('manual 列出且标记 manual（勾选交呈现层）', () => {
    const picks = matchKnowledge([knowledge('k4', { trigger: { mode: 'manual' } })], '')
    expect(picks).toHaveLength(1)
    expect(picks[0].match).toBe('manual')
  })

  it('archived 排除；path 行无 contextPaths 参数 ⇒ 恒不列（诚实缺席：无工作区无可匹配）', () => {
    const picks = matchKnowledge(
      [
        knowledge('k5', { status: 'archived', trigger: { mode: 'always' } }),
        knowledge('k6', { trigger: { mode: 'path', value: 'src/**' } }),
      ],
      '导出',
    )
    expect(picks).toEqual([])
  })

  it('P5a path 命中：相对 glob = 有上下文即列（v1 确定性口径）；绝对 glob 需前缀命中', () => {
    const rows = [
      knowledge('k-src', { trigger: { mode: 'path', value: 'src/**' } }),
      knowledge('k-repo', { trigger: { mode: 'path', value: 'C:/ws/quote/repos/**' } }),
      knowledge('k-miss', { trigger: { mode: 'path', value: 'C:/other/**' } }),
    ]
    const picks = matchKnowledge(rows, '导出', ['C:/ws/quote', 'C:/ws/quote/repos/repo-alpha-aaaa'])
    expect(picks.map((pick) => pick.record.id)).toEqual(['k-src', 'k-repo'])
    expect(picks[0]?.match).toBe('path')

    // 上下文缺席 ⇒ 相对 glob 也不列（诚实缺席）
    const none = matchKnowledge([rows[0]!], '导出', [])
    expect(none).toEqual([])
  })

  it('globToRegExp 矩阵：** 跨段 / * 不跨段 / 斜杠归一 / 锚定全路径 / **/ 可零段 / 元字符转义', () => {
    expect(globToRegExp('src/**').test('src/a/b/c.ts')).toBe(true)
    expect(globToRegExp('src/**').test('src/')).toBe(true)
    expect(globToRegExp('src/**').test('src')).toBe(false)            // 全路径锚定：无斜杠不算 under
    expect(globToRegExp('src/*').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*').test('src/a/b.ts')).toBe(false)      // 单 * 不跨段
    expect(globToRegExp('src/**/*.ts').test('src/x.ts')).toBe(true)   // **/ 可零段
    expect(globToRegExp('src/**/*.ts').test('src/a/b/x.ts')).toBe(true)
    expect(globToRegExp('C:/ws/q/**').test('C:/ws/q/r')).toBe(true)   // globToRegExp 契约：两侧已归一
    expect(matchKnowledge(
      [knowledge('k-abs', { trigger: { mode: 'path', value: 'C:/ws/quote/**' } })],
      'x',
      ['C:\\ws\\quote\\repos\\alpha'],                                  // 反斜杠上下文路径在匹配层归一
    ).map((pick) => pick.record.id)).toEqual(['k-abs'])
    expect(globToRegExp('a.b').test('axb')).toBe(false)               // 点是字面量
    expect(globToRegExp('src/**').test('etc/src/a')).toBe(false)      // 锚定全路径
  })
})

describe('knowledgeBytes', () => {
  it('UTF-8 字节逐条求和（CJK 3 字节、ASCII 1 字节）', () => {
    // 'ab' = 2 字节 + '文' = 3 字节 → 5；'' + 'a文' = 4。
    const total = knowledgeBytes([
      { ...knowledge('k1'), title: 'ab', content: '文' },
      { ...knowledge('k2'), title: '', content: 'a文' },
    ])
    expect(total).toBe(9)
    expect(knowledgeBytes([])).toBe(0)
  })
})

describe('buildSow', () => {
  it('analysis 语境（research 0008）：九节新骨架 + record null 降级 + plain declare 骨架逐字不变', () => {
    const text = buildSow(baseCtx)
    expect(text.startsWith('# skyaxis 分析任务书 · 导出功能改造\n')).toBe(true)
    for (const header of ['## 目标', '## 需求快照（工作台账本，生成时快照）', '## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）', '## 参考知识（工作台注入，已审定）', '## 约束', '## 工作流', '## 输出']) {
      expect(text).toContain(header)
    }
    expect(text).toContain('标题：导出功能改造')
    expect(text).toContain('描述：支持大数据量异步导出')
    expect(text).toContain('（工作台记录未建立）')
    // 旧五段骨架退役：方括号段头不再出现，工作包段不出现。
    for (const gone of ['[需求]', '[PRD 节选]', '[知识注入]', '[工作包]', '[输出约定]']) {
      expect(text).not.toContain(gone)
    }
    expect(text).not.toContain('当前阶段')
    // 0009：revision 戳退役（保守精简——诚实锚由快照头「生成时快照」承担）。
    expect(text).not.toContain('此后账本变更不自动同步')
    // declare 骨架逐字 pin（回传轮 + 文件交付轮：analysis 专属骨架 = plain + findings/criteria/clarifications 三段教学）。
    expect(text).toContain('```yaml\n# skyaxis-declare\n# findings 每条 = 分析发现提议（category: feasibility|conflict|compatibility|risk|capacity|other；severity: high|medium|low）：\n#   - category: conflict\n#     severity: high\n#     title: 标题（64 字内）\n#     detail: 说明与证据出处（PRD#章节 或 代码 路径:行号）\n# criteria 每条 = 验收标准提议：\n#   - text: 一句可判定的话\n#     sourceSection: PRD#章节\n# clarifications 每条 = 待澄清问题（必须附你的推荐答案，把问题措辞成「是」即接受推荐）：\n#   - question: 问题（一句）\n#     recommendation: 推荐答案\n#     blocks: 阻塞了哪条结论（如 F2 / PRD#3.2）\n# knowledge 条目形如（type: business|convention）：\n#   - type: convention\n#     title: 标题\n#     draft: 内容\nknowledge: []\nstageReady: false\n```')
    expect(text).not.toContain('workPackage:')
    expect(text).not.toContain('claims:')
    // 约束/工作流/输出的关键纪律短语在场（只读、不裁决、F/A 编号、六类、完成自检）。
    for (const phrase of ['严格只读', '不裁决', '有限停止', '先查后问', 'F1 [类别·级别] 标题', 'A1 一句可判定的话', '六类逐类给过结论', '完成自检（全部满足才算收尾）']) {
      expect(text).toContain(phrase)
    }
  })

  it('文件交付轮：工作区绑定的输出/约束翻转为报告文件通道（绝对路径 + 覆盖写 + 自检尾句）；未绑定保留会话内交付原话', () => {
    const fileChannel = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\quote' },
    })
    // 输出节：路径行（反斜杠折正 + uuid 文件名）+ 覆盖写纪律 + 完成自检「报告已写入」尾句。
    expect(fileChannel).toContain('分析结束时把完整报告写入报告文件（markdown 正文 + 结尾机器可读声明块，一次成文），路径：C:/ws/quote/.skyaxis/analysis/11111111-1111-4111-8111-111111111111.md（绝对路径；目录不存在则创建；覆盖写——不追加、不留多份）。')
    expect(fileChannel).toContain('声明块已附 · 报告已写入上述路径。')
    // 约束节 carve-out：唯一例外条款替换「不写文件」。
    expect(fileChannel).toContain('- 严格只读：不修改、创建、删除任何文件；不建分支、不提交、不推送——唯一例外：把分析报告写入「输出」节指定路径的报告文件（目录不存在则创建，覆盖写）；除此之外以任何方式不改变工作区状态。')
    expect(fileChannel).not.toContain('分析报告在会话内交付，不写文件')

    // 未绑定工作区：会话内交付原话保留（兜底通道），无路径行。
    const conversation = buildSow(baseCtx)
    expect(conversation).toContain('分析报告在会话内交付，不写文件')
    expect(conversation).not.toContain('.skyaxis/analysis/')
    expect(conversation).not.toContain('报告已写入上述路径')
  })

  it('analysis 输入段（0009 指针退役）：PRD 路径引用全部必读（无重点指针）+ 仓库行（池名/分支）+ 缺失容错指令；正文零嵌入', () => {
    const text = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\quote' },
      analysisPrdDocs: [
        { name: 'prd.md', sizeBytes: 12 * 1024 + 300 },
        { name: 'notes.md', sizeBytes: 4096 },
      ],
      // 传入了也被忽略（prdSections 已是 dev/review 专用面）——退役钉死。
      prdDocumentName: 'prd.md',
      prdSections: [{ heading: '背景', text: '背景正文全文' }, { heading: '', text: '开篇正文' }, { heading: '容量', text: '容量正文' }],
      analysisRepos: [{ dirName: 'order-center-a1b2', poolName: 'order-center', branch: 'feat/export' }],
    })
    expect(text).toContain('工作区根目录：C:/ws/quote（下列相对路径以此为根）')
    expect(text).toContain('- 必读 prds/prd.md（12.3 KB）')
    expect(text).toContain('- 必读 prds/notes.md（4.0 KB）')
    expect(text).not.toContain('按需 prds/')
    expect(text).not.toContain('重点章节')
    expect(text).toContain('- 必读 repos/order-center-a1b2（order-center，分支 feat/export）——与需求相关的模块与现有实现')
    expect(text).toContain('路径不存在或不可读：停下来在「待澄清」中报告——不要假设内容，不要自行创建替代文件。')
    // 路径引用的本体断言：PRD 章节正文与章节指针一个字都不进任务书。
    expect(text).not.toContain('背景正文全文')
    expect(text).not.toContain('开篇正文')
    expect(text).not.toContain('容量正文')
  })

  it('analysis 输入段诚实缺席：工作区未绑定 / 无 PRD 文档 / 无仓库 / 目录名不可得计数行', () => {
    const unbound = buildSow(baseCtx)
    expect(unbound).toContain('（工作区未绑定——无可引用的文档与仓库，分析只能基于需求描述）')
    expect(unbound).not.toContain('PRD 文档（prds/ 目录）')

    const emptyWs = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:/ws/none' },
      analysisPrdDocs: [],
    })
    expect(emptyWs).toContain('（prds/ 目录暂无文档——分析只能基于需求描述与代码）')
    expect(emptyWs).toContain('（本需求未关联仓库）')

    // 列表未可得（加载中/失败）≠ 确认无文档——诚实未知单独成行。
    const unknownDocs = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:/ws/x' },
      analysisPrdDocs: null,
    })
    expect(unknownDocs).toContain('（PRD 文档列表未可得——可列举 prds/ 目录确认）')
    expect(unknownDocs).not.toContain('（prds/ 目录暂无文档')

    const unknownRepo = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:/ws/x', linkedRepos: [{ repoId: 'r1', branch: 'b' }, { repoId: 'r2', branch: 'b' }] },
      analysisRepos: [{ dirName: 'alpha-a1', poolName: 'alpha', branch: 'b' }],
      analysisUnknownRepos: 1,
    })
    expect(unknownRepo).toContain('- 必读 repos/alpha-a1（alpha，分支 b）')
    expect(unknownRepo).toContain('（另有 1 个已关联仓库的克隆目录名暂不可得——可列举 repos/ 目录对照）')
  })

  it('analysis 快照增强：已有标准逐条、未处置发现一行（resolved 不列）、空组（尚无）、工作包快照', () => {
    const text = buildSow({
      ...baseCtx,
      record: record({
        stage: 'understand',
        criteria,
        findings: [
          finding('f1', { category: 'conflict', severity: 'high', title: '与现有同步导出争用连接池' }),
          finding('f2', { status: 'resolved', title: '已处置的不该出现' }),
        ],
        workPackages: [wp('WP1', { title: '导出队列' })],
      }),
    })
    expect(text).toContain('当前阶段：需求理解')
    expect(text).toContain('已有验收标准：\n- C1 十万行导出 30 秒内完成\n- C2 导出任务可取消')
    expect(text).toContain('未处置发现：\n- [冲突·高] 与现有同步导出争用连接池')
    expect(text).not.toContain('已处置的不该出现')
    expect(text).toContain('- WP1 导出队列 · 已登记（planned）')

    const empty = buildSow({ ...baseCtx, record: record({ stage: 'understand' }) })
    expect(empty).toContain('已有验收标准：\n（尚无）')
    expect(empty).toContain('未处置发现：\n（尚无）')

    // 回传轮：待裁决提议列示（防重提议闭环）；空批不渲染该组。
    // 文件交付轮：已答澄清作为已定事实回灌（勿重复提问），未答并入勿重复提议清单。
    const withPending = buildSow({
      ...baseCtx,
      record: record({
        stage: 'understand',
        analysis: {
          session: { sessionId: 'sess-a', boundAt: AT },
          seed: { sessionId: 'sess-a', contentHash: 'c'.repeat(64), seededAt: AT, findings: 1, criteria: 1, clarifications: 2 },
          findings: [{ id: '77777777-7777-4777-8777-777777777777', category: 'conflict', severity: 'high', title: '待裁决发现甲' }],
          criteria: [{ id: '88888888-8888-4888-8888-888888888888', text: '待裁决标准乙' }],
          clarifications: [
            { id: '99999999-9999-4999-8999-999999999999', question: '导出上限是十万行还是百万行？', recommendation: '百万行', answer: '按百万行', answeredAt: AT },
            { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', question: '是否需要审计日志？', recommendation: '需要' },
          ],
        },
      }),
    })
    expect(withPending).toContain('待裁决提议（已收取未裁决，勿重复提议）：\n- [冲突·高] 待裁决发现甲\n- 标准：待裁决标准乙\n- 澄清：是否需要审计日志？')
    expect(withPending).toContain('已答澄清（需求方已回答，视为已定事实，勿重复提问）：\n- 问：导出上限是十万行还是百万行？ / 已答：按百万行')
    // 空批不渲染该组（输出节的「待裁决提议行」说明语不算——锚定组头）。
    expect(empty).not.toContain('待裁决提议（已收取未裁决')
  })

  it('split 九节（0007 骨架 + 0009 精简）：标题/目标/快照/输入/参考知识/约束/工作流/输出 + declare plain 骨架逐字（回归锚）', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'split',
      record: record({
        stage: 'plan',
        criteria,
        workPackages: [
          wp('WP1', { title: '导出队列', status: 'accepted' }),
          wp('WP2', { title: '存储层', order: 2 }),
        ],
      }),
    })
    expect(text).toContain('# skyaxis 拆分任务书 · 导出功能改造')
    expect(text).toContain('## 目标')
    expect(text).toContain('## 需求快照（工作台账本，生成时快照）')
    expect(text).toContain('## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(text).toContain('## 参考知识（工作台注入，已审定）')
    expect(text).toContain('## 约束')
    expect(text).toContain('## 工作流')
    expect(text).toContain('## 输出')
    // 工作包现状快照（re-split 语境）沿用；0009 D2：标准不进快照（基线文档携带）。
    expect(text).toContain('当前阶段：探索规划')
    expect(text).toContain('WP1 导出队列 · 已验收（accepted）')
    expect(text).toContain('WP2 存储层 · 已登记（planned）')
    expect(text).not.toContain('C1 十万行导出 30 秒内完成')
    expect(text).not.toContain('C2 导出任务可取消')
    // 0009：revision 戳退役。
    expect(text).not.toContain('此后账本变更不自动同步')
    // 回传轮回归锚：split/dev 的 declare 骨架不携带提议键（共享 plain 面未被殃及）。
    expect(text).toContain('```yaml\n# skyaxis-declare\n# knowledge 条目形如（type: business|convention）：\n#   - type: convention\n#     title: 标题\n#     draft: 内容\nknowledge: []\nstageReady: false\n```')
    expect(text).not.toContain('criteria:')
    expect(text).not.toContain('findings 每条')
    // 五段老形态退役（split 专属）：方括号段头与 PRD 嵌入段不再出现。
    expect(text).not.toContain('[需求]')
    expect(text).not.toContain('[PRD 节选]')
    expect(text).not.toContain('[知识注入]')
  })

  it('split 快照瘦身（0009 D2 唯一真源=基线文档）：标准/发现处置/已答澄清/待裁决提议全部退役；定稿状态行与工作包快照在场；record null 降级', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'split',
      record: record({
        stage: 'plan',
        criteria,
        understandApprovedAt: '2026-10-13T08:00:00.000Z',
        workPackages: [wp('WP1', { title: '导出队列' })],
        findings: [
          finding('f1', { status: 'open', category: 'risk', severity: 'high', title: '连接池争用' }),
          finding('f2', { status: 'resolved', resolution: '走异步队列', title: '同步导出阻塞' }),
          finding('f3', { status: 'wont-fix', title: '历史命名不统一' }),
        ],
        analysis: {
          session: { sessionId: 'sess-a', boundAt: AT },
          findings: [{ id: '99999999-9999-4999-8999-999999999999', category: 'risk', severity: 'low', title: '提议发现' }],
          criteria: [],
          clarifications: [
            { id: 'q1', question: '批量上限？', answer: '百万行', answeredAt: AT },
            { id: 'q2', question: '未答问题' },
          ],
        },
      }),
    })
    // 瘦身后的在场项：定稿状态行 + 工作包快照。
    expect(text).toContain('需求理解定稿：已定稿（2026-10-13）——理解阶段的裁决视为已定输入')
    expect(text).toContain('- WP1 导出队列 · 已登记（planned）')
    // 退役项（0009 D2）：这些真源内容都在基线文档里，任务书不再二次表达。
    expect(text).not.toContain('已有验收标准')
    expect(text).not.toContain('- C1 十万行导出 30 秒内完成')
    expect(text).not.toContain('未处置：[风险·高] 连接池争用')
    expect(text).not.toContain('已解决：[冲突·高] 同步导出阻塞 —— 方案：走异步队列')
    expect(text).not.toContain('不处理：[冲突·高] 历史命名不统一')
    expect(text).not.toContain('已答澄清（需求方已回答，视为已定事实）：')
    expect(text).not.toContain('待裁决提议（用户裁决中——勿重复提议、勿视为已定）：')
    expect(text).not.toContain('- [风险·低] 提议发现')
    expect(text).not.toContain('- 澄清：未答问题')
    // 约束/工作流/输出引用切换到基线文档（0009 文案对齐）。
    expect(text).toContain('通读需求基线文档与需求快照')
    expect(text).toContain('基线文档「验收标准」节逐条 C 编号')
    expect(text).toContain('（基线文档 FR/C 编号 或 代码 路径:行号）')
    expect(text).toContain('依据（基线文档 FR/C 编号 / 代码 路径:行号）')

    // 未定稿态 + record null 降级。
    const notFinalized = buildSow({ ...baseCtx, purpose: 'split', record: record({ criteria }) })
    expect(notFinalized).toContain('需求理解定稿：未定稿——理解阶段的裁决可能仍在进行')
    const noRecord = buildSow({ ...baseCtx, purpose: 'split', record: null })
    expect(noRecord).toContain('（工作台记录未建立——尚无基线文档可用，拆分只能基于需求描述）')
  })

  it('split 输入段（0009 D2）：PRD 列表整段退役——工作区根 + 未定稿诚实行 + repos/ 行；PRD 正文与清单零出现', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'split',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria }),
      // 传入了也被忽略——split 的 PRD 面（清单/焦点/指针）整体退役。
      prdDocumentName: '导出需求.md',
      prdSections: [{ heading: '导出范围', text: '全文正文不该出现' }],
      analysisPrdDocs: [{ name: '导出需求.md', sizeBytes: 2048 }, { name: '其他.md' }],
      analysisRepos: [{ dirName: 'order-svc', poolName: '订单服务', branch: 'feat/export' }],
      analysisUnknownRepos: 1,
    })
    expect(text).toContain('工作区根目录：C:/ws/repo-a（下列相对路径以此为根）')
    // 未定稿诚实行（record 无 understandApprovedAt/docHash）。
    expect(text).toContain('（需求理解未定稿——尚无锚定的需求基线文档；本次拆分以需求描述为唯一需求依据。）')
    // PRD 清单整段退役：任何 prds/ 行都不出现。
    expect(text).not.toContain('必读 prds/')
    expect(text).not.toContain('按需 prds/')
    expect(text).not.toContain('PRD 文档（prds/ 目录')
    expect(text).not.toContain('PRD 文档列表未可得')
    expect(text).toContain('- 必读 repos/order-svc（订单服务，分支 feat/export）——与需求相关的模块与现有实现')
    expect(text).toContain('（另有 1 个已关联仓库的克隆目录名暂不可得——可列举 repos/ 目录对照）')
    expect(text).not.toContain('全文正文不该出现')
  })

  it('consolidate 九节（0008）：标题/目标/快照/输入/参考知识/约束/工作流/输出 + 十节文档模板', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'consolidate',
      record: record({ criteria }),
    })
    expect(text).toContain('# skyaxis 需求整理任务书 · 导出功能改造')
    expect(text).toContain('## 目标')
    expect(text).toContain('## 需求快照（工作台账本，生成时快照——全量素材，整理的原料）')
    expect(text).toContain('## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(text).toContain('## 参考知识（工作台注入，已审定）')
    expect(text).toContain('## 约束')
    expect(text).toContain('## 工作流')
    expect(text).toContain('## 输出')
    // 十节文档模板骨架在场。
    expect(text).toContain('# 需求基线 · <需求标题>')
    expect(text).toContain('## 非目标')
    expect(text).toContain('## 术语表')
    expect(text).toContain('## 功能需求')
    expect(text).toContain('## 验收标准')
    expect(text).toContain('## 边界与异常')
    expect(text).toContain('## 已裁决风险')
    expect(text).toContain('## 澄清记录')
    expect(text).toContain('## 假设')
    expect(text).toContain('## 变更记录')
    // 0009：revision 戳退役（三 AI 语境统一）。
    expect(text).not.toContain('此后账本变更不自动同步')
  })

  it('consolidate 快照嵌全量素材（0008 与 analysis/split 行级摘要的分工）：发现带 detail+方案全文、澄清全文、待裁决禁写、未处置警示', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'consolidate',
      record: record({
        criteria,
        understandApprovedAt: '2026-10-14T08:00:00.000Z',
        findings: [
          finding('f1', { status: 'resolved', resolution: '走异步队列', title: '同步导出阻塞', detail: '现有实现同步拉全量，t_order 超时' }),
          finding('f2', { status: 'open', title: '连接池争用' }),
        ],
        analysis: {
          session: { sessionId: 'sess-a', boundAt: AT },
          findings: [{ id: '99999999-9999-4999-8999-999999999999', category: 'risk', severity: 'low', title: '提议发现' }],
          criteria: [],
          clarifications: [
            { id: 'q1', question: '批量上限是十万还是百万？', answer: '百万行，且要可取消', answeredAt: AT },
            { id: 'q2', question: '未答问题' },
          ],
        },
      }),
    })
    // detail 与方案全文进快照（整理需要完整素材）。
    expect(text).toContain('现有实现同步拉全量，t_order 超时')
    expect(text).toContain('方案：走异步队列')
    // 澄清全文。
    expect(text).toContain('- 问：批量上限是十万还是百万？\n  答：百万行，且要可取消')
    // 未处置警示 + 待裁决禁写 + 重整理编号纪律。
    expect(text).toContain('不得在整理中静默解决或弱化')
    expect(text).toContain('待裁决提议（用户裁决中——一律不得写入文档，视为不存在）')
    expect(text).toContain('当前已定稿于 2026-10-14——本次为重新整理：保持既有 FR 编号稳定，不回收不重排')
    // 约束纪律文案（C 对齐 / 澄清回填 / 溯源 / 假设）。
    expect(text).toContain('验收标准 C 编号与快照逐条对应，不增不删不改号')
    expect(text).toContain('不留自相矛盾的新旧双表述')
    expect(text).toContain('PRD#章节 / 发现编号 / 澄清来源')
    expect(text).toContain('[ASSUMPTION] 标记 + 文末索引')
    expect(text).not.toContain('criteria:')
    expect(text).not.toContain('findings 每条')
  })

  it('consolidate 输入段：全部 PRD 必读（无重点章节指针）；record null 降级；未绑定工作区输出节给会话内交付警示', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'consolidate',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria }),
      analysisPrdDocs: [{ name: '导出需求.md', sizeBytes: 2048 }, { name: '其他.md' }],
      analysisRepos: [{ dirName: 'order-svc', poolName: '订单服务', branch: 'feat/export' }],
    })
    expect(text).toContain('PRD 文档（prds/ 目录，全部通读——整理以原文为底，不能只读节选）：')
    expect(text).toContain('- 必读 prds/导出需求.md（2.0 KB）')
    expect(text).toContain('- 必读 prds/其他.md')
    expect(text).not.toContain('重点章节')
    expect(text).toContain('.skyaxis/requirements/')
    expect(text).toContain('整理结束时把完整文档写入基线文件')

    const noRecord = buildSow({ ...baseCtx, purpose: 'consolidate', record: null })
    expect(noRecord).toContain('（工作台记录未建立——尚无裁决可用，整理只能基于 PRD 原文）')

    const unbound = buildSow({ ...baseCtx, purpose: 'consolidate', record: record({ criteria }) })
    expect(unbound).toContain('（本需求未绑定工作区——无法指定基线文件路径，请在会话内交付文档全文。绑定工作区后重新生成任务书。）')
  })

  it('0008/0009 split 输入段基线三态：定稿带锚 ⇒ 必读行；定稿无锚 ⇒ 诚实行；未定稿 ⇒ 诚实行（依据账本不依据盘）', () => {
    const withAnchor = buildSow({
      ...baseCtx,
      purpose: 'split',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        criteria,
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
      }),
    })
    expect(withAnchor).toContain('- 必读 .skyaxis/requirements/11111111-1111-4111-8111-111111111111.md——需求基线文档，本拆分的唯一需求真源')
    expect(withAnchor).not.toContain('尚无锚定的需求基线文档')
    // 定稿无锚（pre-0008 定稿 / 定稿时工作区无文档）⇒ 诚实行而非静默。
    const finalizedNoAnchor = buildSow({
      ...baseCtx,
      purpose: 'split',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria, understandApprovedAt: AT, understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [] } }),
    })
    expect(finalizedNoAnchor).not.toContain('唯一需求真源')
    expect(finalizedNoAnchor).toContain('（需求理解已定稿但未锚定基线文档——定稿时工作区无此文档；本次拆分以需求描述为唯一需求依据。）')
    // 未定稿 ⇒ 诚实行。
    const notFinalized = buildSow({
      ...baseCtx,
      purpose: 'split',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria }),
    })
    expect(notFinalized).toContain('（需求理解未定稿——尚无锚定的需求基线文档；本次拆分以需求描述为唯一需求依据。）')
    // analysis/consolidate purpose 不出该行（专属 split 的下游衔接）。
    const analysisSow = buildSow({
      ...baseCtx,
      purpose: 'analysis',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria, understandApprovedAt: AT, understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) } }),
    })
    expect(analysisSow).not.toContain('唯一需求真源')
    expect(analysisSow).not.toContain('尚无锚定的需求基线文档')
  })

  it('dev 语境全段（approvedPlanText 有 + includeDeps）：边界/依赖/覆盖标准/已批准计划/依赖摘要/dev declare', () => {
    const target = wp('WP1', {
      title: '导出队列',
      boundary: '做队列；不做存储',
      dependsOn: ['WP2'],
      covers: ['C1'],
      status: 'plan-approved',
    })
    const text = buildSow({
      ...baseCtx,
      purpose: 'dev',
      record: record({ stage: 'implement', criteria, workPackages: [target, wp('WP2', { title: '存储层', boundary: '只做表结构', order: 2 })] }),
      workPackage: target,
      approvedPlanText: '1. 建任务表\n2. 起异步任务',
      prdSections: [{ heading: '背景', text: 'PRD 背景' }],
      prdDocumentName: 'prd.md',
      knowledgePicks: [knowledge('k1', { trigger: { mode: 'always' } })],
      includeDeps: true,
    })
    expect(text).toContain('[工作包]')
    expect(text).toContain('WP1　导出队列')
    expect(text).toContain('边界：做队列；不做存储')
    expect(text).toContain('依赖：WP2')
    expect(text).toContain('覆盖标准：\n- C1 十万行导出 30 秒内完成')
    expect(text).toContain('### 已批准计划\n1. 建任务表\n2. 起异步任务')
    expect(text).toContain('依赖工作包摘要：\n- WP2 存储层 · 只做表结构')
    expect(text).toContain('[PRD 节选]\n文档：prd.md\n\n## 背景\nPRD 背景')
    expect(text).toContain('[知识注入]\n### 知识-k1\n（触发：always）\n内容-k1')
    expect(text).toContain('```yaml\n# skyaxis-declare\nworkPackage: WP1\nclaims:\n  - built: true\n# artifacts 条目形如（type: sql|config|flag|mq|other）：\n#   - type: sql\n#     title: 标题（64 字内）\n#     content: |\n#       SQL 或配置值（多行用块状写法）\n#     envs: [prod]\nartifacts: []\n# knowledge 条目形如（type: business|convention）：\n#   - type: convention\n#     title: 标题\n#     draft: 内容\nknowledge: []\nstageReady: false\n```')
    // 回传轮回归锚（逐字不动 + 不染提议键）。
    expect(text).not.toContain('criteria:')
    expect(text).not.toContain('findings 每条')
  })

  it('dev 语境无已批准计划：占位行；includeDeps 缺省不产依赖摘要', () => {
    const target = wp('WP1', { title: '导出队列', dependsOn: ['WP2'], covers: [], status: 'plan-draft' })
    const text = buildSow({
      ...baseCtx,
      purpose: 'dev',
      record: record({ stage: 'implement', workPackages: [target, wp('WP2', { title: '存储层', order: 2 })] }),
      workPackage: target,
    })
    expect(text).toContain('（尚无已批准计划）')
    expect(text).not.toContain('依赖工作包摘要')
    expect(text).toContain('覆盖标准：无')
  })

  it('PRD 段（五段路径，dev 语境）：文档行 + 章节（preamble 用「开篇」）；无选中章节仅（未选择）', () => {
    const devBase = { ...baseCtx, purpose: 'dev' as const, record: record({ stage: 'implement', workPackages: [wp('WP1')] }), workPackage: wp('WP1') }
    const withPrd = buildSow({
      ...devBase,
      prdSections: [{ heading: '', text: '开篇正文' }, { heading: '背景', text: 'PRD 背景' }],
      prdDocumentName: 'prd.md',
    })
    expect(withPrd).toContain('[PRD 节选]\n文档：prd.md\n\n## 开篇\n开篇正文\n\n## 背景\nPRD 背景')

    const without = buildSow(devBase)
    expect(without).toContain('[PRD 节选]\n（未选择）')
    expect(without).not.toContain('文档：')
  })

  it('知识段（analysis 参考知识头）：逐条 title/触发/content；空选（无）', () => {
    const withKnowledge = buildSow({
      ...baseCtx,
      knowledgePicks: [
        knowledge('k1', { trigger: { mode: 'always' } }),
        knowledge('k2', { trigger: { mode: 'keyword', value: '导出' } }),
      ],
    })
    expect(withKnowledge).toContain('## 参考知识（工作台注入，已审定）\n### 知识-k1\n（触发：always）\n内容-k1')
    expect(withKnowledge).toContain('### 知识-k2\n（触发：keyword）\n内容-k2')

    expect(buildSow(baseCtx)).toContain('## 参考知识（工作台注入，已审定）\n（无）')
    expect(buildSow(baseCtx)).not.toContain('[知识注入]')
  })

  it('revision 戳收尾（0009 收窄为 dev/review 五段路径专属）：revision 数 + generatedAt 日期部分', () => {
    const text = buildSow({ ...baseCtx, purpose: 'dev', record: record({ stage: 'implement', workPackages: [wp('WP1')] }), revision: 7, generatedAt: '2026-09-29T12:34:56.789Z' })
    expect(text.endsWith('生成于 revision 7 · 2026-09-29 · 此后账本变更不自动同步')).toBe(true)
  })
})
