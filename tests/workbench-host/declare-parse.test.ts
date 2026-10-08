/**
 * declare-parse 纯函数矩阵（P3b）：findDeclareFence（无标记 / 多块取最后 /
 * 未闭合不提取 / 缩进非列 0 不提取 / 裸块体兜底 / ```yaml info 串）+
 * parseDeclare（整块两错 no-declare-block / yaml-syntax 带行号——行内逗号
 * 形即 research §7.1 非法示例的复现 / 注释空块 = 空成功 / 块级 workPackage
 * 三态：缺失·有效·无效 / 八种逐条 skip / duplicate 咨询位 / stageReady
 * 只认 === true / 未知顶层键忽略）。
 */
import { describe, expect, it } from 'vitest'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import { findDeclareFence, parseDeclare } from '../../src/workbench-host/declare-parse.js'
import { contentHashOf } from '../../src/workbench-host/artifact-store.js'

const RID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-29T09:30:00.000Z'

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'implement',
    stageHistory: [{ stage: 'implement', at: NOW }],
    criteria: [],
    findings: [],
    workPackages: [{
      id: 'WP1', title: 'WP1', boundary: '', order: 1, dependsOn: [], covers: [],
      status: 'in-dev', plans: [], sessions: [], commits: [], acceptances: [],
    }],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    splitApprovedAt: NOW,
    ...overrides,
  }
}

const fence = (body: string): string => `\`\`\`yaml\n${body}\n\`\`\``
const GOOD_BLOCK = [
  '# skyaxis-declare',
  'workPackage: WP1',
  'claims:',
  '  - built: true',
  'artifacts:',
  '  - type: sql',
  '    title: t_order 加索引',
  '    content: |',
  '      ALTER TABLE t_order ADD INDEX i(c)',
  '    envs: [prod, pre]',
  'knowledge:',
  '  - type: convention',
  '    title: 导出走异步',
  '    draft: 大表导出禁止一次全量拉取',
  'stageReady: false',
].join('\n')

describe('findDeclareFence', () => {
  it('无标记 → null；非 declare 的 fence 不算', () => {
    expect(findDeclareFence('普通正文\n```yaml\nfoo: bar\n```')).toBeNull()
    expect(findDeclareFence('没有任何围栏')).toBeNull()
  })

  it('多块取最后；未闭合不提取；缩进（非列 0）不提取', () => {
    const two = fence('# skyaxis-declare\na: 1') + '\n中间正文\n' + fence('# skyaxis-declare\nb: 2')
    expect(findDeclareFence(two)).toBe('# skyaxis-declare\nb: 2\n')
    expect(findDeclareFence('```yaml\n# skyaxis-declare\ntrunc')).toBeNull()
    expect(findDeclareFence('正文：\n  ```yaml\n  # skyaxis-declare\n  a: 1\n  ```')).toBeNull()
  })

  it('裸块体兜底（fetch 通道返回的形态）与 ```yaml info 串', () => {
    expect(findDeclareFence('# skyaxis-declare\na: 1')).toBe('# skyaxis-declare\na: 1\n')
    expect(findDeclareFence('```\n# skyaxis-declare\na: 1\n```')).toBe('# skyaxis-declare\na: 1\n')
  })
})

describe('parseDeclare：整块面', () => {
  it('无声明块 → blockError no-declare-block', () => {
    expect(parseDeclare({ text: 'AI 的总结陈词，没有声明块', record: record() }))
      .toEqual({ ok: false, blockError: 'no-declare-block' })
  })

  it('行内逗号非法形（research §7.1 原示例）→ yaml-syntax 带行号', () => {
    const bad = fence(['# skyaxis-declare', 'workPackage: WP1', 'artifacts:', '  - type: sql, title: "加索引", content: "ALTER"'].join('\n'))
    const result = parseDeclare({ text: bad, record: record() })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockError).toBe('yaml-syntax')
    expect(result.blockErrorLine).toBe(4)
  })

  it('注释空块 → 空成功（不是错误）', () => {
    const result = parseDeclare({ text: fence('# skyaxis-declare\n# 只有注释'), record: record() })
    expect(result).toEqual({ ok: true, entries: [], skipped: [], stageReady: false })
  })

  it('未知顶层键忽略；stageReady 只认 === true', () => {
    const doc = fence(['# skyaxis-declare', 'unknownKey: whatever', 'stageReady: "true"'].join('\n'))
    const stringly = parseDeclare({ text: doc, record: record() })
    expect(stringly.ok && stringly.stageReady).toBe(false)
    const docTrue = fence(['# skyaxis-declare', 'stageReady: true'].join('\n'))
    const boolean = parseDeclare({ text: docTrue, record: record() })
    expect(boolean.ok && boolean.stageReady).toBe(true)
  })
})

describe('parseDeclare：块级 workPackage 三态', () => {
  it('有效：built 入 entries、artifact 带 workPackageId', () => {
    const result = parseDeclare({ text: fence(GOOD_BLOCK), record: record() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toHaveLength(3)
    expect(result.entries[0]).toEqual({ kind: 'built', key: 'built-0', workPackageId: 'WP1' })
    expect(result.entries[1]).toMatchObject({ kind: 'artifact', key: 'artifact-0', workPackageId: 'WP1', envs: ['prod', 'pre'] })
    expect(result.entries[2]).toMatchObject({ kind: 'knowledge', key: 'knowledge-0' })
    expect(result.skipped).toEqual([])
  })

  it('缺失：built → bad-shape（无目标），artifact 照常导入（无归属）', () => {
    const noScope = GOOD_BLOCK.replace('workPackage: WP1\n', '')
    const result = parseDeclare({ text: fence(noScope), record: record() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ key: 'built-0', label: '', reason: 'bad-shape' }])
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]?.kind).toBe('artifact')
    expect((result.entries[0] as { workPackageId?: string }).workPackageId).toBeUndefined()
  })

  it('无效：built 与 artifact 都 → wp-not-found', () => {
    const bad = GOOD_BLOCK.replace('workPackage: WP1', 'workPackage: WP9')
    const result = parseDeclare({ text: fence(bad), record: record() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([
      { key: 'built-0', label: 'WP9', reason: 'wp-not-found' },
      { key: 'artifact-0', label: 't_order 加索引', reason: 'wp-not-found' },
    ])
    expect(result.entries).toHaveLength(1) // knowledge 不受块级作用域影响
  })

  it('WP 非 in-dev 或 split 未批 → built → wp-not-in-dev（两因同码）', () => {
    for (const overrides of [{ workPackages: undefined }, { splitApprovedAt: undefined }] as const) {
      const base = overrides.workPackages === undefined
        ? record({ workPackages: [{ id: 'WP1', title: 'WP1', boundary: '', order: 1, dependsOn: [], covers: [], status: 'planned', plans: [], sessions: [], commits: [], acceptances: [] }] })
        : record({ ...overrides } as Partial<WorkbenchRecord>)
      const result = parseDeclare({ text: fence(GOOD_BLOCK), record: base })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.skipped).toContainEqual({ key: 'built-0', label: 'WP1', reason: 'wp-not-in-dev' })
    }
  })
})

describe('parseDeclare：逐条 skip 与 duplicate', () => {
  const parseArtifacts = (rows: string, base = record()) => parseDeclare({
    text: fence(['# skyaxis-declare', 'artifacts:', rows].join('\n')),
    record: base,
  })

  it('bad-shape / bad-type / bad-title / bad-content / bad-envs', () => {
    const result = parseArtifacts([
      '  - 纯字符串',                                     // bad-shape
      '  - type: redis',                                  // bad-type
      '  - type: sql',                                    // bad-title（缺 title）
      '    content: x',
      '  - type: sql',                                    // bad-content（缺 content）
      '    title: 有题无内容',
      '  - type: sql',                                    // bad-envs（非数组）
      '    title: envs 非数组',
      '    content: x',
      '    envs: prod',
    ].join('\n'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped.map((s) => s.reason)).toEqual(['bad-shape', 'bad-type', 'bad-title', 'bad-content', 'bad-envs'])
    expect(result.skipped[2]?.label).toBe('')            // 无 title 可读 → 空 label
    expect(result.skipped[3]?.label).toBe('有题无内容')   // title 可读 → 作 label
  })

  it('over-cap：content 超 32K 单源上限 → skip', () => {
    const big = 'x'.repeat(32 * 1024 + 1)
    const result = parseArtifacts(`  - type: sql\n    title: 超限\n    content: ${big}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ key: 'artifact-0', label: '超限', reason: 'over-cap' }])
  })

  it('bad-title 另一面：空白与超 64 字；bad-envs 另一面：空串与超 64 字', () => {
    const result = parseArtifacts([
      '  - type: sql',
      '    title: "  "',
      '    content: x',
    ].join('\n'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped[0]?.reason).toBe('bad-title')
    const longEnv = parseArtifacts('  - type: sql\n    title: t\n    content: x\n    envs: ["' + 'e'.repeat(65) + '"]')
    expect(longEnv.ok && longEnv.skipped[0]?.reason).toBe('bad-envs')
  })

  it('duplicate 咨询位：artifact 按 (type,title,contentHash)、knowledge 按 (title,type,draft) 比对既有账', () => {
    const content = 'ALTER TABLE t ADD i(c)'
    const base = record({
      releaseItems: [{
        id: 'R0001', type: 'sql', title: 't 加索引', content,
        contentHash: contentHashOf(content), envs: ['prod'], status: 'confirmed',
      }],
      knowledgeCandidates: [{
        id: 'c1', title: '导出走异步', draft: '大表导出禁止一次全量拉取', type: 'convention', at: NOW, status: 'pending',
      }],
    })
    const result = parseDeclare({
      text: fence(['# skyaxis-declare', 'artifacts:', '  - type: sql', '    title: t 加索引', `    content: ${content}`, 'knowledge:', '  - type: convention', '    title: 导出走异步', '    draft: 大表导出禁止一次全量拉取'].join('\n')),
      record: base,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries[0]).toMatchObject({ kind: 'artifact', duplicate: true })   // 仍可导入（修正流）
    expect(result.entries[1]).toMatchObject({ kind: 'knowledge', duplicate: true })
    // 非重复路径
    const fresh = parseDeclare({ text: fence(GOOD_BLOCK), record: record() })
    expect(fresh.ok && fresh.entries.every((entry) => entry.kind === 'built' || entry.duplicate === false)).toBe(true)
  })
})
