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

function collectFences(lines: readonly string[]): FenceBlock[] {
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
  // An unclosed fence at EOF is truncated output — dropped, not parsed.
  return blocks
}

/**
 * The LAST `marker`-headed fence body in `text`, or null. Bare bodies (the
 * marker line with no surrounding fence — a fetch path may hand back exactly
 * that shape) are accepted when the text itself starts with the marker. The
 * returned string keeps the marker line (it is a YAML comment) and a trailing
 * newline.
 */
export function findMarkerFence(text: string, marker: string): string | null {
  const blocks = collectFences(text.split(/\r?\n/))
  for (let index = blocks.length - 1; index >= 0; index--) {
    const body = blocks[index]!.body
    const first = body.find((line) => line.trim().length > 0)
    if (first !== undefined && first.trim() === marker) return [...body, ''].join('\n')
  }
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return firstLine === marker ? `${text}\n` : null
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
