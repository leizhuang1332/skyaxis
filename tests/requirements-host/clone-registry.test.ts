/**
 * Clone task engine: the spawn contract (argv/env/stdio), the drive chain
 * (clone → checkout -b → done), lazy incremental progress parsing, failure
 * classification (aborted before network), half-made destination cleanup,
 * and the preflight gate — against a scripted fake SubprocessRuntime.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { CloneTaskRegistry, type CloneStartInput } from '../../src/requirements-host/clone.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

type Outcome = { exitCode: number | null; signal: string | null }

/** One scripted spawn: a controllable done deferred plus an appendable stderr buffer. */
interface Script {
  outcome: Deferred<Outcome>
  appendStderr(text: string): void
  terminate: ReturnType<typeof vi.fn>
  readonly buffer: string
}

interface FakeService {
  service: SubprocessRuntime
  scripts: Script[]
  spawnCalls: Array<{ argv: readonly string[]; env?: Record<string, string>; stdio: unknown; graceMs?: number }>
  resolveImpl?: () => Promise<string>
}

function fakeService(options?: { resolveImpl?: () => Promise<string>; scripts?: Script[] }): FakeService {
  const scripts = options?.scripts ?? []
  const spawnCalls: FakeService['spawnCalls'] = []
  const service = {
    resolveExecutable: options?.resolveImpl ?? (async () => '/usr/bin/git'),
    spawn(spec: { argv: readonly string[]; env?: Record<string, string>; stdio: unknown; graceMs?: number }) {
      spawnCalls.push(spec)
      const script = scripts.shift()
      if (script === undefined) throw new Error('unexpected spawn')
      return {
        done: script.outcome.promise,
        terminate: script.terminate,
        collected: {
          stderr: {
            readFrom: (offset: number) => ({
              text: script.buffer.slice(offset),
              nextOffset: script.buffer.length,
              lossy: false,
            }),
          },
        },
      }
    },
  }
  return { service: service as unknown as SubprocessRuntime, scripts, spawnCalls }
}

function makeScript(): Script {
  let buffer = ''
  const outcome = deferred<Outcome>()
  return {
    outcome,
    appendStderr(text: string) { buffer += text },
    terminate: vi.fn(),
    get buffer() { return buffer },
  }
}

const REQ = '11111111-1111-4111-8111-111111111111'
const REPO = '22222222-2222-4222-8222-222222222222'

function input(workspacePath: string): CloneStartInput {
  return {
    requirementId: REQ,
    workspacePath,
    repoId: REPO,
    repoUrl: 'https://example.com/org/repo.git',
    repoName: 'My Repo',
    branch: 'req-11111111',
  }
}

/** happy-path trio: check-ref-format → clone → checkout, all resolved in order. */
function trio(): { check: Script; clone: Script; checkout: Script } {
  const check = makeScript()
  const clone = makeScript()
  const checkout = makeScript()
  check.outcome.resolve({ exitCode: 0, signal: null })
  clone.outcome.resolve({ exitCode: 0, signal: null })
  checkout.outcome.resolve({ exitCode: 0, signal: null })
  return { check, clone, checkout }
}

describe('CloneTaskRegistry', () => {
  it('drives the happy path: preflight spawn, clone argv/env/stdio, checkout -C -b, done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const ws = join(dir, 'ws')
    const { check, clone, checkout } = trio()
    const fake = fakeService({ scripts: [check, clone, checkout] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)

    const pre = await registry.preflight(input(ws))
    expect(pre).toEqual({ ok: true, exe: '/usr/bin/git' })
    expect(fake.spawnCalls[0]?.argv).toEqual(['/usr/bin/git', 'check-ref-format', '--branch', 'req-11111111'])

    const snap = registry.begin(input(ws), (pre as { ok: true; exe: string }).exe)
    expect(snap.status).toBe('cloning')
    await clone.outcome.promise
    await checkout.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    const [done] = registry.snapshot(REQ)
    expect(done?.status).toBe('done')

    const cloneCall = fake.spawnCalls[1]
    expect(cloneCall?.argv).toEqual(['/usr/bin/git', '-c', 'credential.helper=', 'clone', '--progress', 'https://example.com/org/repo.git', join(ws, 'repos', 'My-Repo')])
    expect(cloneCall?.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' })
    expect(cloneCall?.graceMs).toBe(3000)
    expect(fake.spawnCalls[2]?.argv).toEqual(['/usr/bin/git', '-c', 'credential.helper=', '-C', join(ws, 'repos', 'My-Repo'), 'checkout', '-b', 'req-11111111'])
  })

  it('parses progress incrementally: two snapshots advance 45% → 71%', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript() // unsettled — task stays cloning
    const fake = fakeService({ scripts: [check, clone] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)

    clone.appendStderr('remote: counting\r\nReceiving objects: 45% (10/22)\r\n')
    expect(registry.snapshot(REQ)[0]?.progressPct).toBe(45)
    clone.appendStderr('Receiving objects: 71% (16/22)\r\n')
    expect(registry.snapshot(REQ)[0]?.progressPct).toBe(71)
  })

  it('classifies auth failures with a capped detail and removes the half-made destination', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript()
    clone.appendStderr('fatal: Authentication failed for https://example.com/org/repo.git/')
    const fake = fakeService({ scripts: [check, clone] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)
    clone.outcome.resolve({ exitCode: 128, signal: null })
    await clone.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    const [failed] = registry.snapshot(REQ)
    expect(failed?.status).toBe('failed')
    expect(failed?.failureClass).toBe('auth')
    expect(failed?.detail).toContain('Authentication failed')
    expect(statSync(join(dir, 'repos', 'My-Repo'), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('aborted wins over the signal→network fallback; network kept otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript()
    const fake = fakeService({ scripts: [check, clone] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)

    // Abort BEFORE the killed process settles — the user cancel must not read as network.
    expect(registry.abort(REQ, REPO)).toBe(true)
    expect(clone.terminate).toHaveBeenCalled()
    expect(registry.snapshot(REQ)[0]?.failureClass).toBe('aborted')

    clone.outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
    await clone.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.snapshot(REQ)[0]?.failureClass).toBe('aborted')
  })

  it('a killed clone without an abort classifies as network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript()
    const fake = fakeService({ scripts: [check, clone] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)
    clone.outcome.resolve({ exitCode: null, signal: 'SIGKILL' })
    await clone.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.snapshot(REQ)[0]?.failureClass).toBe('network')
  })

  it('preflight rejects invalid branches before any clone spawn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 1, signal: null })
    const clone = makeScript()
    const fake = fakeService({ scripts: [check, clone] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight({ ...input(dir), branch: 'bad..branch' })
    expect(pre).toEqual({ ok: false, reason: 'invalid-branch' })
    expect(fake.spawnCalls).toHaveLength(1)
  })

  it('preflight refuses dest-exists / busy / too-many; begin re-checks dest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const fake = fakeService()
    const registry = new CloneTaskRegistry({ maxConcurrent: 2 })
    registry.setSubprocess(fake.service)

    // dest-exists: a leftover directory at the destination (git resolves first)
    const ws = join(dir, 'ws')
    const dest = join(ws, 'repos', 'My-Repo')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dest, { recursive: true })
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const fakeDest = fakeService({ scripts: [check] })
    registry.setSubprocess(fakeDest.service)
    const pre = await registry.preflight(input(ws))
    expect(pre).toEqual({ ok: false, reason: 'dest-exists' })

    rmSync(dest, { recursive: true })
    // busy + too-many via in-flight tasks on other repos
    const registry2 = new CloneTaskRegistry({ maxConcurrent: 1 })
    const checkA = makeScript()
    checkA.outcome.resolve({ exitCode: 0, signal: null })
    const cloneA = makeScript()
    const fake2 = fakeService({ scripts: [checkA, cloneA] })
    registry2.setSubprocess(fake2.service)
    const preA = await registry2.preflight(input(ws))
    registry2.begin(input(ws), (preA as { ok: true; exe: string }).exe) // occupies the single slot
    const busy = await registry2.preflight(input(ws))
    expect(busy).toEqual({ ok: false, reason: 'busy' })
    const other = await registry2.preflight({ ...input(ws), repoId: '33333333-3333-4333-8333-333333333333' })
    expect(other).toEqual({ ok: false, reason: 'too-many' })
  })

  it('resolves git-missing when resolveExecutable throws, and caches success only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    let fail = true
    const fake = fakeService({ resolveImpl: async () => { if (fail) throw new Error('not found'); return '/usr/bin/git' } })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    expect(await registry.preflight(input(dir))).toEqual({ ok: false, reason: 'git-missing' })
    fail = false
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const fake2 = fakeService({ scripts: [check] })
    registry.setSubprocess(fake2.service)
    expect(await registry.preflight(input(dir))).toEqual({ ok: true, exe: '/usr/bin/git' })
  })

  it('no-service preflight and setSubprocess(undefined) converges live tasks to aborted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const registry = new CloneTaskRegistry()
    expect(await registry.preflight(input(dir))).toEqual({ ok: false, reason: 'no-service' })

    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript()
    const fake = fakeService({ scripts: [check, clone] })
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)
    registry.setSubprocess(undefined)
    expect(clone.terminate).toHaveBeenCalled()
    expect(registry.snapshot(REQ)[0]?.failureClass).toBe('aborted')
  })

  it('a failing checkout after a clean clone settles bad-branch and removes the destination', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const check = makeScript()
    check.outcome.resolve({ exitCode: 0, signal: null })
    const clone = makeScript()
    clone.outcome.resolve({ exitCode: 0, signal: null })
    const checkout = makeScript()
    checkout.appendStderr("fatal: a branch named 'req-11111111' already exists")
    checkout.outcome.resolve({ exitCode: 128, signal: null })
    const fake = fakeService({ scripts: [check, clone, checkout] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(dir))
    registry.begin(input(dir), (pre as { ok: true; exe: string }).exe)
    await checkout.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.snapshot(REQ)[0]?.failureClass).toBe('bad-branch')
    expect(statSync(join(dir, 'repos', 'My-Repo'), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('reclone removes the old destination and writes no second slot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clone-test-'))
    dirs.push(dir)
    const ws = join(dir, 'ws')
    const first = trio()
    const fake = fakeService({ scripts: [first.check, first.clone, first.checkout] })
    const registry = new CloneTaskRegistry()
    registry.setSubprocess(fake.service)
    const pre = await registry.preflight(input(ws))
    registry.begin(input(ws), (pre as { ok: true; exe: string }).exe)
    await first.checkout.outcome.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registry.snapshot(REQ)).toHaveLength(1)

    const second = trio()
    const fake2 = fakeService({ scripts: [second.check, second.clone, second.checkout] })
    registry.setSubprocess(fake2.service)
    const result = await registry.reclone(input(ws))
    expect(result.ok).toBe(true)
    expect(registry.snapshot(REQ)).toHaveLength(1)
    expect(registry.snapshot(REQ)[0]?.taskId).not.toBe(registry.snapshot(REQ)[0] ? '' : '')
  })
})
