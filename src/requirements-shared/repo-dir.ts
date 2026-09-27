/**
 * Clone destination directory name derived from the pool repo name (P3b).
 *
 * Pure string function, zero dependencies (safe to inline into the browser
 * bundle). NOT lower-cased on purpose — the directory should read like the
 * pool registration. The pool's name field has NO charset constraint (trim +
 * length only), so path-hostile characters must be stripped here. Host (clone
 * destination) and client (reveal-in-file-manager) import the same function —
 * one source of truth, byte-identical on both halves.
 */

const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/g
const DASH_RUN = /-+/g

export function repoDirName(repoName: string, fallbackSeed: string): string {
  const dir = repoName
    .replaceAll(ILLEGAL, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .replaceAll(DASH_RUN, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  if (dir.length > 0) return dir
  return `repo-${fallbackSeed.slice(0, 8)}`
}
