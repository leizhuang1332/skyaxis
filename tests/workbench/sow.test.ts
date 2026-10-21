/**
 * SOW 纯函数（0006 P2；analysis 重设计 = research 0008；0009 任务书精简轮；
 * 0015 工作包/评审 PRD 勾选退役轮）：matchKnowledge（always 全 / keyword
 * 大小写命中 / manual 列出不命中标记 / archived 排除 / path 不列）+
 * knowledgeBytes（UTF-8 逐条求和）+ buildSow 三形态分派：analysis/split/
 * consolidate/plan 九节骨架与 dev/review 五段路径（0015：[PRD 节选] 嵌入段
 * 与 prdSections/splitPrdSections 整体退役——dev/review 改挂 [输入] 块，基线
 * 文档必读行 + repos 行，账本快照照旧嵌入；criteria 清单、dev 全段两态、
 * declare 骨架 workPackage 键、revision 戳保留）。
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
import { DEV_SOW_TITLE_WP_RE, buildReworkMessage, buildSow, globToRegExp, knowledgeBytes, matchKnowledge } from '../../src/client/workbench/sow.js'

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
    expect(text.startsWith('# 分析任务书 · 导出功能改造\n')).toBe(true)
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
      analysisRepos: [{ dirName: 'order-center-a1b2', poolName: 'order-center', branch: 'feat/export' }],
    })
    expect(text).toContain('工作区根目录：C:/ws/quote（下列相对路径以此为根）')
    expect(text).toContain('- 必读 prds/prd.md（12.3 KB）')
    expect(text).toContain('- 必读 prds/notes.md（4.0 KB）')
    expect(text).not.toContain('按需 prds/')
    expect(text).not.toContain('重点章节')
    expect(text).toContain('- 必读 repos/order-center-a1b2（order-center，分支 feat/export）——与需求相关的模块与现有实现')
    expect(text).toContain('路径不存在或不可读：停下来在「待澄清」中报告——不要假设内容，不要自行创建替代文件。')
    // 路径引用的本体断言：PRD 正文一个字不进任务书（0015 起无嵌入面）。
    expect(text).not.toContain('[PRD 节选]')
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
    expect(text).toContain('# 拆分任务书 · 导出功能改造')
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
    // 0012 拆分结果文件通道：目标段改「自动收取为待登记提议」口径；unarmed（本 fixture 未绑工作区）
    // 保留会话内交付原话；declare 骨架升级为 split 专属（workPackages 提议键 + plain 面逐字复用）。
    expect(text).toContain('建议由工作台自动收取为「待登记提议」，需求负责人逐条裁决登记后再决定是否批准拆分')
    expect(text).toContain('拆分建议在会话内交付，不写文件')
    expect(text).toContain('```yaml\n# skyaxis-declare\n# workPackages 每条 = 工作包建议（ref 为建议序号 WP1/WP2…，仅供批内依赖互引；正式编号由工作台登记时分配）：\n#   - ref: WP1\n#     title: 标题（64 字内）\n#     boundary: 边界（做什么/不做什么）\n#     dependsOn: [WP2]   # 批内建议序号，或既有工作包编号\n#     parallel: true     # 可与其他包并行\n#     covers: [C1, C2]   # 覆盖的验收标准编号（基线文档验收标准节）\nworkPackages: []\n# knowledge 条目形如（type: business|convention）：\n#   - type: convention\n#     title: 标题\n#     draft: 内容\nknowledge: []\nstageReady: false\n```')
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
  })

  it('plan 九节（0012 两步化）：标题/目标/快照/输入（基线行「本次规划」措辞）/参考知识/约束/工作流/输出六节模板；无 declare 块、无 revision 戳', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'plan',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        stage: 'plan',
        criteria,
        understandApprovedAt: '2026-10-13T08:00:00.000Z',
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        planAdoptedAt: '2026-10-14T08:00:00.000Z',
        planBaseline: { at: AT, docHash: 'p'.repeat(64) },
        workPackages: [wp('WP1', { title: '导出队列' })],
      }),
    })
    expect(text).toContain('# 规划任务书 · 导出功能改造')
    expect(text).toContain('## 目标')
    expect(text).toContain('## 需求快照（工作台账本，生成时快照）')
    expect(text).toContain('## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(text).toContain('## 参考知识（工作台注入，已审定）')
    expect(text).toContain('## 约束')
    expect(text).toContain('## 工作流')
    expect(text).toContain('## 输出')
    // 输入段：基线必读行（plan 措辞）+ 无规划行（规划自己写规划文档，不读自己）。
    expect(text).toContain(`- 必读 .skyaxis/requirements/${RID}.md——需求基线文档，本次规划的唯一需求真源`)
    expect(text).not.toContain('必读 .skyaxis/planning/')
    // 快照：定稿状态行 + 已采纳规划状态行（重新规划语境）+ 工作包快照。
    expect(text).toContain('需求理解定稿：已定稿（2026-10-13）——理解阶段的裁决视为已定输入')
    expect(text).toContain('技术规划采纳：已采纳（')
    expect(text).toContain('- WP1 导出队列 · 已登记（planned）')
    // 约束：文件通道唯一例外（consolidate 形制）。
    expect(text).toContain('唯一例外：把技术规划文档写入「输出」节指定路径')
    // 输出：armed ⇒ 写 .skyaxis/planning/<rid>.md + 六节模板 + 自检尾句。
    expect(text).toContain(`路径：C:/ws/repo-a/.skyaxis/planning/${RID}.md`)
    expect(text).toContain('# 技术规划 · <需求标题>')
    expect(text).toContain('## 现状盘点')
    expect(text).toContain('## 技术方案')
    expect(text).toContain('## 改动面')
    expect(text).toContain('## 风险与开放问题')
    expect(text).toContain('## 实施顺序草案')
    expect(text).toContain('## 对拆分的建议原则')
    expect(text).toContain('文档已写入上述路径')
    // 整理任务书先例：无 declare 块、无戳。
    expect(text).not.toContain('skyaxis-declare')
    expect(text).not.toContain('此后账本变更不自动同步')
    // unarmed 双态：未绑定工作区 ⇒ 会话内交付警示。
    const unarmed = buildSow({ ...baseCtx, purpose: 'plan', record: record({ criteria }) })
    expect(unarmed).toContain('本需求未绑定工作区——无法指定规划文件路径，请在会话内交付文档全文')
    const noRecord = buildSow({ ...baseCtx, purpose: 'plan', record: null })
    expect(noRecord).toContain('（工作台记录未建立——尚无基线文档与裁决可用，规划只能基于需求描述）')
  })

  it('wp-plan 九节（0018 两步化）：头行带 WP 号/目标（批准后嵌入开发任务书）/快照（边界+依赖+覆盖标准+版本概要）/输入（基线行+已采纳规划行「本规划」措辞）/边界纪律明文/三节计划模板；无 declare 块、无 revision 戳', () => {
    const wp1 = wp('WP1', {
      title: '导出队列',
      boundary: '只做导出服务',
      covers: ['C1'],
      dependsOn: ['WP2'],
      plans: [{ version: 1, contentHash: 'a'.repeat(64), approvedAt: '2026-10-15T08:00:00.000Z' }],
    })
    const text = buildSow({
      ...baseCtx,
      purpose: 'wp-plan',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        stage: 'implement',
        splitApprovedAt: '2026-10-16T08:00:00.000Z',
        criteria,
        understandApprovedAt: '2026-10-13T08:00:00.000Z',
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        planAdoptedAt: '2026-10-14T08:00:00.000Z',
        planBaseline: { at: AT, docHash: 'p'.repeat(64) },
        workPackages: [wp1],
      }),
      workPackage: wp1,
    })
    // 头行：判别前缀 + WP 号（dev 头行先例）。
    expect(text.startsWith('# 工作包规划任务书 WP1 · 导出功能改造\n')).toBe(true)
    expect(text).toContain('## 目标')
    expect(text).toContain('## 需求快照（工作台账本，生成时快照）')
    expect(text).toContain('## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(text).toContain('## 参考知识（工作台注入，已审定）')
    expect(text).toContain('## 约束')
    expect(text).toContain('## 工作流')
    expect(text).toContain('## 输出')
    // 目标：批准/退回语义 + 嵌入开发任务书 + 不写码/不改边界。
    expect(text).toContain('负责人审阅后在「工作台」批准或退回（退回即重新生成本任务书再投递），已批准的计划将全文嵌入开发任务书')
    expect(text).toContain('本阶段不写任何实现代码')
    expect(text).toContain('不改边界——边界由拆分批准锁定')
    // 快照：定稿行 + 工作包块（边界/依赖/覆盖标准）+ 版本概要（重规划语境）。
    expect(text).toContain('需求理解定稿：已定稿（2026-10-13）')
    expect(text).toContain('边界：只做导出服务')
    expect(text).toContain('依赖：WP2')
    expect(text).toContain('- C1 十万行导出 30 秒内完成')
    expect(text).toContain('现有计划版本（重规划语境的参考')
    expect(text).toContain('- v1 已批准（2026-10-15）')
    // 输入段：基线必读行（本规划措辞）+ 已采纳规划必读行（分解服从方案）。
    expect(text).toContain(`- 必读 .skyaxis/requirements/${RID}.md——需求基线文档，本规划的唯一需求真源`)
    expect(text).toContain(`- 必读 .skyaxis/planning/${RID}.md——技术规划文档，本规划的方案真源（分解服从方案：任务与顺序以它为准`)
    // 约束：边界纪律明文（D5）+ 文件通道唯一例外。
    expect(text).toContain('- 边界纪律：任务分解必须在给定边界内——不改边界、不增删覆盖标准、不改依赖')
    expect(text).toContain('唯一例外：把工作包计划文件写入「输出」节指定路径')
    // 输出：armed ⇒ 写 .skyaxis/wps/WP1/plan.md + 三节模板 + 自检尾句。
    expect(text).toContain('路径：C:/ws/repo-a/.skyaxis/wps/WP1/plan.md')
    expect(text).toContain('# 工作包计划 · <WP 编号> <标题>')
    expect(text).toContain('## 任务分解')
    expect(text).toContain('## 测试安排')
    expect(text).toContain('## 风险与开放问题')
    expect(text).toContain('计划文件已写入上述路径')
    // 家族纪律：无 declare 块、无 revision 戳（plan purpose 先例 + 0010 D4）。
    expect(text).not.toContain('skyaxis-declare')
    expect(text).not.toContain('此后账本变更不自动同步')
  })

  it('wp-plan 诚实缺席：未采纳规划 ⇒ 诚实行（本次规划措辞）；未绑定工作区 ⇒ 未绑出行 + 会话内交付警示 + 只读约束无唯一例外；record null 降级', () => {
    // 已绑定工作区但未采纳规划 ⇒ 规划诚实行（wp-plan 措辞）。
    const bound = buildSow({ ...baseCtx, purpose: 'wp-plan', requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' }, record: record({ workPackages: [wp('WP2')] }), workPackage: wp('WP2') })
    expect(bound).toContain('（尚无已采纳的技术规划文档——本次规划以基线文档与仓库现状为方案依据')
    // 未绑定工作区 ⇒ 输入段未绑出行 + 输出段会话内交付警示；约束段无「唯一例外」。
    const unarmed = buildSow({ ...baseCtx, purpose: 'wp-plan', record: record({ workPackages: [wp('WP2')] }), workPackage: wp('WP2') })
    expect(unarmed).toContain('（工作区未绑定——无可引用的文档与仓库，规划只能基于需求描述）')
    expect(unarmed).toContain('（本需求未绑定工作区——无法指定计划文件路径，请在会话内交付计划全文，由用户手动录入计划草稿')
    expect(unarmed).not.toContain('唯一例外：')
    expect(unarmed).toContain('完成自检（全部满足才算收尾）：每步有产出与文件级落点')
    const noRecord = buildSow({ ...baseCtx, purpose: 'wp-plan', record: null })
    expect(noRecord).toContain('（工作台记录未建立）')
    expect(noRecord).toContain('# 工作包规划任务书 · 导出功能改造')
  })

  it('split 输入段规划行三态（0012）：已采纳带锚 ⇒ 必读 .skyaxis/planning/ 行；已采纳无锚 ⇒ 诚实行；未采纳 ⇒ 诚实行（依据账本不依据盘）', () => {
    const withWorkspace = { ...baseCtx, requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' } }
    const anchored = buildSow({
      ...withWorkspace,
      purpose: 'split',
      record: record({
        criteria,
        planAdoptedAt: '2026-10-14T08:00:00.000Z',
        planBaseline: { at: AT, docHash: 'p'.repeat(64), requirementDocHash: 'r'.repeat(64) },
      }),
    })
    expect(anchored).toContain(`- 必读 .skyaxis/planning/${RID}.md——技术规划文档，本拆分的方案真源`)
    const adoptedNoAnchor = buildSow({
      ...withWorkspace,
      purpose: 'split',
      record: record({ criteria, planAdoptedAt: '2026-10-14T08:00:00.000Z' }),
    })
    expect(adoptedNoAnchor).toContain('（技术规划已采纳但未锚定——采纳时工作区无此文档；本次拆分以基线文档与仓库现状为方案依据。）')
    const noAdoption = buildSow({ ...withWorkspace, purpose: 'split', record: record({ criteria }) })
    expect(noAdoption).toContain('（尚无已采纳的技术规划文档——本次拆分以基线文档与仓库现状为方案依据；若规划文档已生成，先在工作台采纳它，再重新生成本任务书。）')
  })

  it('split 文件交付（0012 armed）：工作区绑定的输出/约束翻转为结果文件通道（绝对路径 + 覆盖写 + 自检尾句）', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'split',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ criteria }),
    })
    expect(text).toContain('唯一例外：把拆分结果文件写入「输出」节指定路径')
    expect(text).toContain(`路径：C:/ws/repo-a/.skyaxis/split/${RID}.md`)
    expect(text).toContain('结果文件已写入上述路径')
    expect(text).not.toContain('拆分建议在会话内交付，不写文件')
  })

  it('consolidate 九节（0008）：标题/目标/快照/输入/参考知识/约束/工作流/输出 + 十节文档模板', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'consolidate',
      record: record({ criteria }),
    })
    expect(text).toContain('# 需求整理任务书 · 导出功能改造')
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

  it('dev 语境全段（approvedPlanText 有 + includeDeps）：输入段基线必读行 + 边界/依赖/覆盖标准/已批准计划/依赖摘要/dev declare', () => {
    const target = wp('WP1', {
      title: '导出队列',
      boundary: '做队列；不做存储',
      dependsOn: ['WP2'],
      covers: ['C1'],
      status: 'plan-approved',
    })
    const text = buildSow({
      ...baseCtx,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      purpose: 'dev',
      record: record({
        stage: 'implement',
        criteria,
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        workPackages: [target, wp('WP2', { title: '存储层', boundary: '只做表结构', order: 2 })],
      }),
      workPackage: target,
      approvedPlanText: '1. 建任务表\n2. 起异步任务',
      knowledgePicks: [knowledge('k1', { trigger: { mode: 'always' } })],
      includeDeps: true,
    })
    // 0015：[输入] 块顶替 [PRD 节选]——基线必读行（本工作包措辞）+ 仓库行；嵌入面退役。
    expect(text).toContain('[输入]（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(text).toContain(`- 必读 .skyaxis/requirements/${RID}.md——需求基线文档，本工作包的唯一需求真源`)
    expect(text).not.toContain('[PRD 节选]')
    expect(text).not.toContain('必读 prds/')
    expect(text).toContain('[工作包]')
    expect(text).toContain('WP1　导出队列')
    expect(text).toContain('边界：做队列；不做存储')
    expect(text).toContain('依赖：WP2')
    expect(text).toContain('覆盖标准：\n- C1 十万行导出 30 秒内完成')
    expect(text).toContain('### 已批准计划\n1. 建任务表\n2. 起异步任务')
    expect(text).toContain('依赖工作包摘要：\n- WP2 存储层 · 只做表结构')
    expect(text).toContain('[知识注入]\n### 知识-k1\n（触发：always）\n内容-k1')
    expect(text).toContain('workPackage: WP1')
    expect(text).toContain('claims:')
    expect(text).toContain('- built: true')
    expect(text).toContain('artifacts: []')
    expect(text).toContain('# summary:')
    expect(text).toContain('# verification')
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

  it('0015 dev/review 输入段（五段路径）：基线三态（必读行/定稿无锚/未定稿）+ repos 行；[PRD 节选] 与 prds/ 清单零出现', () => {
    const devBase = { ...baseCtx, purpose: 'dev' as const, record: record({ stage: 'implement', workPackages: [wp('WP1')] }), workPackage: wp('WP1') }
    const anchored = buildSow({
      ...devBase,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        stage: 'implement',
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        workPackages: [wp('WP1')],
      }),
      analysisRepos: [{ dirName: 'order-svc', poolName: '订单服务', branch: 'feat/export' }],
    })
    expect(anchored).toContain('- 必读 .skyaxis/requirements/11111111-1111-4111-8111-111111111111.md——需求基线文档，本工作包的唯一需求真源')
    expect(anchored).toContain('- 必读 repos/order-svc（订单服务，分支 feat/export）——与需求相关的模块与现有实现')
    expect(anchored).not.toContain('[PRD 节选]')
    expect(anchored).not.toContain('prds/')

    // 定稿无锚 ⇒ 诚实行（与 split 同一 0010 D2 形态）。
    const finalizedNoAnchor = buildSow({
      ...devBase,
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({ stage: 'implement', understandApprovedAt: AT, understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [] }, workPackages: [wp('WP1')] }),
    })
    expect(finalizedNoAnchor).toContain('（需求理解已定稿但未锚定基线文档——定稿时工作区无此文档；本次开发以需求描述为唯一需求依据。）')

    // 未定稿 ⇒ 诚实行；工作区未绑定 ⇒ 无可引用行。
    const notFinalized = buildSow({ ...devBase, requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' } })
    expect(notFinalized).toContain('（需求理解未定稿——尚无锚定的需求基线文档；本次开发以需求描述为唯一需求依据。）')
    const unbound = buildSow(devBase)
    expect(unbound).toContain('（工作区未绑定——无可引用的文档与仓库，开发只能基于需求描述）')

    // review 同形（0023 九块化后）：「本次评审」措辞；输入段头随家族形（## 输入）；
    // criteria 清单照旧嵌入（进快照节，评审对照面）。
    const reviewSow = buildSow({
      ...baseCtx,
      purpose: 'review',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        stage: 'review',
        criteria,
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
      }),
    })
    expect(reviewSow).toContain('- 必读 .skyaxis/requirements/11111111-1111-4111-8111-111111111111.md——需求基线文档，本次评审的唯一需求真源')
    expect(reviewSow).not.toContain('[PRD 节选]')
    expect(reviewSow).toContain('## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(reviewSow).not.toContain('[工作包]')
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

  it('0016 刀一验收修正：dev 头行带 WP 号（真实会话的 fallback 标题=寻址锚）；review 头行对齐家族形态', () => {
    const dev = buildSow({ ...baseCtx, purpose: 'dev', record: record({ stage: 'implement', workPackages: [wp('WP1')] }), workPackage: wp('WP1') })
    expect(dev.startsWith('# 工作包任务书 WP1 · 导出功能改造\n')).toBe(true)
    expect(dev).toContain('[需求]')
    // 词边界：WP1 的锚不匹配 WP10 的标题（正则 (?!\d)）
    expect(DEV_SOW_TITLE_WP_RE.test('# 工作包任务书 WP1 · 导出功能改造')).toBe(true)
    // 0021 渲染轮: 标题去品牌——matcher 双臂兼容旧形（在途会话，0018 存量修复先例）
    expect(DEV_SOW_TITLE_WP_RE.test('# skyaxis 工作包任务书 WP1 · 导出功能改造')).toBe(true)
    expect(DEV_SOW_TITLE_WP_RE.exec('# skyaxis 工作包任务书 WP10 · x')?.[1]).toBe('WP10')
    expect(DEV_SOW_TITLE_WP_RE.exec('# 工作包任务书 WP10 · x')?.[1]).toBe('WP10')
    expect(DEV_SOW_TITLE_WP_RE.test('# 评审任务书 · x')).toBe(false)
    expect(DEV_SOW_TITLE_WP_RE.test('# skyaxis 评审任务书 · x')).toBe(false)
    expect(DEV_SOW_TITLE_WP_RE.test('# 工作包规划任务书 WP1 · x')).toBe(false)
    const review = buildSow({ ...baseCtx, purpose: 'review', record: record({ stage: 'review', workPackages: [wp('WP1')] }) })
    expect(review.startsWith('# 评审任务书 · 导出功能改造\n')).toBe(true)
  })

  it('0019 D4-A：dev 任务书工作包节附返工历史（历轮不通过带理由/通过）；无验收记录零渲染（首投不扰）', () => {
    const reworked = wp('WP1', {
      acceptances: [
        { at: AT, result: 'fail', note: '越界改动 config.ts' },
        { at: AT, result: 'pass' },
        { at: AT, result: 'fail', note: '边界情况遗漏' },
      ],
    })
    const text = buildSow({ ...baseCtx, purpose: 'dev', record: record({ stage: 'implement', workPackages: [reworked] }), workPackage: reworked })
    expect(text).toContain('返工历史：')
    expect(text).toContain('- 第 1 轮 不通过：越界改动 config.ts')
    expect(text).toContain('- 第 2 轮 通过')
    expect(text).toContain('- 第 3 轮 不通过：边界情况遗漏')
    // 次序：返工历史在覆盖标准之后、已批准计划之前。
    expect(text.indexOf('覆盖标准')).toBeLessThan(text.indexOf('返工历史：'))

    const fresh = buildSow({ ...baseCtx, purpose: 'dev', record: record({ stage: 'implement', workPackages: [wp('WP1')] }), workPackage: wp('WP1') })
    expect(fresh).not.toContain('返工历史')
  })
  // --- 0023 评审方法论轮（decisions 0023 D1-D4）：review 九块化 ---

  it('0023 评审九节骨架：双目标目标节 + 六维判据工作流 + 只读/不运行约束 + 三节输出模板 + criteriaChecks/detail 机器骨架；无修订戳；五块头退役', () => {
    const text = buildSow({
      ...baseCtx,
      purpose: 'review',
      requirement: { ...requirement, workspacePath: 'C:\\ws\\repo-a' },
      record: record({
        stage: 'review',
        criteria,
        understandApprovedAt: AT,
        understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'a'.repeat(64) },
        workPackages: [wp('WP1', { status: 'built' })],
      }),
    })
    // 七节头逐节在场
    expect(text.startsWith('# 评审任务书 · 导出功能改造\n\n## 目标\n')).toBe(true)
    for (const section of ['## 需求快照（工作台账本，生成时快照）', '## 输入（用文件读取能力按路径阅读；不要凭记忆，不要猜）', '## 参考知识（工作台注入，已审定）', '## 约束', '## 工作流', '## 输出']) {
      expect(text).toContain(section)
    }
    // 双目标措辞（decisions 0023 拍板的两方向）
    expect(text).toContain('当前代码实现满足验收标准吗（需求完成情况）')
    expect(text).toContain('代码本身有没有缺陷、漏洞或显著风险（代码质量情况）')
    expect(text).toContain('满足 / 不满足 / 无法核验')
    // 六维逐维判据在场（D3-A）
    for (const dimension of ['- 缺陷：', '- 安全：', '- 性能与容量：', '- 复杂度与可维护性：', '- 测试：', '- 一致性：']) {
      expect(text).toContain(dimension)
    }
    expect(text).toContain('注入、输入校验、认证与会话、访问控制、敏感信息、加密误用')
    // 约束：只读 + 不运行（运行需求走无法核验通道）
    expect(text).toContain('不运行代码、测试或构建')
    // 输出：三节模板 + 级别判据 + 机器骨架（criteriaChecks + findings detail，D2-A/D4-A）
    expect(text).toContain('1. 总体结论')
    expect(text).toContain('2. 验收核验')
    expect(text).toContain('3. 质量发现')
    expect(text).toContain('（级别判据：')
    expect(text).toContain('# skyaxis-review')
    expect(text).toContain('criteriaChecks: []')
    expect(text).toContain('result: satisfied|unmet|not-verifiable')
    expect(text).toContain('detail: 说明与证据（路径:行号）')
    expect(text).toContain('完成自检')
    // 家族纪律：无修订戳（诚实锚=快照头生成时快照）；五块头全部退役
    expect(text).not.toContain('生成于 revision')
    expect(text).not.toContain('[需求]')
    expect(text).not.toContain('[知识注入]')
    expect(text).not.toContain('[输出约定]')
    expect(text).not.toContain('# skyaxis-declare')
  })

  it('0023 评审快照：criteria 清单在场（评审对照面）+ commits 改动面锚（短哈希+note）；零提交/零工作包诚实缺席行', () => {
    const withCommits = buildSow({
      ...baseCtx,
      purpose: 'review',
      record: record({
        stage: 'review',
        criteria,
        workPackages: [
          wp('WP1', { status: 'in-dev', commits: [{ hash: 'abcdef1234567890', note: '导出服务与取消端点', at: AT }] }),
          wp('WP2', { status: 'built', commits: [] }),
        ],
      }),
    })
    expect(withCommits).toContain('验收标准（你将逐条核验它们）：')
    expect(withCommits).toContain('- C1 十万行导出 30 秒内完成')
    expect(withCommits).toContain('- C2 导出任务可取消')
    expect(withCommits).toContain('- WP1 工作包-WP1 · 开发中（in-dev）')
    expect(withCommits).toContain('- 提交 abcdef1 导出服务与取消端点')
    expect(withCommits).toContain('（尚无已确认提交——该包改动面以其边界与基线文档描述为准）')
    // 零工作包 ⇒ 诚实缺席行（无悬挂头）
    const noWps = buildSow({ ...baseCtx, purpose: 'review', record: record({ stage: 'review', criteria, workPackages: [] }) })
    expect(noWps).toContain('（尚无工作包——改动面以基线文档与仓库现状为准）')
    // record null ⇒ 降级行
    const noRecord = buildSow({ ...baseCtx, purpose: 'review', record: null })
    expect(noRecord).toContain('（工作台记录未建立——无验收标准与工作包可核验，评审以质量发现为主）')
  })

  it('0023 dev 回归：五块路径不动（[需求]/[输入]/[知识注入]/[输出约定]/修订戳照旧，无六维与 criteria 清单）', () => {
    const dev = buildSow({ ...baseCtx, purpose: 'dev', record: record({ stage: 'implement', workPackages: [wp('WP1')] }), workPackage: wp('WP1') })
    expect(dev).toContain('[需求]')
    expect(dev).toContain('[输入]（用文件读取能力按路径阅读；不要凭记忆，不要猜）')
    expect(dev).toContain('[知识注入]')
    expect(dev).toContain('[输出约定]')
    expect(dev.endsWith('此后账本变更不自动同步')).toBe(true)
    expect(dev).not.toContain('criteriaChecks')
    expect(dev).not.toContain('六维质量排查')
  })
})

describe('buildReworkMessage（0019 D3-B 返工话组装）', () => {
  it('结构化组装：头行 + 第 n 轮验收未通过（n=acceptances.length）+ 尾 fail 理由 + 重吐声明块指令（re-seed 钩子）', () => {
    const target = wp('WP3', {
      title: '导出队列',
      acceptances: [
        { at: AT, result: 'pass' },
        { at: AT, result: 'fail', note: '十万行导出超时' },
      ],
    })
    const text = buildReworkMessage(target, '导出功能改造')
    expect(text.startsWith('# 返工话 WP3 · 导出功能改造\n')).toBe(true)
    expect(text).toContain('工作包 WP3 导出队列 验收未通过（第 2 轮验收）。')
    expect(text).toContain('返工理由：\n十万行导出超时')
    expect(text).toContain('完成后在回复末尾重新输出声明块（形制同任务书「输出约定」，workPackage: WP3），工作台会重新收取。')
  })

  it('防御面：无 acceptances ⇒ 轮数 0、理由空行，头行与指令照旧不崩', () => {
    const text = buildReworkMessage(wp('WP1'), '导出功能改造')
    expect(text).toContain('# 返工话 WP1 · 导出功能改造')
    expect(text).toContain('（第 0 轮验收）')
    expect(text).toContain('workPackage: WP1')
  })
})
