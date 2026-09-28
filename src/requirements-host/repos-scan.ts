/**
 * repos/ directory scanning (reverse-link discovery): read-only filesystem
 * facts per subdirectory — is it a git repo, its checked-out branch, its
 * origin url. Pure node:fs, deliberately NO subprocess (a scan must never
 * depend on git being installed) and NO repos.yaml access (the 0002 boundary
 * — which dir belongs to which pool repo is a client-side join).
 *
 * Every read is best-effort and size-capped: an unreadable fact is an absent
 * fact, never a failed scan. The .git resolution follows the
 * worktree/submodule case (a .git FILE carrying "gitdir: <path>") exactly one
 * hop — a pointing file is git's own encoding, not user input.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { RepoDirScanRow } from '../requirements-shared/protocol.js'

/** HEAD is ~30 bytes and config a few KB; anything past these caps is not a
 * file git itself wrote — refuse to slurp it. */
const HEAD_MAX_BYTES = 4096
const CONFIG_MAX_BYTES = 64 * 1024

/** Size-capped, failure-tolerant text read (undefined = absent/unreadable). */
function readCapped(path: string, maxBytes: number): string | undefined {
  try {
    const info = statSync(path, { throwIfNoEntry: false })
    if (info === undefined || !info.isFile() || info.size > maxBytes) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Resolve a directory's git metadata dir: `.git` itself when it is a
 * directory, or the gitdir a worktree/submodule `.git` FILE points at (one
 * hop, resolved against the working tree). undefined = nothing readable.
 */
function resolveGitDir(dir: string): string | undefined {
  const dotGit = statSync(join(dir, '.git'), { throwIfNoEntry: false })
  if (dotGit === undefined) return undefined
  if (dotGit.isDirectory()) return join(dir, '.git')
  if (!dotGit.isFile()) return undefined
  const pointer = readCapped(join(dir, '.git'), HEAD_MAX_BYTES)
  const pointed = pointer !== undefined ? /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim() : undefined
  if (pointed === undefined || pointed.length === 0) return undefined
  const resolved = resolve(dir, pointed)
  return statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true ? resolved : undefined
}

/** Checked-out branch from HEAD ("ref: refs/heads/X"); a detached HEAD (raw
 * sha) or unreadable HEAD yields undefined — such rows cannot be adopted. */
function readBranch(gitDir: string): string | undefined {
  const head = readCapped(join(gitDir, 'HEAD'), HEAD_MAX_BYTES)
  if (head === undefined) return undefined
  const branch = /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim()
  return branch !== undefined && branch.length > 0 ? branch : undefined
}

/** origin url out of .git/config — a section-scoped line scan, so a url key
 * under any other section can never leak in as "origin". */
function readOriginUrl(gitDir: string): string | undefined {
  const config = readCapped(join(gitDir, 'config'), CONFIG_MAX_BYTES)
  if (config === undefined) return undefined
  let inOrigin = false
  for (const line of config.split('\n')) {
    const section = /^\s*\[(.+?)\]\s*$/.exec(line)
    if (section !== null) {
      inOrigin = section[1].trim() === 'remote "origin"'
      continue
    }
    if (!inOrigin) continue
    const url = /^\s*url\s*=\s*(\S+)\s*$/.exec(line)
    if (url !== null) return url[1]
  }
  return undefined
}

/** Facts for ONE directory under repos/ — adopt's authoritative probe reuses
 * this exact reader (scan display values are never trusted as inputs). */
export function readRepoFacts(dir: string): { readonly isGitRepo: boolean; readonly branch?: string; readonly remoteUrl?: string } {
  try {
    const gitDir = resolveGitDir(dir)
    if (gitDir === undefined) return { isGitRepo: false }
    return { isGitRepo: true, branch: readBranch(gitDir), remoteUrl: readOriginUrl(gitDir) }
  } catch {
    // statSync can still throw on EACCES-class errors; an unreadable directory
    // is a not-a-repo row, not a failed scan.
    return { isGitRepo: false }
  }
}

/** Scan the repos/ directory; a missing directory is an empty listing, not
 * an error (the scanPrdDocs precedent). Directory symlinks are not followed
 * (Dirent.isDirectory is lstat-based). */
export function scanRepoDirs(reposDir: string): readonly RepoDirScanRow[] {
  try {
    if (statSync(reposDir, { throwIfNoEntry: false })?.isDirectory() !== true) return []
    const rows: RepoDirScanRow[] = []
    for (const entry of readdirSync(reposDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const facts = readRepoFacts(join(reposDir, entry.name))
      rows.push({
        name: entry.name,
        isGitRepo: facts.isGitRepo,
        ...(facts.branch !== undefined ? { branch: facts.branch } : {}),
        ...(facts.remoteUrl !== undefined ? { remoteUrl: facts.remoteUrl } : {}),
      })
    }
    rows.sort((a, b) => (a.name < b.name ? -1 : 1))
    return rows
  } catch {
    return []
  }
}
