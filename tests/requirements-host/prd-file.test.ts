import { describe, expect, it } from 'vitest'
import { PRD_NAME_MAX_CHARS, sanitizePrdFileName } from '../../src/requirements-shared/prd-file.js'

describe('sanitizePrdFileName', () => {
  it('strips path-hostile characters and control chars', () => {
    expect(sanitizePrdFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(sanitizePrdFileName('bad\u0000name')).toBe('badname')
  })

  it('collapses dot-only and whitespace-only names to empty', () => {
    expect(sanitizePrdFileName('..')).toBe('')
    expect(sanitizePrdFileName('.md')).toBe('md')
    expect(sanitizePrdFileName('   ')).toBe('')
    expect(sanitizePrdFileName('///')).toBe('')
  })

  it('keeps interior dots and spaces, trims edges and trailing dots', () => {
    expect(sanitizePrdFileName('my.notes v1.md')).toBe('my.notes v1.md')
    expect(sanitizePrdFileName('  report.md  ')).toBe('report.md')
    expect(sanitizePrdFileName('report.md.')).toBe('report.md')
  })

  it('rejects Windows reserved names', () => {
    expect(sanitizePrdFileName('CON')).toBe('')
    expect(sanitizePrdFileName('com1.md')).toBe('')
    expect(sanitizePrdFileName('console.md')).toBe('console.md')
  })

  it('truncates overlong names keeping a short trailing extension', () => {
    const long = 'a'.repeat(200)
    const out = sanitizePrdFileName(`${long}.md`)
    expect(out.length).toBe(PRD_NAME_MAX_CHARS)
    expect(out.endsWith('.md')).toBe(true)
    const noExt = sanitizePrdFileName(long)
    expect(noExt.length).toBe(PRD_NAME_MAX_CHARS)
  })

  it('is idempotent for legal names (the read/delete traversal guard relies on it)', () => {
    for (const legal of ['需求方案.md', 'v1.2.md', 'my notes.txt', 'a'.repeat(128)]) {
      expect(sanitizePrdFileName(legal)).toBe(legal)
    }
    expect(sanitizePrdFileName('../requirements.yaml')).not.toBe('../requirements.yaml')
    // Traversal is neutralized to a harmless name — the guard is the
    // sanitize(name) !== name comparison, not emptiness.
    expect(sanitizePrdFileName('..\\..\\evil')).toBe('evil')
  })
})
