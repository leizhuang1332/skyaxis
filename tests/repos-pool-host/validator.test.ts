/**
 * Validator layers: the URL-legality matrix (decision D2), the PoC-1 stderr
 * classifier pinned by samples, and the probe against a fake subprocess
 * service (no network, no real git).
 */
import { describe, expect, it } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { UrlRejection } from '../../src/repos-pool-shared/protocol.js'
import { ReposValidator, checkUrlSyntax, classifyLsRemote } from '../../src/repos-pool-host/validator.js'

function reject(url: string, reason: UrlRejection): void {
  expect(checkUrlSyntax(url)).toEqual({ acceptable: false, reason })
}

function accept(url: string, kind: 'https' | 'http' | 'ssh' | 'scp'): void {
  expect(checkUrlSyntax(url)).toEqual({ acceptable: true, kind })
}

describe('checkUrlSyntax: whitelist (D2)', () => {
  it('accepts the four allowed forms', () => {
    accept('https://github.com/octocat/Hello-World.git', 'https')
    accept('http://example.com/repo.git', 'http')
    accept('ssh://git@github.com/org/repo', 'ssh')
    accept('ssh://example.com/org/repo', 'ssh')
    accept('git@github.com:octocat/Hello-World.git', 'ssh')
    accept('github.com:octocat/Hello-World.git', 'scp')
    accept('192.168.1.10:org/repo.git', 'scp')
    accept('https://localhost/repo.git', 'https') // scheme'd URLs are WHATWG-validated; host need not be FQDN
    accept('HTTPS://GitHub.com/Org/Repo.GIT', 'https') // scheme is case-insensitive
  })

  it('rejects forbidden schemes and transport commands', () => {
    reject('file:///C:/repos/x', 'scheme-forbidden')
    reject('file:///home/x/repo', 'scheme-forbidden')
    reject('ext::sh -c noise', 'scheme-forbidden')
    reject('fd::17', 'scheme-forbidden')
    reject('git://github.com/octocat/Hello-World.git', 'scheme-forbidden')
    reject('git+ssh://github.com/org/repo', 'scheme-forbidden')
    reject('ftp://example.com/repo', 'scheme-forbidden')
  })

  it('rejects embedded credentials (secrets must not persist in repos.yaml)', () => {
    reject('https://user:token@github.com/org/repo', 'embedded-credentials')
    reject('ssh://git:secret@github.com/org/repo', 'embedded-credentials')
    reject('user:pass@github.com:org/repo', 'embedded-credentials')
  })

  it('rejects local paths and scp ambiguity', () => {
    reject('', 'empty')
    reject('   ', 'empty')
    reject(`https://${'a'.repeat(2100)}`, 'too-long')
    reject('https://exa mple.com/x', 'malformed-url')
    reject('https://', 'malformed-url')
    reject('C:\\repos\\x', 'no-scheme-local-path')
    reject('C:/repos/x', 'no-scheme-local-path')
    reject('./relative/path', 'no-scheme-local-path')
    reject('/absolute/path', 'no-scheme-local-path')
    reject('git@github.com', 'no-scheme-local-path') // ssh shorthand needs a path after ':'
    reject('../x:y', 'scp-ambiguous')
    reject('foo:bar', 'scp-ambiguous')
    reject('github.com:', 'malformed-url')
  })
})

describe('classifyLsRemote: PoC-1 sample pinning', () => {
  const outcome = (exitCode: number | null, stderr = '', signal: string | null = null) => classifyLsRemote({ exitCode, signal, stderr })

  it('exit 0 means reachable', () => {
    expect(outcome(0)).toBe('reachable')
  })

  it('auth samples (including the GitHub 401/404 conflation)', () => {
    expect(outcome(128, "fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe('auth')
    expect(outcome(128, 'remote: Repository not found.\nfatal: repository not found')).toBe('auth')
    expect(outcome(128, 'fatal: Authentication failed for https://example.com/x')).toBe('auth')
    expect(outcome(128, 'error: Permission denied (publickey)')).toBe('auth')
    expect(outcome(128, 'fatal: unable to access: HTTP 401')).toBe('auth')
  })

  it('network samples', () => {
    expect(outcome(128, 'fatal: unable to access: Could not resolve host: nonexistent.invalid')).toBe('network')
    expect(outcome(128, 'fatal: the remote end hung up unexpectedly (Connection refused)')).toBe('network')
    expect(outcome(128, 'fatal: SSL certificate problem')).toBe('network')
    expect(outcome(128, 'error: timed out')).toBe('network')
  })

  it('local termination: POSIX signal or Windows taskkill (non-zero exit, no substantive stderr)', () => {
    expect(outcome(null, '', 'SIGTERM')).toBe('network')
    expect(outcome(1, '')).toBe('network')
    expect(outcome(1, 'warning: use of unencrypted HTTP remote URLs is not recommended')).toBe('network')
  })

  it('unrecognized failures fall to unknown (hard reject per D4)', () => {
    expect(outcome(128, 'fatal: something exotic happened')).toBe('unknown')
  })
})

describe('ReposValidator.probe (fake subprocess)', () => {
  function fakeService(outcome?: { exitCode: number | null; signal: string | null; stderr: string }, resolveImpl?: () => Promise<string>): SubprocessRuntime {
    const spawnCalls: unknown[] = []
    const service = {
      resolveExecutable: resolveImpl ?? (async () => 'C:/git/git.EXE'),
      spawn(spec: unknown) {
        spawnCalls.push(spec as unknown)
        return {
          done: Promise.resolve({ exitCode: outcome?.exitCode ?? 0, signal: outcome?.signal ?? null }),
          collected: { stderr: { readFrom: () => ({ text: outcome?.stderr ?? '' }) } },
        }
      },
      spawnCalls,
    }
    return service as unknown as SubprocessRuntime
  }

  it('reports no-service until wired', async () => {
    const validator = new ReposValidator()
    await expect(validator.probe('https://example.com/x.git')).resolves.toEqual({ skipped: 'no-service' })
  })

  it('reports git-missing when the executable cannot be resolved', async () => {
    const validator = new ReposValidator()
    validator.setSubprocess(fakeService(undefined, async () => { throw new Error('not found') }))
    await expect(validator.probe('https://example.com/x.git')).resolves.toEqual({ skipped: 'git-missing' })
  })

  it('does not cache resolution failures (recovers after git is installed)', async () => {
    const validator = new ReposValidator()
    let installed = false
    validator.setSubprocess(fakeService({ exitCode: 0, signal: null, stderr: '' }, async () => {
      if (!installed) throw new Error('not found')
      return 'C:/git/git.EXE'
    }))
    await expect(validator.probe('https://example.com/x.git')).resolves.toEqual({ skipped: 'git-missing' })
    installed = true
    await expect(validator.probe('https://example.com/x.git')).resolves.toEqual({ classification: 'reachable', detail: '' })
  })

  it('passes spawn the credential-neutralized argv/env and classifies the outcome', async () => {
    const validator = new ReposValidator()
    const service = fakeService({ exitCode: 128, signal: null, stderr: "fatal: could not read Username for 'https://github.com'" })
    validator.setSubprocess(service)
    const result = await validator.probe('https://github.com/org/repo.git')
    expect(result).toEqual({
      classification: 'auth',
      detail: "fatal: could not read Username for 'https://github.com'",
    })
    const spec = (service as unknown as { spawnCalls: Array<Record<string, unknown>> }).spawnCalls[0] as {
      argv: string[]
      env: Record<string, string>
    }
    expect(spec.argv).toEqual(['C:/git/git.EXE', '-c', 'credential.helper=', 'ls-remote', '--heads', 'https://github.com/org/repo.git'])
    expect(spec.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
  })

  it('caps the diagnostic detail at 200 characters', async () => {
    const validator = new ReposValidator()
    validator.setSubprocess(fakeService({ exitCode: 128, signal: null, stderr: 'x'.repeat(500) }))
    const result = await validator.probe('https://example.com/x.git')
    expect(result).not.toHaveProperty('skipped')
    if (!('skipped' in result)) expect(result.detail.length).toBe(200)
  })
})
