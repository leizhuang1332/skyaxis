/**
 * review-parse 纯函数矩阵（P5b）：findMarkerFence 经 review marker 定位 +
 * parseReviewFindings（无块 → no-review-block 咨询 / 行内逗号非法 → yaml-syntax
 * 带行号 / 注释空块 → 零 findings / findings 逐条校验：bad-shape·bad-severity·
 * bad-title·over-cap / title trim / severity 枚举）。风格照 declare-parse.test.ts。
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
    expect(parseReviewFindings(fence('# skyaxis-review\n# 只有注释'))).toEqual({ ok: true, findings: [], skipped: [] })
    expect(parseReviewFindings(fence('# skyaxis-review\nsummary: 一切良好'))).toEqual({ ok: true, findings: [], skipped: [] })
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
})
