/**
 * URL legality rules (decision 0003 / D2) — the pure syntax classifier.
 *
 * Lives in repos-pool-shared (inlined into the browser bundle alongside
 * protocol.ts) because both halves need it: the host validates every save
 * and import address, while the browser form slots each address by its
 * kind before sending (decision 0004 / D4 — slot by value, not by the
 * input box it was typed into). Zero dependencies by the shared-bundle
 * rule: RegExp + the WHATWG URL parser only.
 */
import type { UrlKind, UrlSyntax } from './protocol.js'

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
