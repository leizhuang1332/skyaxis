/**
 * Shared fenced-block + yaml-error helpers for the machine-readable convention
 * blocks (declare / review). Extracted from declare-parse.ts in P5b so the
 * review parser reuses them without a reverse dependency on the declare
 * parser — every helper here is marker-agnostic (pure text/shape work).
 *
 * The three invariants that make a convention block trustworthy are all here:
 *  - column-0 fences only (a convention block is top-level output, never a
 *    nested list item);
 *  - CLOSED fences only (a truncated/interrupted turn leaves the fence open
 *    and simply does not extract — no half-block ever parses);
 *  - the LAST marker fence wins (a later complete block supersedes an earlier
 *    truncated one;倒扫).
 */

/** One closed fenced block: body lines between the opening ``` (± info string) and the closing ```. */
interface FenceBlock {
  body: string[]
}

function collectFences(lines: readonly string[]): { blocks: FenceBlock[]; unclosed: FenceBlock | null } {
  const blocks: FenceBlock[] = []
  let body: string[] | null = null
  for (const line of lines) {
    if (body === null) {
      // Column-0 opening fence, optional info string (```yaml etc.).
      if (/^```[A-Za-z0-9_-]*\s*$/.test(line)) body = []
      continue
    }
    if (/^```\s*$/.test(line)) {
      blocks.push({ body })
      body = null
      continue
    }
    body.push(line)
  }
  // An unclosed fence at EOF — truncated output OR a mis-written closer
  // (```` ```yaml ```` used to close). The caller decides by the body's head.
  return { blocks, unclosed: body === null ? null : { body } }
}

/**
 * The LAST `marker`-headed fence body in `text`, or null. Bare bodies (the
 * marker line with no surrounding fence — a fetch path may hand back exactly
 * that shape) are accepted when the text itself starts with the marker. The
 * returned string keeps the marker line (it is a YAML comment) and a trailing
 * newline.
 *
 * 回传轮 policy change (二次诊断): an UNCLOSED marker-headed fence now
 * extracts its body-to-EOF instead of returning null. The P3b "no half-block
 * ever parses" rule assumed truncation = interrupted turn; the wild failure
 * behind this change was a FINISHED session whose closer line was mis-written
 * — and the whole batch was silently dropped. Seeding a half block is safe
 * here: bad rows skip at parse, the idempotency anchor hashes whatever was
 * extracted, and a later complete re-run replaces the batch (ruling ②). The
 * bare-tail fallback below covers the no-fence-at-all shape; column-0
 * EXACTLY is still required of the tail marker (an indented fence's marker
 * is not top-level output).
 */
export function findMarkerFence(text: string, marker: string): string | null {
  const lines = text.split(/\r?\n/)
  const { blocks, unclosed } = collectFences(lines)
  for (let index = blocks.length - 1; index >= 0; index--) {
    const body = blocks[index]!.body
    const first = body.find((line) => line.trim().length > 0)
    if (first !== undefined && first.trim() === marker) return [...body, ''].join('\n')
  }
  if (unclosed !== null) {
    const first = unclosed.body.find((line) => line.trim().length > 0)
    if (first !== undefined && first.trim() === marker) {
      // Trim trailing fence-marker lines (the mis-written closer itself —
      // ```yaml used to close — often sits at EOF) plus blank tails; prose
      // AFTER the pseudo-closer stays in and surfaces as yaml-syntax.
      let end = unclosed.body.length
      while (end > 0) {
        const tail = unclosed.body[end - 1]!
        if (/^```[A-Za-z0-9_-]*\s*$/.test(tail) || tail.trim().length === 0) end -= 1
        else break
      }
      return [...unclosed.body.slice(0, end), ''].join('\n')
    }
  }
  const firstLine = lines[0]?.trim() ?? ''
  if (firstLine === marker) return `${text}\n`
  for (let index = lines.length - 1; index >= 0; index--) {
    // Column-0 EXACT match (trailing whitespace tolerated) — the indented
    // fence case above must not double as a tail hit.
    if (lines[index]!.replace(/[ \t]+$/, '') === marker) {
      // A bare marker line alone extracts nothing beyond itself — require at
      // least one following line so a stray mention is not a block.
      if (index === lines.length - 1) return null
      return `${lines.slice(index).join('\n')}\n`
    }
  }
  return null
}

/** Yaml errors carry linePos[{line}] — extracted language-neutrally, never the raw message. */
export function errorLine(error: unknown): number | undefined {
  const linePos = (error as { linePos?: Array<{ line?: unknown }> } | null)?.linePos
  const line = Array.isArray(linePos) ? linePos[0]?.line : undefined
  return typeof line === 'number' ? line : undefined
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Best-effort label for a skipped row: its title when readable, else empty (the key still identifies it). */
export function rowLabel(row: unknown): string {
  const title = asString(isRecord(row) ? row.title : undefined)?.trim()
  return title !== undefined && title.length > 0 ? title.slice(0, 64) : ''
}
