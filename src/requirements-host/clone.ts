/**
 * Clone task engine (P3b): an in-memory task registry that drives
 * `git clone --progress` + a local `show-ref` probe + `git checkout` over
 * ctx.subprocess and reports progress through lazily-read snapshot polls.
 * The probe checks refs/remotes/origin/<branch> (zero network — the full
 * clone already fetched every branch): remote branch present ⇒ `checkout -B
 * --track` (start point = remote tip + upstream), absent ⇒ `checkout -b`
 * (the new-branch case, decided in the 0003 P3 plan).
 *
 * Shape notes (all decided in the 0003 P3 plan):
 * - Single slot per (requirement, repo): the latest task per link wins,
 *   terminal snapshots included (failure detail must survive client
 *   refreshes); unlink drops the slot. Bounded memory by construction.
 * - Progress is read lazily on snapshot(): readFrom(offset) is a
 *   non-consuming incremental read; the 64KB collect TAIL keeps the newest
 *   progress line and the fatal tail, which is all either side needs. A
 *   lossy read returns the whole retained tail — re-scanning for the LAST
 *   percentage is idempotent.
 * - No clone timeout: clone is a legitimately long task (the validator's
 *   20s is a probe). Cancellation is the exit; the subprocess grace ladder
 *   (TERM → graceMs → KILL, process group) keeps the managed semantics.
 * - rmSync of a half-made destination runs strictly AFTER handle.done
 *   settles (never racing the writer) with maxRetries for Windows locks.
 * - Abort marks the task 'aborted' immediately (UI feedback) and classifies
 *   BEFORE the signal→network fallback, so a user cancel never surfaces as
 *   a network error.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { CloneFailureClass, CloneTaskSnapshot } from '../requirements-shared/protocol.js'
import { repoDirName } from '../requirements-shared/repo-dir.js'
import { classifyLsRemote, substantiveStderr } from '../repos-pool-host/validator.js'

export type ClonePreflightReason =
  | 'no-service'
  | 'git-missing'
  | 'invalid-branch'
  | 'dest-exists'
  | 'busy'
  | 'too-many'

export interface CloneStartInput {
  readonly requirementId: string
  readonly workspacePath: string
  readonly repoId: string
  readonly repoUrl: string
  readonly repoName: string
  readonly branch: string
}

export type ClonePreflight =
  | { ok: true; exe: string }
  | { ok: false; reason: ClonePreflightReason }

/** 'branching' spans the ref probe and the checkout itself. */
type CloneStatus = 'cloning' | 'branching' | 'done' | 'failed'

interface CloneTask {
  readonly id: string
  readonly requirementId: string
  readonly repoId: string
  readonly repoName: string
  readonly branch: string
  readonly destPath: string
  readonly controller: AbortController
  status: CloneStatus
  progressPct?: number
  phaseText?: string
  failureClass?: CloneFailureClass
  detail?: string
  readonly startedAt: number
  finishedAt?: number
  handle?: SubprocessHandle
  /** Incremental stderr offset for progress parsing (non-consuming reads). */
  stderrOffset: number
}

const MAX_DETAIL_LENGTH = 200
const PROGRESS_LINE = /(?:Receiving objects|Resolving deltas|Compressing objects|Updating files):\s+(\d+)%/g

let taskSeq = 0

export class CloneTaskRegistry {
  readonly #maxConcurrent: number
  #service: SubprocessRuntime | undefined
  #cachedGitPath: string | undefined
  /** Key `${requirementId}\u0000${repoId}` → latest task (single slot). */
  readonly #tasks = new Map<string, CloneTask>()

  constructor(options?: { maxConcurrent?: number }) {
    this.#maxConcurrent = options?.maxConcurrent ?? 3
  }

  /** Cordis inject callback target — undefined also converges live tasks. */
  setSubprocess(service: SubprocessRuntime | undefined): void {
    this.#service = service
    if (service === undefined) this.abortAll()
  }

  #slot(requirementId: string, repoId: string): string {
    return `${requirementId}\u0000${repoId}`
  }

  #activeCount(): number {
    let count = 0
    for (const task of this.#tasks.values()) {
      if (task.status === 'cloning' || task.status === 'branching') count += 1
    }
    return count
  }

  #inFlight(requirementId: string, repoId: string): boolean {
    const task = this.#tasks.get(this.#slot(requirementId, repoId))
    return task !== undefined && (task.status === 'cloning' || task.status === 'branching')
  }

  destFor(input: CloneStartInput): string {
    return join(input.workspacePath, 'repos', repoDirName(input.repoName, input.repoId))
  }

  /**
   * All side-effect-free checks plus git resolution and the authoritative
   * branch validation — runs BEFORE any ledger write so input errors (the
   * bad-request family) never leave dirty state behind.
   */
  async preflight(input: CloneStartInput): Promise<ClonePreflight> {
    const check = await this.#check(input)
    if (!check.ok) return check
    if (existsSync(this.destFor(input))) return { ok: false, reason: 'dest-exists' }
    return check
  }

  /** Checks without the destination probe — reclone deletes the destination by design. */
  async #check(input: CloneStartInput): Promise<ClonePreflight> {
    if (this.#service === undefined) return { ok: false, reason: 'no-service' }
    if (this.#inFlight(input.requirementId, input.repoId)) return { ok: false, reason: 'busy' }
    if (this.#activeCount() >= this.#maxConcurrent) return { ok: false, reason: 'too-many' }
    const exe = await this.#resolveGit()
    if (exe === undefined) return { ok: false, reason: 'git-missing' }
    // Deliberate deviation from the ledger-survives philosophy: a link that
    // can never clone is a dead row — git-missing/invalid-branch reject here.
    const branchOk = await this.#spawnOnce(exe, ['check-ref-format', '--branch', input.branch])
    if (branchOk !== true) {
      return { ok: false, reason: branchOk === null ? 'git-missing' : 'invalid-branch' }
    }
    return { ok: true, exe }
  }

  async #resolveGit(): Promise<string | undefined> {
    if (this.#cachedGitPath !== undefined) return this.#cachedGitPath
    try {
      const exe = await this.#service!.resolveExecutable('git')
      // Cache success only — a git installed mid-session recovers (validator precedent).
      this.#cachedGitPath = exe
      return exe
    } catch {
      return undefined
    }
  }

  /** One-shot probe with the shared env contract. true = exit 0; false = non-zero; null = provider failure. */
  async #spawnOnce(exe: string, args: readonly string[]): Promise<boolean | null> {
    try {
      const handle = this.#service!.spawn({
        argv: [exe, ...args],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 3000,
        env: CLONE_ENV,
      })
      const outcome = await handle.done
      return outcome.exitCode === 0
    } catch {
      return null
    }
  }

  #spawnGuarded(argv: readonly string[], signal: AbortSignal): SubprocessHandle | undefined {
    // spawn throws synchronously on a malformed spec or pre-aborted signal.
    try {
      return this.#service!.spawn({
        argv,
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 3000,
        signal,
        env: CLONE_ENV,
      })
    } catch {
      return undefined
    }
  }

  /**
   * Register and drive a task: clone → (exit 0) → #branchPhase → done.
   * The promise chain settles terminal states; spawn/driver rejections are
   * contained as failed{unknown}.
   */
  begin(input: CloneStartInput, exe: string): CloneTaskSnapshot {
    mkdirSync(join(input.workspacePath, 'repos'), { recursive: true })
    const destPath = this.destFor(input)
    const task: CloneTask = {
      id: `clone-${++taskSeq}`,
      requirementId: input.requirementId,
      repoId: input.repoId,
      repoName: input.repoName,
      branch: input.branch,
      destPath,
      controller: new AbortController(),
      status: 'cloning',
      startedAt: Date.now(),
      stderrOffset: 0,
    }
    this.#tasks.set(this.#slot(input.requirementId, input.repoId), task)
    // Race re-check: the preflight→save gap can admit a second task for a
    // destination that appeared meanwhile — fail it cleanly instead of
    // letting git clobber (git itself refuses too; this is the tidy path).
    if (existsSync(destPath)) {
      this.#settleFailure(task, 'dest-exists')
      return this.#snapshotOf(task)
    }
    this.#drive(task, exe, input)
    return this.#snapshotOf(task)
  }

  /**
   * Single-call re-clone (busy check + rm + resolve + branch check + spawn in
   * one continuation — the two-step preflight/begin gap would admit racing
   * reclones through both checks). Writes no ledger row.
   */
  async reclone(input: CloneStartInput): Promise<{ ok: true; snapshot: CloneTaskSnapshot } | { ok: false; reason: ClonePreflightReason }> {
    // Every check passes BEFORE the destructive rm: a rejected reclone
    // (busy / too-many / git-missing / bad branch) must never delete the
    // existing clone.
    const check = await this.#check(input)
    if (!check.ok) return check
    const destPath = this.destFor(input)
    if (!this.#rmDest(destPath)) return { ok: false, reason: 'dest-exists' }
    return { ok: true, snapshot: this.begin(input, check.exe) }
  }

  #drive(task: CloneTask, exe: string, input: CloneStartInput): void {
    const cloneHandle = this.#spawnGuarded(
      [exe, '-c', 'credential.helper=', 'clone', '--progress', input.repoUrl, task.destPath],
      task.controller.signal,
    )
    if (cloneHandle === undefined) {
      this.#settleFailure(task, 'unknown')
      return
    }
    task.handle = cloneHandle
    void cloneHandle.done
      .then((outcome) => {
        if (task.controller.signal.aborted) {
          this.#cleanupDest(task)
          this.#settleFailure(task, 'aborted')
          return
        }
        if (outcome.exitCode !== 0) {
          const stderr = cloneHandle.collected.stderr?.readFrom(0)?.text ?? ''
          const classified = classifyLsRemote({ exitCode: outcome.exitCode, signal: outcome.signal, stderr })
          this.#cleanupDest(task)
          this.#settleFailure(task, classified === 'reachable' ? 'unknown' : classified)
          return
        }
        task.status = 'branching'
        task.progressPct = undefined
        task.phaseText = undefined
        this.#branchPhase(task, exe)
      })
      .catch(() => {
        this.#cleanupDest(task)
        this.#settleFailure(task, 'unknown')
      })
  }

  /**
   * Post-clone branch phase: a zero-network `show-ref` probe of the local
   * refs/remotes/origin/<branch> picks the checkout arm — remote branch
   * present ⇒ `checkout -B <branch> --track origin/<branch>` (start point =
   * remote tip, upstream set; -B also covers branch == the default branch
   * name, where -b would hit "already exists"), absent ⇒ `checkout -b` (the
   * new-branch case). A probe spawn/driver failure is a provider-level
   * fault: settle unknown{cleanup} rather than falling back to -b, which
   * would silently produce the wrong-start-point branch this phase exists
   * to prevent (explicit `--track` guards a global branch.autoSetupMerge=
   * false, which disables implicit upstream setup for remote-tracking start
   * points).
   */
  #branchPhase(task: CloneTask, exe: string): void {
    const probeHandle = this.#spawnGuarded(
      [exe, '-c', 'credential.helper=', '-C', task.destPath, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${task.branch}`],
      task.controller.signal,
    )
    if (probeHandle === undefined) {
      this.#cleanupDest(task)
      this.#settleFailure(task, 'unknown')
      return
    }
    // Abort must reach the LIVE process: park the handle on the task
    // (it still points at the exited clone otherwise).
    task.handle = probeHandle
    void probeHandle.done
      .then((probeOutcome) => {
        if (task.controller.signal.aborted) {
          this.#cleanupDest(task)
          this.#settleFailure(task, 'aborted')
          return
        }
        const checkoutArgv = probeOutcome.exitCode === 0
          ? [exe, '-c', 'credential.helper=', '-C', task.destPath, 'checkout', '-B', task.branch, '--track', `origin/${task.branch}`]
          : [exe, '-c', 'credential.helper=', '-C', task.destPath, 'checkout', '-b', task.branch]
        const checkoutHandle = this.#spawnGuarded(checkoutArgv, task.controller.signal)
        if (checkoutHandle === undefined) {
          this.#cleanupDest(task)
          this.#settleFailure(task, 'unknown')
          return
        }
        // Abort must reach the LIVE process: park the handle on the task
        // (it still points at the exited probe otherwise).
        task.handle = checkoutHandle
        void checkoutHandle.done
          .then((checkoutOutcome) => {
            // An aborted task must not be revived by a successful checkout
            // (the terminate race: checkout may exit 0 before TERM lands).
            if (task.controller.signal.aborted) {
              this.#cleanupDest(task)
              this.#settleFailure(task, 'aborted')
              return
            }
            if (checkoutOutcome.exitCode === 0) {
              task.status = 'done'
              task.finishedAt = Date.now()
              return
            }
            this.#cleanupDest(task)
            this.#settleFailure(task, 'bad-branch')
          })
          .catch(() => {
            this.#cleanupDest(task)
            this.#settleFailure(task, 'unknown')
          })
      })
      .catch(() => {
        this.#cleanupDest(task)
        this.#settleFailure(task, 'unknown')
      })
  }

  #settleFailure(task: CloneTask, failureClass: CloneFailureClass): void {
    if (task.status === 'done' || task.status === 'failed') return
    task.status = 'failed'
    task.failureClass = failureClass
    task.finishedAt = Date.now()
    if (failureClass !== 'aborted' && task.handle !== undefined) {
      const stderr = task.handle.collected.stderr?.readFrom(0)?.text ?? ''
      const firstLine = substantiveStderr(stderr).trim().split('\n')[0] ?? ''
      if (firstLine.length > 0) task.detail = firstLine.slice(0, MAX_DETAIL_LENGTH)
    }
  }

  /**
   * Half-made destination cleanup — only after the process settled, and only
   * while this task still owns the slot: abort→relink races replace the slot
   * with a fresh task whose in-flight clone the late rm must not destroy.
   */
  #cleanupDest(task: CloneTask): void {
    if (this.#tasks.get(this.#slot(task.requirementId, task.repoId)) !== task) return
    this.#rmDest(task.destPath)
  }

  /**
   * Delete a link's cloned directory (unlink, user-confirmed). Best-effort
   * with retries; a locked leftover surfaces on the next link as dest-exists
   * (deletable by hand) — never fails the unlink itself.
   */
  removeDir(workspacePath: string, dirName: string): boolean {
    return this.#rmDest(join(workspacePath, 'repos', dirName))
  }

  #rmDest(destPath: string): boolean {
    try {
      rmSync(destPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return true
    } catch {
      return false
    }
  }

  /** Snapshot with lazy incremental progress parsing for cloning tasks. */
  snapshot(requirementId: string): readonly CloneTaskSnapshot[] {
    const rows: CloneTaskSnapshot[] = []
    for (const task of this.#tasks.values()) {
      if (task.requirementId !== requirementId) continue
      if (task.status === 'cloning' && task.handle !== undefined) {
        const reader = task.handle.collected.stderr
        if (reader !== undefined) {
          const read = reader.readFrom(task.stderrOffset)
          task.stderrOffset = read.nextOffset
          let lastPct: number | undefined
          let lastPhase: string | undefined
          for (const match of read.text.matchAll(PROGRESS_LINE)) {
            lastPct = Number(match[1])
            lastPhase = match[0].split(':')[0]
          }
          if (lastPct !== undefined) {
            task.progressPct = lastPct
            task.phaseText = lastPhase
          }
        }
      }
      rows.push(this.#snapshotOf(task))
    }
    return rows
  }

  #snapshotOf(task: CloneTask): CloneTaskSnapshot {
    return {
      taskId: task.id,
      repoId: task.repoId,
      repoName: task.repoName,
      branch: task.branch,
      status: task.status,
      ...(task.progressPct !== undefined ? { progressPct: task.progressPct } : {}),
      ...(task.failureClass !== undefined ? { failureClass: task.failureClass } : {}),
      ...(task.detail !== undefined ? { detail: task.detail } : {}),
      startedAt: task.startedAt,
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
    }
  }

  /**
   * Abort the in-flight task for a link (immediate terminal state; the settled
   * process's continuation still cleans the half-made destination, guarded by
   * slot ownership). A terminal task's slot is dropped; unknown: no-op.
   */
  abort(requirementId: string, repoId: string): boolean {
    const slot = this.#slot(requirementId, repoId)
    const task = this.#tasks.get(slot)
    if (task === undefined) return false
    if (task.status === 'cloning' || task.status === 'branching') {
      task.controller.abort()
      task.handle?.terminate()
      // Immediate terminal state (UI feedback); the settled process's own
      // cleanup continuation still runs the rmSync.
      this.#settleFailure(task, 'aborted')
      return true
    }
    this.#tasks.delete(slot)
    return false
  }

  abortAll(): void {
    for (const task of this.#tasks.values()) {
      if (task.status === 'cloning' || task.status === 'branching') {
        task.controller.abort()
        task.handle?.terminate()
        this.#settleFailure(task, 'aborted')
      }
    }
  }
}

/**
 * Shared spawn env: the validator contract plus LC_ALL=C — the classification
 * regexes and progress labels are English-anchored and the host locale is
 * unknown.
 */
const CLONE_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  LC_ALL: 'C',
}
