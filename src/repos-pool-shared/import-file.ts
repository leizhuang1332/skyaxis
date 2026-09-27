/**
 * Import file limits, shared by both halves (the requirements prd-file.ts
 * precedent — one source of truth for the host cap and the browser precheck).
 *
 * Zero dependencies by the shared-bundle rule.
 */

/**
 * Import content cap, in UTF-16 code units (content.length) — what the host
 * endpoint enforces with 413. Browsers must check this AFTER reading the
 * text (file.size is bytes, not code units).
 */
export const IMPORT_MAX_CONTENT_CHARS = 2_000_000

/**
 * Browser-side coarse BYTE precheck before reading a picked file into
 * memory. Bytes ≥ code units for any realistic encoding, so this never
 * rejects a file the host would accept on code units alone; the wide margin
 * keeps CJK-heavy files (3 bytes/char in UTF-8) from being falsely rejected
 * by a tight byte cap.
 */
export const IMPORT_PRECHECK_MAX_BYTES = 8 * 1024 * 1024
