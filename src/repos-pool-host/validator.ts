/**
 * Repos-pool URL validation (host half).
 *
 * Three layers, deliberately split:
 *  1. `checkUrlSyntax` — pure whitelist/shape rules (decision 0003 / D2).
 *  2. `classifyLsRemote` — pure stderr/exitCode/signal classifier, the P0
 *     PoC-1 classifier moved verbatim (its pattern set is pinned by tests).
 *  3. `ReposValidator.probe` — reachability through the injected subprocess
 *     service; `setSubprocess` wires/unwires it from the cordis lifecycle.
 *
 * Production spawn contract (PoC-1 findings): explicit argv with
 * `-c credential.helper=` (GIT_TERMINAL_PROMPT=0 alone does not stop the Git
 * Credential Manager) plus GCM_INTERACTIVE=never; bounded collected output;
 * local timeout via AbortSignal. Windows taskkill semantics surface as a
 * non-zero exit with no substantive stderr (warning lines stripped) — the
 * classifier treats that as the local-timeout/network class.
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  ReachabilityClass,
  UrlKind,
  UrlRejection,
  UrlSyntax,
} from '../repos-pool-shared/protocol.js'

// ---------------------------------------------------------------------------
// 1. URL legality (pure)
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048
const ALLOWED_SCHEMES: readonly string[] = ['https', 'http', 'ssh']
/** FQDN: labels of alnum/hyphen (no leading/trailing hyphen), at least one dot. */
const FQDN = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/].*$/

function looksLikeHost(segment: string): boolean {
  return segment.length > 0 && (FQDN.test(segment) || IPV4.test(segment))
}

export function checkUrlSyntax(rawUrl: string): UrlSyntax {
  const url = rawUrl.trim()
  if (url.length === 0) return { acceptable: false, reason: 'empty' }
  if (url.length > MAX_URL_LENGTH) return { acceptable: false, reason: 'too-long' }
  // Explicit transport-command forms: execution surface, always fatal — and
  // diagnosed before the generic whitespace check, since their payloads
  // legitimately contain spaces.
  if (url.startsWith('ext::') || url.startsWith('fd::')) {
    return { acceptable: false, reason: 'scheme-forbidden' }
  }
  if (/[\s\u0000-\u001f]/.test(url)) return { acceptable: false, reason: 'malformed-url' }

  if (url.includes('://')) {
    const scheme = url.slice(0, url.indexOf('://')).toLowerCase()
    if (!ALLOWED_SCHEMES.includes(scheme)) {
      return { acceptable: false, reason: 'scheme-forbidden' }
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { acceptable: false, reason: 'malformed-url' }
    }
    // Credentials mean a secret in the URL (and, persisted, in repos.yaml):
    // a password or a colon-bearing userinfo. A bare username is the
    // universal ssh form (git@host) and stays legal.
    if (parsed.password !== '' || parsed.username.includes(':')) {
      return { acceptable: false, reason: 'embedded-credentials' }
    }
    // Hostname sanity for scheme'd URLs is WHATWG parsing's job (FQDN or not,
    // localhost and single-label intranet hosts are legitimate targets); the
    // FQDN/IPv4 constraint only guards the scheme-less scp form below, where
    // the local-path ambiguity actually exists.
    return { acceptable: true, kind: scheme as UrlKind }
  }

  // No scheme from here on. user@host:path (ssh shorthand) first.
  if (url.includes('@')) {
    const at = url.lastIndexOf('@')
    const userinfo = url.slice(0, at)
    const rest = url.slice(at + 1)
    if (userinfo.includes(':')) {
      return { acceptable: false, reason: 'embedded-credentials' }
    }
    const colon = rest.indexOf(':')
    if (colon < 0 || colon === rest.length - 1) {
      return { acceptable: false, reason: 'no-scheme-local-path' }
    }
    const host = rest.slice(0, colon)
    if (!looksLikeHost(host)) {
      return { acceptable: false, reason: 'scp-ambiguous' }
    }
    return { acceptable: true, kind: 'ssh' }
  }

  // host:path (scp shorthand): the host segment must look like an FQDN/IPv4,
  // otherwise the input is indistinguishable from a local path.
  const colon = url.indexOf(':')
  if (colon >= 0) {
    if (WINDOWS_DRIVE.test(url)) {
      return { acceptable: false, reason: 'no-scheme-local-path' }
    }
    if (colon === url.length - 1) {
      return { acceptable: false, reason: 'malformed-url' }
    }
    const host = url.slice(0, colon)
    if (!looksLikeHost(host)) {
      return { acceptable: false, reason: 'scp-ambiguous' }
    }
    return { acceptable: true, kind: 'scp' }
  }

  return { acceptable: false, reason: 'no-scheme-local-path' }
}

// ---------------------------------------------------------------------------
// 2. ls-remote outcome classifier (pure; PoC-1 pattern set)
// ---------------------------------------------------------------------------

const AUTH_PATTERNS: readonly RegExp[] = [
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /permission denied/i,
  /\bhttp 401\b/i,
  /\bhttp 403\b/i,
  /access denied/i,
  // GitHub deliberately conflates 401/404 for private repos.
  /repository .*not found/i,
  // ssh trust gate: the server IS reachable; the non-interactive probe cannot
  // verify/accept its host key (first connect, or changed key). Closest
  // confirmable bucket is auth — the URL itself is fine.
  /host key verification failed/i,
  /host key .*has changed/i,
]

const NETWORK_PATTERNS: readonly RegExp[] = [
  /could not resolve host/i,
  /timed out/i,
  /connection refused/i,
  /connection reset/i,
  /network is unreachable/i,
  /no route to host/i,
  /ssl.*(?:handshake|certificate)/i,
]

/** stderr with `warning:` lines stripped — killed processes may have warned before dying. */
export function substantiveStderr(stderr: string): string {
  return stderr.split('\n').filter((line) => line.trim() && !line.trim().startsWith('warning:')).join('\n')
}

/** The classifier never yields 'unverified' — that value only exists on the wire, when the probe was skipped. */
export type LsRemoteClass = Exclude<ReachabilityClass, 'unverified'>

export function classifyLsRemote(outcome: { exitCode: number | null; signal: string | null; stderr: string }): LsRemoteClass {
  const { exitCode, signal, stderr } = outcome
  if (exitCode === 0) return 'reachable'
  // Local termination takes two forms: a POSIX signal, or (Windows taskkill)
  // a non-zero exit whose stderr carries nothing substantive.
  if (signal) return 'network'
  if (substantiveStderr(stderr).trim().length === 0 && exitCode !== 0) return 'network'
  if (AUTH_PATTERNS.some((pattern) => pattern.test(stderr))) return 'auth'
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(stderr))) return 'network'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// 3. Reachability probe (subprocess-backed)
// ---------------------------------------------------------------------------

export interface LsRemoteOutcome {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stderr: string
}

export type ProbeResult =
  | { readonly classification: LsRemoteClass; readonly detail: string }
  | { readonly skipped: 'git-missing' }
  | { readonly skipped: 'no-service' }

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_DETAIL_LENGTH = 200

export class ReposValidator {
  readonly #timeoutMs: number
  #service: SubprocessRuntime | undefined
  #cachedGitPath: string | undefined

  constructor(options?: { timeoutMs?: number }) {
    this.#timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Wired from `ctx.inject(['subprocess'], ...)`; undefined unwires (probe → no-service). */
  setSubprocess(service: SubprocessRuntime | undefined): void {
    this.#service = service
  }

  async probe(url: string, signal?: AbortSignal): Promise<ProbeResult> {
    if (!this.#service) return { skipped: 'no-service' }
    let exe = this.#cachedGitPath
    if (exe === undefined) {
      // Failure is deliberately not cached: installing git mid-session
      // recovers on the next probe (resolve is just a PATH lookup).
      try {
        exe = await this.#service.resolveExecutable('git')
      } catch {
        return { skipped: 'git-missing' }
      }
      this.#cachedGitPath = exe
    }

    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs)
    const spawnSignal = signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    try {
      const handle = this.#service.spawn({
        argv: [exe, '-c', 'credential.helper=', 'ls-remote', '--heads', url],
        cwd: process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 64 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: 3000,
        signal: spawnSignal,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
        },
      })
      const { exitCode, signal: exitSignal } = await handle.done
      const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
      const classification = classifyLsRemote({ exitCode, signal: exitSignal, stderr })
      const firstSubstantive = substantiveStderr(stderr).trim().split('\n')[0] ?? ''
      const detail = firstSubstantive.slice(0, MAX_DETAIL_LENGTH)
      return { classification, detail }
    } finally {
      clearTimeout(timer)
    }
  }
}
