/**
 * Workbench artifact-path pure functions (0006 P1b): the frozen layout
 * template joins, the layer-2 assertion gates (bad ids / versions /
 * timestamps all throw with the layer-2 marker) and the no-dot-dot escape
 * guarantee. Pure node string joining — no jsdom, no filesystem: these
 * functions must never observe the disk to do their job.
 */
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planDocPath, requirementArtifactDir, reviewDocPath, trashDirName } from '../../src/workbench-host/artifact-path.js'

const ROOT = '/data/dsh/skyaxis/workbench'
// Hex letters on purpose: the uppercase-rejection case below needs a
// toUpperCase() that actually changes the string.
const REQ = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

/** Every produced path is segments under root — a '..' segment is an escape. */
function expectNoDotDot(out: string): void {
  expect(out.split(sep).includes('..')).toBe(false)
}

/** Every gate rejection is a layer-2 defense Error with the field named. */
function expectLayer2Throw(run: () => unknown): void {
  expect(run).toThrowError(/artifact-path: .* rejected .*defense layer 2/)
}

describe('frozen layout template v1 (joins, expectation computed via path.join — never a hardcoded separator)', () => {
  it('planDocPath → <root>/<req>/plans/<M#>-v<n>.md', () => {
    const out = planDocPath(ROOT, REQ, 'WP3', 12)
    expect(out).toBe(join(ROOT, REQ, 'plans', 'WP3-v12.md'))
    expect(out.startsWith(join(ROOT, REQ))).toBe(true)
    expectNoDotDot(out)
  })

  it('reviewDocPath → <root>/<req>/reviews/<reviewId>.md', () => {
    const out = reviewDocPath(ROOT, REQ, '9f2c1a44-dead-4bee-8f0f-5c5c5c5c5c5c')
    expect(out).toBe(join(ROOT, REQ, 'reviews', '9f2c1a44-dead-4bee-8f0f-5c5c5c5c5c5c.md'))
    expectNoDotDot(out)
  })

  it('requirementArtifactDir → <root>/<req>', () => {
    const out = requirementArtifactDir(ROOT, REQ)
    expect(out).toBe(join(ROOT, REQ))
    expectNoDotDot(out)
  })

  it('guard-edge boundaries are accepted (WP1, version 1, 64-char reviewId)', () => {
    const edge64 = 'r'.repeat(64)
    expect(planDocPath(ROOT, REQ, 'WP1', 1)).toBe(join(ROOT, REQ, 'plans', 'WP1-v1.md'))
    expect(reviewDocPath(ROOT, REQ, edge64)).toBe(join(ROOT, REQ, 'reviews', `${edge64}.md`))
  })
})

describe('layer-2 gates: bad workPackageId (protocol isWorkPackageId re-asserted)', () => {
  it('lowercase, leading zero, zero, bare M and trailing junk all throw', () => {
    for (const bad of ['wp1', 'WP0', 'WP01', 'WP', 'WP1x']) {
      expectLayer2Throw(() => planDocPath(ROOT, REQ, bad, 1))
    }
  })
})

describe('layer-2 gates: bad version (protocol isPlanVersion re-asserted)', () => {
  it('zero, negative, fractional, NaN and Infinity all throw', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectLayer2Throw(() => planDocPath(ROOT, REQ, 'WP1', bad))
    }
  })
})

describe('layer-2 gates: bad reviewId (protocol isReviewId re-asserted)', () => {
  it('over 64 chars, dot-bearing, empty and slash-bearing all throw', () => {
    for (const bad of ['r'.repeat(65), 'a.b', '', 'a/b', '../escape']) {
      expectLayer2Throw(() => reviewDocPath(ROOT, REQ, bad))
    }
  })
})

describe('layer-2 gates: bad requirementId (lowercase uuid, host randomUUID shape)', () => {
  it('uppercase, missing segment and empty all throw', () => {
    for (const bad of [REQ.toUpperCase(), '11111111-1111-4111-8111111111111111', '']) {
      expectLayer2Throw(() => requirementArtifactDir(ROOT, bad))
    }
  })

  it('the error names the field and the layer-2 rationale', () => {
    expect(() => planDocPath(ROOT, REQ.toUpperCase(), 'WP1', 1))
      .toThrowError(/^artifact-path: requirementId rejected \(not a lowercase uuid\).*细化②/)
  })
})

describe('trashDirName (D6 cascade directory NAME)', () => {
  it('folds ISO colons to dashes, length-preserving', () => {
    const iso = '2026-09-29T12:34:56.789Z'
    const out = trashDirName(REQ, iso)
    expect(out).toBe(`${REQ}-2026-09-29T12-34-56.789Z`)
    expect(out).not.toContain(':')
    expect(out.length).toBe(REQ.length + 1 + iso.length) // ':' → '-' is 1:1
  })

  it('non-timestamp shapes throw on the prefix gate', () => {
    for (const bad of ['not-a-timestamp', '2026-9-9T12:00:00Z', '2026-09-29X12:00:00Z', '']) {
      expectLayer2Throw(() => trashDirName(REQ, bad))
    }
  })

  it('Windows-illegal or control characters past the prefix throw after folding', () => {
    for (const bad of ['2026-09-29T12:00:00Z\\..\\x', '2026-09-29T12:00:00Z|rm', '2026-09-29T12:00:00\u0007Z']) {
      expectLayer2Throw(() => trashDirName(REQ, bad))
    }
  })
})

describe('no escape: traversal inputs are intercepted before any join', () => {
  it("'..' and dot-slash segments cannot ride in on any variable segment", () => {
    expectLayer2Throw(() => planDocPath(ROOT, '..', 'WP1', 1)) // requirementId gate
    expectLayer2Throw(() => planDocPath(ROOT, REQ, '..', 1)) // workPackageId gate
    expectLayer2Throw(() => planDocPath(ROOT, REQ, 'WP1/../WP2', 1)) // workPackageId charset
    expectLayer2Throw(() => planDocPath(ROOT, '../..', 'WP1', 1))
    expectLayer2Throw(() => reviewDocPath(ROOT, REQ, '..')) // reviewId charset (no '.')
    expectLayer2Throw(() => reviewDocPath(ROOT, '..', 'ok-review'))
    expectLayer2Throw(() => requirementArtifactDir(ROOT, '../sibling'))
    expectLayer2Throw(() => trashDirName('..', '2026-09-29T12:00:00Z'))
  })
})
