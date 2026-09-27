/**
 * PRD file-name sanitation and limits (P3c).
 *
 * Pure zero-dependency functions/constants — the browser bundle inlines this
 * file, and both halves import the same source (host validates writes, the
 * client pre-checks sizes): one truth for what lands in `prds/`.
 *
 * The sanitizer is IDEMPOTENT by construction (sanitize(x) === x for any
 * already-legal name) — the read/delete guards rely on that property to
 * reject traversal like `../requirements.yaml` (sanitize mutates it, so it
 * no longer equals the requested name).
 */

/** Hard cap on a stored file name (after sanitation). */
export const PRD_NAME_MAX_CHARS = 128
/** Streaming upload byte cap (host counts bytes itself; no framework cap). */
export const PRD_UPLOAD_MAX_BYTES = 32 * 1024 * 1024
/** Create-body cap in UTF-16 code units (NOT bytes — CJK names get ~3× bytes). */
export const PRD_CREATE_MAX_CHARS = 512 * 1024
/** Preview read cap — MarkdownText freezes on multi-MB documents. */
export const PRD_READ_MAX_BYTES = 1024 * 1024

const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/g
/** Windows reserved base names (compared lower-case, no extension logic). */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** Returns '' for an unusable name; legal names pass through unchanged. */
export function sanitizePrdFileName(raw: string): string {
  let name = raw.replaceAll(ILLEGAL, '').trim()
  // Leading dots make hidden files ('.md' → 'md', '..' → ''); trailing dots
  // and spaces upset Windows.
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (name.length === 0) return ''
  const dot = name.indexOf('.')
  if (WINDOWS_RESERVED.has((dot === -1 ? name : name.slice(0, dot)).toLowerCase())) return ''
  if (name.length <= PRD_NAME_MAX_CHARS) return name
  // Overlong: keep a trailing extension (≤32 chars) and truncate the stem.
  const lastDot = name.lastIndexOf('.')
  const ext = lastDot === -1 || name.length - lastDot > 32 ? '' : name.slice(lastDot)
  const stem = name.slice(0, PRD_NAME_MAX_CHARS - ext.length)
  return stem.replace(/[.\s]+$/, '') + ext
}
