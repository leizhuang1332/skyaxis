/**
 * parseReposFile totality (decision 0004 / D3): the migration entry point is
 * a TOTAL function — arbitrary garbage degrades with a reason instead of
 * throwing, because a zod 4 transform that throws propagates straight out of
 * safeParse and would pierce ReposFileStore.load()'s never-throws contract.
 */
import { describe, expect, it } from 'vitest'
import { parseReposFile } from '../../src/repos-pool-host/migrate.js'

describe('parseReposFile: total function over arbitrary input', () => {
  it('degrades (never throws) on non-document garbage', () => {
    for (const garbage of [null, undefined, 42, 'version: 1', [], [1, 2, 3], true]) {
      const result = parseReposFile(garbage)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('schema')
    }
  })

  it('degrades on non-scalar version values and documents the value', () => {
    const nested = parseReposFile({ version: { deep: true }, revision: 0, repos: [] })
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.detail).toContain('未知版本')

    const arrayVersion = parseReposFile({ version: [2], revision: 0, repos: [] })
    expect(arrayVersion.ok).toBe(false)
  })

  it('accepts a minimal valid v2 document', () => {
    const ok = parseReposFile({
      version: 2,
      revision: 5,
      repos: [{ id: '11111111-1111-4111-8111-111111111111', name: 'x', urlHttp: 'https://example.com/x.git', description: '', statusHttp: 'verified', validatedAtHttp: null, lastErrorHttp: null }],
    })
    expect(ok.ok).toBe(true)
  })

  it('treats YAML-null optional fields as absent keys (hand-edited `urlSsh:` means "no ssh address")', () => {
    const ok = parseReposFile({
      version: 2,
      revision: 0,
      repos: [{ id: '11111111-1111-4111-8111-111111111111', name: 'x', urlSsh: null, urlHttp: 'https://example.com/x.git', description: '', statusHttp: 'unverified', validatedAtHttp: null, lastErrorHttp: null }],
    })
    expect(ok.ok).toBe(true)
  })

  it('rejects a state quadruple without its url slot (schema-level invariant)', () => {
    const bad = parseReposFile({
      version: 2,
      revision: 0,
      repos: [{ id: '11111111-1111-4111-8111-111111111111', name: 'x', urlHttp: 'https://example.com/x.git', description: '', statusSsh: 'verified', validatedAtSsh: null, lastErrorSsh: null }],
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.detail).toContain('statusSsh')
  })
})
