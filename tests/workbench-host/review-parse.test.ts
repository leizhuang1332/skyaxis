/**
 * review-parse 纯函数矩阵（P5b）：findMarkerFence 经 review marker 定位 +
 * parseReviewFindings（无块 → no-review-block 咨询 / 行内逗号非法 → yaml-syntax
 * 带行号 / 注释空块 → 零 findings / findings 逐条校验：bad-shape·bad-severity·
 * bad-title·over-cap / title trim / severity 枚举）。风格照 declare-parse.test.ts。
 * 0023（decisions 0023 D2-A/D4-A）：findings 行 detail（可选证据，超 2000 整行
 * skip 复用 over-cap）＋ criteriaChecks 节（ref/result 闭枚举/evidence；坏行
 * skip 三新原因 bad-check-shape·bad-check-result·check-over-cap）。
 */
import { describe, expect, it } from 'vitest'
import { parseReviewFindings } from '../../src/workbench-host/review-parse.js'

const fence = (body: string): string => `\`\`\`yaml\n${body}\n\`\`\``

const GOOD = [
  '# skyaxis-review',
  'findings:',
  '  - title: 导入与校验不在同一事务',
  '    severity: high',
  '  - title: 外部核价响应体可能为 null',
  '    severity: medium',
].join('\n')

describe('parseReviewFindings', () => {
  it('正常块：两条 findings（title trim + severity 枚举），零 skip', () => {
    const result = parseReviewFindings(`评审报告正文若干。\n\n${fence(GOOD)}`)
    expect(result).toEqual({
      ok: true,
      findings: [
        { title: '导入与校验不在同一事务', severity: 'high' },
        { title: '外部核价响应体可能为 null', severity: 'medium' },
      ],
      checks: [],
      skipped: [],
    })
  })

  it('无 review 块 → blockError no-review-block（咨询位：报告照建，仅不种子）', () => {
    expect(parseReviewFindings('一段没有约定块的评审 markdown')).toEqual({ ok: false, blockError: 'no-review-block' })
    // declare 块不算 review 块（marker 不同）
    expect(parseReviewFindings(fence('# skyaxis-declare\nclaims:\n  - built: true'))).toEqual({ ok: false, blockError: 'no-review-block' })
  })

  it('行内逗号非法形 → yaml-syntax 带行号（语言中立，不回显库消息）', () => {
    const bad = fence(['# skyaxis-review', 'findings:', '  - title: x, severity: high'].join('\n'))
    const result = parseReviewFindings(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockError).toBe('yaml-syntax')
    expect(result.blockErrorLine).toBe(3)
  })

  it('注释空块 / 无 findings 键 → 零 findings（不是错误）', () => {
    expect(parseReviewFindings(fence('# skyaxis-review\n# 只有注释'))).toEqual({ ok: true, findings: [], checks: [], skipped: [] })
    expect(parseReviewFindings(fence('# skyaxis-review\nsummary: 一切良好'))).toEqual({ ok: true, findings: [], checks: [], skipped: [] })
  })

  it('逐条 skip：bad-shape / bad-severity / bad-title（空与超 64）', () => {
    const result = parseReviewFindings(fence([
      '# skyaxis-review',
      'findings:',
      '  - 纯字符串',                                    // bad-shape
      '  - title: 合法标题',                              // bad-severity（缺 severity）
      '    severity: critical',
      '  - title: ""',                                    // bad-title（空）
      '    severity: low',
      `  - title: ${'x'.repeat(65)}`,                     // over-cap（>64）
      '    severity: low',
      '  - title: 好行',                                  // 唯一好行
      '    severity: low',
    ].join('\n')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped.map((s) => s.reason)).toEqual(['bad-shape', 'bad-severity', 'bad-title', 'over-cap'])
    expect(result.findings).toEqual([{ title: '好行', severity: 'low' }])
    // skip 带稳定 key 与尽力 label
    expect(result.skipped[0]).toEqual({ key: 'finding-0', label: '', reason: 'bad-shape' })
    expect(result.skipped[1]?.label).toBe('合法标题')
  })

  it('title 前后空白 trim 后落 findings（长度判定在 trim 之后）', () => {
    const result = parseReviewFindings(fence(['# skyaxis-review', 'findings:', '  - title: "  两侧有空格  "', '    severity: high'].join('\n')))
    expect(result.ok && result.findings).toEqual([{ title: '两侧有空格', severity: 'high' }])
  })

  // --- 0023 D4-A: findings detail（可选证据字段） ---

  it('detail：在场随行落 findings（trim），缺席合法（旧形行零字段），空串等同缺席', () => {
    const result = parseReviewFindings(fence([
      '# skyaxis-review',
      'findings:',
      '  - title: 带证据的发现',
      '    severity: high',
      '    detail: " src/a.ts:12 未判空 "',
      '  - title: 旧形无 detail',
      '    severity: low',
      '  - title: 空串 detail',
      '    severity: low',
      '    detail: ""',
    ].join('\n')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.findings).toEqual([
      { title: '带证据的发现', severity: 'high', detail: 'src/a.ts:12 未判空' },
      { title: '旧形无 detail', severity: 'low' },
      { title: '空串 detail', severity: 'low' },
    ])
  })

  it('detail 超 2000 → 整行 skip（over-cap，截断是静默数据编辑）', () => {
    const result = parseReviewFindings(fence([
      '# skyaxis-review',
      'findings:',
      '  - title: 证据超长的发现',
      '    severity: low',
      `    detail: ${'x'.repeat(2001)}`,
    ].join('\n')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.findings).toEqual([])
    expect(result.skipped.map((row) => row.reason)).toEqual(['over-cap'])
  })

  // --- 0023 D2-A: criteriaChecks 节（逐条核验结构化承载） ---

  it('criteriaChecks：三值 result 逐条落 checks（evidence 可选），节缺席 → 零 checks 非错误', () => {
    const withChecks = parseReviewFindings(fence([
      '# skyaxis-review',
      'criteriaChecks:',
      '  - ref: C1',
      '    result: satisfied',
      '    evidence: src/a.ts:30-42',
      '  - ref: C2',
      '    result: unmet',
      "    evidence: 需人工在浏览器验证",
      '  - ref: C3',
      '    result: not-verifiable',
      'findings:',
      '  - title: C2 相关缺陷',
      '    severity: high',
    ].join('\n')))
    expect(withChecks.ok).toBe(true)
    if (!withChecks.ok) return
    expect(withChecks.checks).toEqual([
      { ref: 'C1', result: 'satisfied', evidence: 'src/a.ts:30-42' },
      { ref: 'C2', result: 'unmet', evidence: '需人工在浏览器验证' },
      { ref: 'C3', result: 'not-verifiable' },
    ])
    expect(withChecks.findings).toEqual([{ title: 'C2 相关缺陷', severity: 'high' }])
    // 节缺席（旧形块）＝零 checks，不是错误——字段演化纪律的解析侧
    const legacy = parseReviewFindings(fence(GOOD))
    expect(legacy.ok && legacy.checks).toEqual([])
  })

  it('criteriaChecks 坏行 skip：bad-check-shape（非记录/空 ref）· bad-check-result（闭枚举外）· check-over-cap（ref 超 64 / evidence 超 2000）', () => {
    const result = parseReviewFindings(fence([
      '# skyaxis-review',
      'criteriaChecks:',
      '  - 纯字符串',                                     // bad-check-shape
      '  - ref: ""',                                      // bad-check-shape（空 ref）
      '    result: satisfied',
      `  - ref: ${'C'.repeat(65)}`,                       // check-over-cap（ref > 64）
      '    result: satisfied',
      '  - ref: C1',
      '    result: maybe',                                // bad-check-result
      '  - ref: C2',
      '    result: satisfied',
      `    evidence: ${'x'.repeat(2001)}`,                 // check-over-cap（evidence > 2000）
      '  - ref: C3',                                      // 唯一好行（无 evidence）
      '    result: unmet',
    ].join('\n')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped.map((row) => row.reason)).toEqual([
      'bad-check-shape', 'bad-check-shape', 'check-over-cap', 'bad-check-result', 'check-over-cap',
    ])
    expect(result.checks).toEqual([{ ref: 'C3', result: 'unmet' }])
    expect(result.skipped[0]).toEqual({ key: 'criteria-check-0', label: '', reason: 'bad-check-shape' })
  })
})
