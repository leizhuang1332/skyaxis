/**
 * Import pipeline pure functions (decision 0004 / D5+D6, with the P2 plan's
 * adversarial-review amendments): shape normalization (three document shapes,
 * dual spellings, v1 minimal rows) and the merge matrix (four rules, seven
 * skip reasons, accumulating view, change detection = slot ∪ description).
 */
import { describe, expect, it } from 'vitest'
import type { RepoRecord } from '../../src/repos-pool-shared/protocol.js'
import { isRepoRecord } from '../../src/repos-pool-shared/protocol.js'
import { mergeImportEntries, normalizeImportEntries, type ImportEntry } from '../../src/repos-pool-host/import.js'

function poolRecord(overrides: Partial<Record<'id' | 'name' | 'urlSsh' | 'urlHttp' | 'statusSsh' | 'statusHttp' | 'description', string>>): RepoRecord {
  const record = {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    name: overrides.name ?? 'alpha',
    description: overrides.description ?? '',
    ...(overrides.urlSsh !== undefined
      ? { urlSsh: overrides.urlSsh, statusSsh: overrides.statusSsh ?? 'verified', validatedAtSsh: '2026-09-24T09:30:00.000Z', lastErrorSsh: null }
      : {}),
    ...(overrides.urlHttp !== undefined
      ? { urlHttp: overrides.urlHttp, statusHttp: overrides.statusHttp ?? 'verified', validatedAtHttp: '2026-09-24T09:30:00.000Z', lastErrorHttp: null }
      : {}),
  } as RepoRecord
  return record
}

const FIXED_ID = () => '22222222-2222-4222-8222-222222222222'

describe('normalizeImportEntries: document shapes', () => {
  it('accepts a JSON entry array with kebab-case keys (the required json format)', () => {
    const result = normalizeImportEntries([
      { name: 'yl-jms-spmibill-cal-api', 'url-ssh': 'ssh://git@code.jms.com:2222/ylspm/cal-api.git', 'url-http': 'http://code.jms.com/ylspm/cal-api.git' },
      { name: 'solo', 'url-http': 'https://example.com/solo.git' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([
      { name: 'yl-jms-spmibill-cal-api', urlSsh: 'ssh://git@code.jms.com:2222/ylspm/cal-api.git', urlHttp: 'http://code.jms.com/ylspm/cal-api.git' },
      { name: 'solo', urlHttp: 'https://example.com/solo.git' },
    ])
    expect(result.skipped).toEqual([])
  })

  it('accepts camelCase spellings and mixed kebab/camel per row (same-slot spellings must agree)', () => {
    const result = normalizeImportEntries([
      { name: 'a', urlSsh: 'git@github.com:org/a.git' },
      { name: 'b', 'url-http': 'https://example.com/b.git', urlHttp: 'https://example.com/b.git' },
      { name: 'c', 'url-http': 'https://example.com/c1.git', urlHttp: 'https://example.com/c2.git' }, // disagreeing spellings
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map((e) => e.name)).toEqual(['a', 'b'])
    expect(result.skipped).toEqual([{ name: 'c', reason: 'slot-conflict', detail: expect.any(String) }])
  })

  it('accepts a full repos.yaml-style document, header ignored, v1 and v2 rows mixed', () => {
    const result = normalizeImportEntries({
      version: 1,
      revision: 42,
      repos: [
        // v2 row: slot keys taken, id/state quadruples ignored
        { id: '00000000-0000-4000-8000-000000000000', name: 'v2-row', urlSsh: 'git@github.com:org/v2.git', statusSsh: 'verified', validatedAtSsh: '2026-01-01T00:00:00.000Z', lastErrorSsh: null, description: 'kept' },
        // v1 row (string url key): re-slotted by value, minimal hand-written form works
        { name: 'v1-minimal', url: 'https://example.com/minimal.git' },
        // v1 row with state: state is NOT carried
        { id: '00000000-0000-4000-8000-000000000001', name: 'v1-full', url: 'ssh://git@code.jms.com:2222/ylspm/full.git', description: '', status: 'forced-auth', validatedAt: '2026-02-02T00:00:00.000Z', lastError: 'x' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([
      { name: 'v2-row', urlSsh: 'git@github.com:org/v2.git', description: 'kept' },
      { name: 'v1-minimal', urlHttp: 'https://example.com/minimal.git' },
      { name: 'v1-full', urlSsh: 'ssh://git@code.jms.com:2222/ylspm/full.git' },
    ])
    expect(result.skipped).toEqual([])
  })

  it('rejects whole documents that are not entry arrays or repos files', () => {
    for (const garbage of ['hello', 42, null, true, { version: 2 }, { repos: 'x' }, { repos: null }]) {
      const result = normalizeImportEntries(garbage)
      expect(result).toEqual({ ok: false, rejected: true })
    }
  })

  it('skips rows with unusable names / descriptions / no addresses, non-object rows included', () => {
    const result = normalizeImportEntries([
      42, // non-object row → invalid-name, reported name ''
      { 'url-http': 'https://example.com/anon.git' }, // name missing
      { name: '   ', 'url-http': 'https://example.com/blank.git' }, // name blank after trim
      { name: 'x'.repeat(65), 'url-http': 'https://example.com/long.git' }, // name over 64, reported capped
      { name: 'no-address' }, // both addresses absent
      { name: 'blank-address', 'url-ssh': '   ' }, // blank address value = not provided
      { name: 'long-desc', 'url-http': 'https://example.com/d.git', description: 'y'.repeat(2001) },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([])
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'invalid-name', 'invalid-name', 'invalid-name', 'invalid-name', 'empty-urls', 'empty-urls', 'invalid-description',
    ])
    expect(result.skipped[3].name).toBe('x'.repeat(64)) // capped, not the full 65
    expect(result.skipped[0].name).toBe('')
  })

  it('skips a v1 row whose url fails syntax, with the rejection reason', () => {
    const result = normalizeImportEntries([{ name: 'bad', url: 'file:///srv/git/repo.git' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([{ name: 'bad', reason: 'invalid-url', detail: 'scheme-forbidden' }])
  })
})

describe('mergeImportEntries: the D6 matrix', () => {
  it('rule 1 — creates missing names with the explicit three-key unverified quadruple and the imported description', () => {
    const outcome = mergeImportEntries([], [
      { name: 'new', urlSsh: 'git@github.com:org/new.git', urlHttp: 'https://github.com/org/new.git', description: 'from file' },
    ], { mintId: FIXED_ID })
    expect(outcome.created).toBe(1)
    expect(outcome.updated).toBe(0)
    expect(outcome.unchanged).toBe(0)
    expect(outcome.nextRepos).toEqual([{
      id: '22222222-2222-4222-8222-222222222222',
      name: 'new',
      description: 'from file',
      urlSsh: 'git@github.com:org/new.git',
      statusSsh: 'unverified',
      validatedAtSsh: null,
      lastErrorSsh: null,
      urlHttp: 'https://github.com/org/new.git',
      statusHttp: 'unverified',
      validatedAtHttp: null,
      lastErrorHttp: null,
    }])
    // Quadruple is byte-identical to save-route output: the assembled record
    // passes the browser guard (no double bricking).
    expect(outcome.nextRepos.every(isRepoRecord)).toBe(true)
  })

  it('rule 2 — fills an absent slot with unverified while the other slot keeps its verified quadruple', () => {
    const current = [poolRecord({ name: 'dual-candidate', urlHttp: 'https://example.com/dc.git' })]
    const outcome = mergeImportEntries(current, [{ name: 'dual-candidate', urlSsh: 'git@github.com:org/dc.git' }])
    expect(outcome.updated).toBe(1)
    const merged = outcome.nextRepos[0]
    expect(merged.urlSsh).toBe('git@github.com:org/dc.git')
    expect(merged.statusSsh).toBe('unverified')
    expect(merged.validatedAtSsh).toBeNull()
    expect(merged.statusHttp).toBe('verified') // untouched
    expect(merged.validatedAtHttp).toBe('2026-09-24T09:30:00.000Z')
  })

  it('rule 3 — overwrites a changed slot and resets only that slot\'s quadruple', () => {
    const current = [poolRecord({ name: 'both', urlSsh: 'git@github.com:org/old.git', urlHttp: 'https://example.com/old.git' })]
    const outcome = mergeImportEntries(current, [{ name: 'both', urlSsh: 'git@github.com:org/new.git' }])
    expect(outcome.updated).toBe(1)
    const merged = outcome.nextRepos[0]
    expect(merged.urlSsh).toBe('git@github.com:org/new.git')
    expect(merged.statusSsh).toBe('unverified')
    expect(merged.validatedAtSsh).toBeNull()
    expect(merged.urlHttp).toBe('https://example.com/old.git')
    expect(merged.statusHttp).toBe('verified')
  })

  it('rule 4 — an absent slot field never touches the stored value', () => {
    const current = [poolRecord({ name: 'keep', urlHttp: 'https://example.com/keep.git', description: 'precious' })]
    const outcome = mergeImportEntries(current, [{ name: 'keep', urlSsh: 'git@github.com:org/keep.git' }])
    const merged = outcome.nextRepos[0]
    expect(merged.urlHttp).toBe('https://example.com/keep.git')
    expect(merged.description).toBe('precious')
  })

  it('value-identical rows are unchanged (re-importing the same file must not write)', () => {
    const current = [poolRecord({ name: 'same', urlHttp: 'https://example.com/same.git', description: 'd' })]
    const outcome = mergeImportEntries(current, [
      { name: 'same', urlHttp: 'https://example.com/same.git', description: 'd' },
    ])
    expect(outcome.unchanged).toBe(1)
    expect(outcome.created).toBe(0)
    expect(outcome.updated).toBe(0)
  })

  it('description-only change counts as updated (change detection = slot ∪ description)', () => {
    const current = [poolRecord({ name: 'doc-only', urlHttp: 'https://example.com/do.git', description: 'old' })]
    const outcome = mergeImportEntries(current, [{ name: 'doc-only', urlHttp: 'https://example.com/do.git', description: 'new' }])
    expect(outcome.updated).toBe(1)
    expect(outcome.nextRepos[0].description).toBe('new')
  })

  it('slots by value regardless of the entry\'s field, and same-family collisions skip as slot-conflict', () => {
    // http value in the ssh field → lands in the http slot.
    const okOutcome = mergeImportEntries([], [{ name: 'relocate', urlSsh: 'https://example.com/relocate.git' }], { mintId: FIXED_ID })
    expect(okOutcome.nextRepos[0].urlHttp).toBe('https://example.com/relocate.git')
    expect(okOutcome.nextRepos[0].urlSsh).toBeUndefined()
    // two http-family values fighting for the http slot → skipped.
    const conflict = mergeImportEntries([], [{ name: 'clash', urlSsh: 'https://example.com/a.git', urlHttp: 'https://example.com/b.git' }])
    expect(conflict.created).toBe(0)
    expect(conflict.skipped).toEqual([{ name: 'clash', reason: 'slot-conflict', detail: expect.any(String) }])
  })

  it('duplicates: hits a different-name record (stored or batch-minted); same-name identical values are NOT duplicates', () => {
    const current = [poolRecord({ name: 'alpha', urlHttp: 'https://example.com/alpha.git' })]
    const outcome = mergeImportEntries(current, [
      { name: 'beta', urlHttp: 'https://example.com/alpha.git' }, // stored record, different name
      { name: 'gamma', urlSsh: 'git@github.com:org/gamma.git' }, // minted…
      { name: 'delta', urlSsh: 'git@github.com:org/gamma.git' }, // …clashes the batch-minted record
      { name: 'alpha', urlHttp: 'https://example.com/alpha.git' }, // same name, same value → no-op, not a self-duplicate
    ])
    expect(outcome.skipped.filter((s) => s.reason === 'duplicate-url').map((s) => s.name)).toEqual(['beta', 'delta'])
    expect(outcome.unchanged).toBe(1) // the alpha row
    expect(outcome.created).toBe(1) // gamma
    expect(outcome.nextRepos.map((r) => r.name)).toEqual(['alpha', 'gamma'])
  })

  it('ambiguous-name: two stored records sharing the name → skipped, neither touched', () => {
    const current = [
      poolRecord({ id: '11111111-1111-4111-8111-111111111111', name: 'twin', urlHttp: 'https://example.com/twin1.git' }),
      poolRecord({ id: '12121212-1212-4122-8122-121212121212', name: 'twin', urlHttp: 'https://example.com/twin2.git' }),
    ]
    const outcome = mergeImportEntries(current, [{ name: 'twin', urlSsh: 'git@github.com:org/twin.git' }])
    expect(outcome.skipped).toEqual([{ name: 'twin', reason: 'ambiguous-name' }])
    expect(outcome.nextRepos).toHaveLength(2)
    expect(outcome.nextRepos[0].urlSsh).toBeUndefined()
  })

  it('same-batch same-name rows apply in order: the second updates the first\'s result', () => {
    const outcome = mergeImportEntries([], [
      { name: 'seq', urlHttp: 'https://example.com/seq1.git' },
      { name: 'seq', urlHttp: 'https://example.com/seq2.git' },
    ], { mintId: FIXED_ID })
    expect(outcome.created).toBe(1)
    expect(outcome.updated).toBe(1)
    expect(outcome.nextRepos).toHaveLength(1)
    expect(outcome.nextRepos[0].urlHttp).toBe('https://example.com/seq2.git')
    expect(outcome.nextRepos[0].statusHttp).toBe('unverified')
  })

  it('merge re-runs syntax on every provided address (normalized output is not trusted)', () => {
    // Bypass normalize: an entry carrying an illegal address straight into merge.
    const smuggled: ImportEntry[] = [{ name: 'smuggled', urlHttp: 'file:///srv/git/x.git' }]
    const outcome = mergeImportEntries([], smuggled)
    expect(outcome.created).toBe(0)
    expect(outcome.skipped).toEqual([{ name: 'smuggled', reason: 'invalid-url', detail: 'scheme-forbidden' }])
  })

  it('report reconciles: created + updated + unchanged + skipped.length === entry count', () => {
    const current = [poolRecord({ name: 'alpha', urlHttp: 'https://example.com/alpha.git' })]
    const outcome = mergeImportEntries(current, [
      { name: 'alpha', urlHttp: 'https://example.com/alpha.git' }, // unchanged
      { name: 'alpha', urlHttp: 'https://example.com/alpha2.git' }, // updated
      { name: 'fresh', urlSsh: 'git@github.com:org/fresh.git' }, // created
      { name: 'nope' }, // normalize would skip; feed via merge with no addresses is impossible — count check below uses three
    ].filter((e) => e.urlSsh !== undefined || e.urlHttp !== undefined))
    expect(outcome.created + outcome.updated + outcome.unchanged + outcome.skipped.length).toBe(3)
  })
})
