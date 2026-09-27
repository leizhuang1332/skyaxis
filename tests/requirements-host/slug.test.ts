import { describe, expect, it } from 'vitest'
import { workspaceSlug } from '../../src/requirements-host/slug.js'

describe('workspaceSlug', () => {
  it('lower-cases, folds blanks to dashes and caps the length at 40', () => {
    expect(workspaceSlug('Support Multi Repo Search', 'id')).toBe('support-multi-repo-search')
    const long = 'a'.repeat(80)
    expect(workspaceSlug(long, 'id')).toHaveLength(40)
  })

  it('strips path and branch hostile characters and trims dangling dashes', () => {
    expect(workspaceSlug('  feat/branch: "quick" <fix>  ', 'id')).toBe('featbranch-quick-fix')
    expect(workspaceSlug('---dashes---', 'id')).toBe('dashes')
  })

  it('falls back to req-<id prefix> for unusable titles', () => {
    expect(workspaceSlug('', 'abcdef12-0000-4000-8000-000000000000')).toBe('req-abcdef12')
    expect(workspaceSlug('///', 'abcdef12-0000-4000-8000-000000000000')).toBe('req-abcdef12')
  })

  it('keeps CJK text untouched', () => {
    expect(workspaceSlug('需求管理 面板', 'id')).toBe('需求管理-面板')
  })
})
