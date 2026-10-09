/**
 * 知识导出文档（P5a）：行节形态（## title + scope/path/type/触发 meta 行 +
 * 正文）、批量拼接、生成戳收尾。
 */
import { describe, expect, it } from 'vitest'
import type { WorkbenchKnowledgeRecord } from '../../src/workbench-shared/protocol.js'
import { buildKnowledgeDoc } from '../../src/client/workbench/knowledge-export.js'

const AT = '2026-09-29T08:00:00.000Z'

function row(id: string, overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
  return {
    id,
    scope: 'requirement',
    type: 'business',
    title: `知识-${id}`,
    content: `内容-${id}`,
    trigger: { mode: 'always' },
    status: 'active',
    provenance: { at: AT },
    ...overrides,
  }
}

describe('buildKnowledgeDoc', () => {
  it('行节：## title + meta（scope 中文 + path + type + 触发带值）+ 正文；戳收尾', () => {
    const doc = buildKnowledgeDoc([
      row('k1', { scope: 'workspace', path: 'C:/ws/quote', trigger: { mode: 'path', value: 'src/**' } }),
    ], '2026-10-09T01:02:03.000Z')
    expect(doc).toContain('## 知识-k1')
    expect(doc).toContain('scope 工作区 · path C:/ws/quote · type business · 触发 path: src/**')
    expect(doc).toContain('内容-k1')
    expect(doc.endsWith('导出于 skyaxis 知识库 · 2026-10-09 · 账本为真源，导出为分发')).toBe(true)
  })

  it('批量拼接与 requirement/global 两态 meta', () => {
    const doc = buildKnowledgeDoc([row('k1'), row('k2', { scope: 'global' })], '2026-10-09T00:00:00.000Z')
    expect(doc.indexOf('## 知识-k1')).toBeLessThan(doc.indexOf('## 知识-k2'))
    expect(doc).toContain('scope 本需求 · type business · 触发 always')
    expect(doc).toContain('scope 全局 · type business · 触发 always')
  })
})
