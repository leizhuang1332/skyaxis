/**
 * SOW 纯函数（0006 P2；analysis 重设计 = research 0008）：splitPrdSections
 * （ATX 切分 / preamble 归一 / 空文）+ matchKnowledge（always 全 / keyword
 * 大小写命中 / manual 列出不命中标记 / archived 排除 / path 不列）+
 * knowledgeBytes（UTF-8 逐条求和）+ buildSow：analysis 九节新骨架（目标/
 * 快照/输入路径引用/参考知识/约束/工作流/输出，PRD 正文零嵌入）与
 * split/dev/review 五段旧路径（criteria 清单、dev 全段两态、declare 骨架
 * workPackage 键、revision 戳）分派并存。
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
    // declare 骨架逐字 pin（解析面零改动的回归锚）。
    expect(text).toContain('```yaml\n# skyaxis-declare\n# knowledge 条目形如（type: business|convention）：\n#   - type: convention\n#     title: 标题\n#     draft: 内容\nknowledge: []\nstageReady: false\n```')
    expect(text).not.toContain('workPackage:')
    expect(text).not.toContain('claims:')
    // 约束/工作流/输出的关键纪律短语在场（只读、不裁决、F/A 编号、六类、完成自检）。
    for (const phrase of ['严格只读', '不裁决', '有限停止', '先查后问', 'F1 [类别·级别] 标题', 'A1 一句可判定的话', '六类逐类给过结论', '完成自检（全部满足才算收尾）']) {
      expect(text).toContain(phrase)
    }
  })

  it('analysis 输入段：PRD 路径引用 + 重点章节指针 + 仓库行（池名/分支）+ 缺失容错指令；正文零嵌入', () => {
    const text = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\quote' },
      analysisPrdDocs: [
        { name: 'prd.md', sizeBytes: 12 * 1024 + 300 },
        { name: 'notes.md', sizeBytes: 4096 },
      ],
      prdDocumentName: 'prd.md',
      prdSections: [{ heading: '背景', text: '背景正文全文' }, { heading: '', text: '开篇正文' }, { heading: '容量', text: '容量正文' }],
      analysisRepos: [{ dirName: 'order-center-a1b2', poolName: 'order-center', branch: 'feat/export' }],
    })
    expect(text).toContain('工作区根目录：C:/ws/quote（下列相对路径以此为根）')
    expect(text).toContain('- 必读 prds/prd.md（12.3 KB）——重点章节：背景、开篇、容量；其余章节按需')
    expect(text).toContain('- 按需 prds/notes.md（4.0 KB）')
    expect(text).toContain('- 必读 repos/order-center-a1b2（order-center，分支 feat/export）——与需求相关的模块与现有实现')
    expect(text).toContain('路径不存在或不可读：停下来在「待澄清」中报告——不要假设内容，不要自行创建替代文件。')
    // 路径引用的本体断言：PRD 章节正文一个字都不进任务书。
    expect(text).not.toContain('背景正文全文')
    expect(text).not.toContain('开篇正文')
    expect(text).not.toContain('容量正文')
  })

  it('analysis 输入段诚实缺席：工作区未绑定 / 无 PRD 文档 / 无仓库 / 目录名不可得计数行', () => {
    const unbound = buildSow(baseCtx)
    expect(unbound).toContain('（工作区未绑定——无 PRD 与仓库可引用，分析只能基于需求描述）')
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
  })

  it('split 语境：工作包状态快照（id+title+中文状态+raw status）+ 验收标准清单', () => {
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
    expect(text).toContain('当前阶段：探索规划')
    expect(text).toContain('WP1 导出队列 · 已验收（accepted）')
    expect(text).toContain('WP2 存储层 · 已登记（planned）')
    expect(text).toContain('C1 十万行导出 30 秒内完成')
    expect(text).toContain('C2 导出任务可取消')
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

  it('revision 戳收尾：revision 数 + generatedAt 日期部分', () => {
    const text = buildSow({ ...baseCtx, revision: 7, generatedAt: '2026-09-29T12:34:56.789Z' })
    expect(text.endsWith('生成于 revision 7 · 2026-09-29 · 此后账本变更不自动同步')).toBe(true)
  })
})
