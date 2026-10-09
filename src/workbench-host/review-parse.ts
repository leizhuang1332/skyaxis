/**
 * Review convention block parsing (P5b) — pure, no IO. The mirror of
 * declare-parse.ts for the `# skyaxis-review` marker, but with a KEY
 * semantic difference that shapes the whole route:
 *
 *   declare: no block ⇒ nothing imports (the block IS the payload).
 *   review:  no block ⇒ the report STILL imports (it is free-form markdown);
 *            only the seeded verdict rows depend on the block. So a missing
 *            or unparseable block is ADVISORY here, never blocking — it maps
 *            to `reviewBlockError` on the write response, and the report is
 *            created with `verdicts: []`.
 *
 * Each `findings:` row seeds one proposed verdict (host-minted uuid, verdict
 * 'proposed' — the AI-proposal state a client can never write). Bad rows are
 * SKIPPED with a closed-enum reason, never truncated (truncation is a silent
 * data edit; a skip is an honest refusal — and an over-length title written
 * to the ledger would poison the whole workbench.yaml on next load, the
 * nextReleaseItemId lesson).
 *
 * The fence helpers are shared (./fence.ts) so the column-0 / closed-only /
 * last-wins invariants and the language-neutral linePos extraction are the
 * same code the declare parser runs.
 */
import YAML from 'yaml'
import type { ReviewSkipReason, ReviewVerdict } from '../workbench-shared/protocol.js'
import { asString, errorLine, findMarkerFence, isRecord, rowLabel } from './fence.js'

const REVIEW_MARKER = '# skyaxis-review'
const SEVERITIES: readonly string[] = ['high', 'medium', 'low']

/** One finding the caller may seed as a proposed verdict. */
export interface ReviewFinding {
  readonly title: string
  readonly severity: ReviewVerdict['severity']
}

export interface ReviewParseSuccess {
  ok: true
  findings: readonly ReviewFinding[]
  skipped: ReadonlyArray<{ key: string; label: string; reason: ReviewSkipReason }>
}

export interface ReviewParseBlockError {
  ok: false
  blockError: 'no-review-block' | 'yaml-syntax'
  blockErrorLine?: number
}

export type ReviewParseResult = ReviewParseSuccess | ReviewParseBlockError

/**
 * Parse the review convention block out of a report body. `text` is the whole
 * assistant message / pasted markdown; the fence is located inside it. A
 * missing fence is a blockError the CALLER treats as advisory (report still
 * imports) — unlike declare, where it aborts.
 */
export function parseReviewFindings(text: string): ReviewParseResult {
  const fence = findMarkerFence(text, REVIEW_MARKER)
  if (fence === null) return { ok: false, blockError: 'no-review-block' }

  let document: unknown
  try {
    document = YAML.parse(fence)
  } catch (error) {
    return { ok: false, blockError: 'yaml-syntax', ...(errorLine(error) !== undefined ? { blockErrorLine: errorLine(error) } : {}) }
  }
  // A comment-only / empty block parses to null — zero findings, not an error.
  const doc = isRecord(document) ? document : {}

  const findings: ReviewFinding[] = []
  const skipped: Array<{ key: string; label: string; reason: ReviewSkipReason }> = []
  const rows = Array.isArray(doc.findings) ? doc.findings : []
  rows.forEach((row, index) => {
    const key = `finding-${index}`
    if (!isRecord(row)) {
      skipped.push({ key, label: rowLabel(row), reason: 'bad-shape' })
      return
    }
    const severity = asString(row.severity)
    if (severity === undefined || !SEVERITIES.includes(severity)) {
      skipped.push({ key, label: rowLabel(row), reason: 'bad-severity' })
      return
    }
    const title = asString(row.title)?.trim()
    if (title === undefined || title.length === 0) {
      skipped.push({ key, label: rowLabel(row), reason: 'bad-title' })
      return
    }
    if (title.length > 64) {
      // Over the ReviewVerdictSchema title cap — skip, never truncate (a
      // truncated title is a silent data edit; an over-long one poisons the
      // ledger on next load).
      skipped.push({ key, label: rowLabel(row), reason: 'over-cap' })
      return
    }
    findings.push({ title, severity: severity as ReviewVerdict['severity'] })
  })

  return { ok: true, findings, skipped }
}
