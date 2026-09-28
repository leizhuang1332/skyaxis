/**
 * Linked repositories section (P3b): pool picker dialog → clone task rows
 * with live progress polling → row menus (reveal / re-clone / cancel /
 * unlink).
 *
 * Dual-address picker (0005 P4, decision 0004 / D7): each pool record's
 * addresses render per line (SSH:/HTTP: label + status Tag); the recommended
 * one (pickAddress ordering) is badged until the user pins a different line.
 * link snapshots the CHOSEN slot's URL; reclone keeps snapshotting the
 * current recommendation (switching pools-side is known behavior). The wire
 * never changes — repoUrl stays a client-side snapshot.
 *
 * Reverse-link discovery: the repos/ directory scan (host reports raw facts,
 * pulled on mount and on binding moves) joins against the live pool list
 * HERE — derived dirName equality, origin-url tiebreak — and lists cloned
 * but unlinked pool repos as one-Click adopts. Adopt writes the ledger row
 * without cloning; the branch comes back host-read from .git/HEAD.
 *
 * Local state throughout (the status precedent — nothing here enters the
 * page store): task snapshots, the pool list, the scan, and the dialog.
 * Polling runs only while a non-terminal task exists (1s interval, the
 * pull-only channel; cleared on unmount, in-flight fetch aborted).
 *
 * Pool data comes from the repos-pool fetcher (same bundle, pure function
 * face — the single client build has no module boundary). The join by repoId
 * is loss-tolerant: a removed pool repo renders as "removed" and keeps its
 * on-disk actions.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Button,
  IconEllipsisOutline16,
  IconPlusOutline16,
  Input,
  Menu,
  Modal,
  StateDot,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { createReposFetcher } from '../repos-pool/fetcher.js'
import { pickAddress } from '../../repos-pool-shared/address.js'
import type { AddressSlot, RepoRecord, RepoStatus } from '../../repos-pool-shared/protocol.js'
import type { CloneTaskSnapshot, RepoDirScanRow, RequirementRecord } from '../../requirements-shared/protocol.js'
import { repoDirName } from '../../requirements-shared/repo-dir.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import type { WorkspaceCapabilities } from './workspace-tab.js'
import styles from './view.module.css'

type PoolState =
  | { kind: 'loading' }
  | { kind: 'ready'; repos: readonly RepoRecord[] }
  | { kind: 'error' }

/** Per-address view of a pool record — absent slots render nothing (the
 * repos-pool list.tsx rowSlots twin; not importable without dragging the
 * ReposPoolT-bound module along). */
interface RowSlot {
  readonly slot: AddressSlot
  readonly label: 'SSH' | 'HTTP'
  readonly url: string
  readonly status: RepoStatus
}

function rowSlots(repo: RepoRecord): readonly RowSlot[] {
  const slots: RowSlot[] = []
  if (repo.urlSsh !== undefined && repo.statusSsh !== undefined) {
    slots.push({ slot: 'ssh', label: 'SSH', url: repo.urlSsh, status: repo.statusSsh })
  }
  if (repo.urlHttp !== undefined && repo.statusHttp !== undefined) {
    slots.push({ slot: 'http', label: 'HTTP', url: repo.urlHttp, status: repo.statusHttp })
  }
  return slots
}

const STATUS_TAG_TONE: Record<RepoStatus, 'success' | 'neutral' | 'warning'> = {
  'verified': 'success',
  'unverified': 'neutral',
  'forced-network': 'warning',
  'forced-auth': 'warning',
}

const STATUS_KEY: Record<RepoStatus, Parameters<RequirementsT>[0]> = {
  'verified': 'repos.statusVerified',
  'unverified': 'repos.statusUnverified',
  'forced-network': 'repos.statusForcedNetwork',
  'forced-auth': 'repos.statusForcedAuth',
}

/** The picker's single selection decision: which repo, and which of its
 * addresses to snapshot into repoUrl (decision 0004 / D7). One composite
 * state — repo and slot can never desynchronize across switches. */
type Selection = { repoId: string; slot: AddressSlot } | null

/** repos/ scan facts: 'loading' is also the resting state after an aborted or
 * failed pull — a discovery that cannot be read simply stays hidden. */
type ScanState = { kind: 'loading' } | { kind: 'ready'; dirs: readonly RepoDirScanRow[] }

/** repos/ directory facts, pulled on mount and whenever the binding moves (a
 * different workspace is a different repos/), plus an explicit refresh for
 * flows that change the disk under it (unlink deletes a directory). Local
 * state, the status precedent; an aborted pull leaves 'loading' behind — the
 * re-run effect owns the next transition, and a rejection lands nowhere (the
 * openWorkspacePath .catch precedent: an aborted read is not an error). */
function useRepoScan(controller: RequirementsController, requirementId: string, workspacePath: string): [ScanState, () => void] {
  const [state, setState] = useState<ScanState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    setState({ kind: 'loading' })
    const controller$ = new AbortController()
    void controller.repoScan(requirementId, controller$.signal)
      .then((result) => {
        if (controller$.signal.aborted) return
        if (result !== undefined && result.kind === 'ok') setState({ kind: 'ready', dirs: result.dirs })
      })
      .catch(() => {})
    return () => { controller$.abort() }
  }, [controller, requirementId, workspacePath, nonce])
  return [state, () => { setNonce((n) => n + 1) }]
}

/** One adoptable strip row: the pool repo plus its on-disk branch. */
interface AdoptableRow {
  readonly repo: RepoRecord
  readonly branch: string
}

/**
 * The client-side identity join (the 0002 boundary keeps the requirements
 * host out of repos.yaml): a scan dir adopts when its name equals a pool
 * repo's derived dirName AND it carries a readable branch. Derived names are
 * lossy and can collide across pool repos — the origin url breaks the tie
 * when it matches exactly one candidate's addresses; an unbreakable tie or a
 * URL-less non-match stays unlisted rather than guessed. Orphan dirs (no
 * pool repo at all) are out of scope by construction.
 *
 * Occupancy: a dir already claimed by a LINKED pool repo's derived name is
 * never re-offered. Adopt inverts link's dest-exists preflight ("must exist"
 * replaces "must not"), so the host cannot see one directory receiving a
 * second claim — and unlink of either row would delete the other's working
 * tree. The join is where the two ledgers of truth meet; the guard lives here.
 * (Cross-requirement sharing of one workspace dir remains possible by design:
 * ledger rows hold no name snapshots, so no client can see another
 * requirement's claims.)
 */
function adoptableRows(pool: readonly RepoRecord[], dirs: readonly RepoDirScanRow[], linkedIds: ReadonlySet<string>): readonly AdoptableRow[] {
  const linkedDirNames = new Set(pool.filter((repo) => linkedIds.has(repo.id)).map((repo) => repoDirName(repo.name, repo.id)))
  const rows: AdoptableRow[] = []
  for (const dir of dirs) {
    if (!dir.isGitRepo || dir.branch === undefined) continue
    if (linkedDirNames.has(dir.name)) continue
    const matches = pool.filter((repo) => !linkedIds.has(repo.id) && repoDirName(repo.name, repo.id) === dir.name)
    if (matches.length === 0) continue
    let chosen: RepoRecord | undefined = matches.length === 1 ? matches[0] : undefined
    if (chosen === undefined && dir.remoteUrl !== undefined) {
      const byUrl = matches.filter((repo) => repo.urlSsh === dir.remoteUrl || repo.urlHttp === dir.remoteUrl)
      if (byUrl.length === 1) chosen = byUrl[0]
    }
    if (chosen !== undefined) rows.push({ repo: chosen, branch: dir.branch })
  }
  return rows
}

function useReposPool(): [PoolState, () => void] {
  const [state, setState] = useState<PoolState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    void createReposFetcher().list().then((result) => {
      if (cancelled) return
      setState((prev) => {
        // Stale-while-revalidate: a failed RE-pull keeps the last good list
        // serving (linked rows keep their names, the picker keeps offering);
        // only the initial load — with nothing to fall back on — lands in
        // 'error'. Clobbering to 'loading' instead is what made every modal
        // open flash: all linked-row joins collapsed to the removed-repo
        // fallback until the fetch settled.
        if (prev.kind === 'ready' && result.kind !== 'ok') return prev
        return result.kind === 'ok' ? { kind: 'ready', repos: result.repos } : { kind: 'error' }
      })
    })
    return () => { cancelled = true }
  }, [nonce])
  // The picker re-pulls on open: repos added in the pool panel while this tab
  // stays mounted must appear (mount-only fetch would serve a stale list).
  // The refresh only bumps the nonce — the previous snapshot keeps rendering
  // until the fresh one lands, so the swap is invisible (no blank frame).
  return [state, () => { setNonce((n) => n + 1) }]
}

/** Task snapshots with gated 1s polling: runs only while a task is live. */
function useRepoTasks(controller: RequirementsController, requirementId: string): [readonly CloneTaskSnapshot[], (tasks: readonly CloneTaskSnapshot[]) => void] {
  const [tasks, setTasks] = useState<readonly CloneTaskSnapshot[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const pull = useCallback(async (signal?: AbortSignal) => {
    const result = await controller.repoTasks(requirementId, signal)
    if (result !== undefined && result.kind === 'ok') setTasks(result.tasks)
  }, [controller, requirementId])

  useEffect(() => {
    setTasks([])
    const controller$ = new AbortController()
    void pull(controller$.signal)
    return () => controller$.abort()
  }, [pull])

  useEffect(() => {
    const live = tasks.some((task) => task.status === 'cloning' || task.status === 'branching')
    if (!live) {
      if (timerRef.current !== undefined) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
      return
    }
    if (timerRef.current === undefined) {
      timerRef.current = setInterval(() => void pull(), 1000)
    }
    return () => {
      if (timerRef.current !== undefined) {
        clearInterval(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [tasks, pull])

  // The seed channel breaks the liveness deadlock: mutation responses carry
  // fresh task rows that must enter the state NOW, or the interval gate
  // (live = some task non-terminal) never opens and polling never starts.
  return [tasks, setTasks as (tasks: readonly CloneTaskSnapshot[]) => void]
}

export function ReposSection(props: {
  t: RequirementsT
  requirement: RequirementRecord
  controller: RequirementsController
  capabilities: WorkspaceCapabilities
}): ReactNode {
  const { t, requirement, controller } = props
  const caps = useSyncExternalStore(props.capabilities.store.subscribe, props.capabilities.store.getSnapshot)
  const [pool, refreshPool] = useReposPool()
  const [tasks, seedTasks] = useRepoTasks(controller, requirement.id)
  const [scan, refreshScan] = useRepoScan(controller, requirement.id, requirement.workspacePath)
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const [branch, setBranch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [adoptError, setAdoptError] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<{ repoId: string; name: string; repoName?: string } | null>(null)

  const linkedIds = new Set(requirement.linkedRepos.map((linked) => linked.repoId))
  const taskByRepo = new Map(tasks.map((task) => [task.repoId, task]))
  const adoptable = pool.kind === 'ready' && scan.kind === 'ready'
    ? adoptableRows(pool.repos, scan.dirs, linkedIds)
    : []
  // SWR edge: a selection made against the stale snapshot must retire when
  // the fresh list lands without that repo — the row vanishes, and an armed
  // footer button whose submit can only no-op is a silent dead end.
  useEffect(() => {
    if (pool.kind === 'ready' && selection !== null && !pool.repos.some((repo) => repo.id === selection.repoId)) {
      setSelection(null)
    }
  }, [pool, selection])
  // Destructive-action gate: unlink deletes the cloned source, so it always
  // rides behind a confirmation dialog (the delete-requirement pattern).
  const confirmDialog = pendingRemove !== null ? (
    <Modal
      open
      onClose={() => setPendingRemove(null)}
      title={`${t('repos.removeTitle')} — ${pendingRemove.name}`}
      closeLabel={t('form.closeLabel')}
      description={t('repos.removeDesc')}
      footer={(
        <>
          <Button variant="ghost" onClick={() => setPendingRemove(null)}>{t('repos.removeCancel')}</Button>
          <Button variant="primary" className={styles.dangerButton} onClick={() => void confirmRemove()}>
            {t('repos.removeConfirm')}
          </Button>
        </>
      )}
    />
  ) : null

  // Reverse-link discovery strip, rendered in BOTH states (empty and
  // populated) — a lost ledger with surviving clones is precisely the
  // empty-state case. Adopt is one click, no clone, no confirmation: the
  // action only writes a row and its undo (unlink) asks before deleting.
  const discoveryStrip = adoptable.length > 0 ? (
    <div className={styles.discoverBlock}>
      <div className={styles.discoverTitle}>{t('repos.scanTitle')}</div>
      <div className={styles.discoverHint}>{t('repos.scanHint')}</div>
      {adoptable.map((row) => (
        <div key={row.repo.id} className={styles.discoverRow}>
          <span className={styles.repoName}>{row.repo.name}</span>
          <span className={styles.repoBranch}>{row.branch}</span>
          <Button
            variant="ghost"
            size="sm"
            className={styles.discoverAdopt}
            disabled={adoptingId !== null}
            onClick={() => void adopt(row.repo)}
          >
            {t('repos.adopt')}
          </Button>
        </div>
      ))}
      {adoptError !== null ? <div className={styles.fieldError}>{adoptError}</div> : null}
    </div>
  ) : null

  const openModal = (): void => {
    setFilter('')
    setSelection(null)
    // Branch carry-over: a requirement that already holds links continues on
    // its LAST link's branch (append order = recency); the minted prefix
    // seeds only the first link.
    const last = requirement.linkedRepos[requirement.linkedRepos.length - 1]
    setBranch(last !== undefined ? last.branch : `req-${requirement.id.slice(0, 8)}`)
    setInlineError(null)
    refreshPool()
    setModalOpen(true)
  }

  const adopt = async (repo: RepoRecord): Promise<void> => {
    setAdoptingId(repo.id)
    setAdoptError(null)
    const outcome = await controller.adoptRepo(requirement.id, { repoId: repo.id, repoName: repo.name })
    setAdoptingId(null)
    if (outcome.kind === 'ok') {
      // The store patch re-renders the section with the new ledger row — the
      // strip row retires through linkedIds. No clone is spawned; the seeded
      // (unchanged) task rows just keep the snapshot honest.
      seedTasks(outcome.tasks)
      return
    }
    if (outcome.kind === 'inline') setAdoptError(t(INLINE_ERROR_KEYS[outcome.code]))
    // 'failed': the banner behind the section explains.
  }

  // Name-row click: select the repo on its RECOMMENDED address (the
  // pickAddress ordering) — also the only deselect path (toggle). Address-line
  // click: pin that slot. Re-selecting another repo carries no stale slot.
  const selectRepo = (repoId: string): void => {
    if (selection !== null && selection.repoId === repoId) {
      setSelection(null)
      return
    }
    if (pool.kind !== 'ready') return
    const repo = pool.repos.find((candidate) => candidate.id === repoId)
    const recommended = repo !== undefined ? pickAddress(repo) : undefined
    if (recommended === undefined) return // the record guard guarantees ≥1 address; defensive
    setSelection({ repoId, slot: recommended.slot })
  }

  const selectAddress = (repoId: string, slot: AddressSlot): void => {
    setSelection({ repoId, slot })
  }

  const submit = async (): Promise<void> => {
    if (selection === null || pool.kind !== 'ready') return
    const repo = pool.repos.find((candidate) => candidate.id === selection.repoId)
    if (repo === undefined) return
    setSubmitting(true)
    // The snapshot rides the chosen slot; if that slot vanished from the pool
    // (unreachable today — the pool re-pulls only on open — belt-and-braces
    // should push refresh ever land), fall back to the current recommendation.
    const repoUrl = (selection.slot === 'ssh' ? repo.urlSsh : repo.urlHttp)
      ?? pickAddress(repo)?.url
      ?? ''
    const outcome = await controller.linkRepo(requirement.id, { repoId: repo.id, repoUrl, repoName: repo.name }, branch.trim())
    setSubmitting(false)
    if (outcome.kind === 'ok') {
      // Seed the fresh rows (cloning state visible immediately); the gate
      // effect picks them up and starts the 1s poll.
      seedTasks(outcome.tasks)
      setModalOpen(false)
      return
    }
    if (outcome.kind === 'inline') {
      setInlineError(t(INLINE_ERROR_KEYS[outcome.code]))
    }
    // 'failed': the banner behind the dialog explains.
  }

  const revealDir = async (repo: { name: string; id: string }): Promise<void> => {
    if (caps.opener === undefined) return
    const path = `${requirement.workspacePath}/repos/${repoDirName(repo.name, repo.id)}`
    await caps.opener.openWorkspacePath({ path, action: 'reveal' }).catch(() => {})
  }

  const reclone = async (repo: RepoRecord): Promise<void> => {
    const outcome = await controller.recloneRepo(requirement.id, { repoId: repo.id, repoUrl: pickAddress(repo)?.url ?? '', repoName: repo.name })
    if (outcome.kind === 'ok') seedTasks(outcome.tasks)
  }

  const cancelClone = async (repoId: string): Promise<void> => {
    const outcome = await controller.cancelRepoClone(requirement.id, repoId)
    if (outcome.kind === 'ok') seedTasks(outcome.tasks)
  }

  const confirmRemove = async (): Promise<void> => {
    if (pendingRemove === null) return
    const { repoId, repoName } = pendingRemove
    setPendingRemove(null)
    const outcome = await controller.unlinkRepo(requirement.id, repoId, repoName)
    // Unlink DELETED a repos/ directory: the scan snapshot is stale the moment
    // this succeeds, and a stale row would re-offer the just-removed repo as
    // an adopt that can only fail (dest-missing). Rescan is the honest sync.
    if (outcome.kind === 'ok') {
      seedTasks(outcome.tasks)
      refreshScan()
    }
  }

  if (requirement.linkedRepos.length === 0) {
    return (
      <div className={styles.repoSection}>
        <div className={styles.sectionTitle}>{t('workspace.sectionRepos')}</div>
        <button type="button" className={styles.repoAddCard} aria-label={t('repos.add')} onClick={openModal}>
          <IconPlusOutline16 size={16} />
          <span className={styles.setupHint}>{t('repos.emptyHint')}</span>
          <span className={styles.setupAction}>{t('repos.add')}</span>
        </button>
        {discoveryStrip}
        {modalOpen ? (
          <AddRepoModal
            t={t}
            pool={pool}
            filter={filter}
            branch={branch}
            submitting={submitting}
            inlineError={inlineError}
            linkedIds={linkedIds}
            selection={selection}
            onFilterChange={setFilter}
            onBranchChange={(value) => { setBranch(value); setInlineError(null) }}
            onSelectRepo={selectRepo}
            onSelectAddress={selectAddress}
            onCancel={() => setModalOpen(false)}
            onSubmit={() => void submit()}
          />
        ) : null}
        {confirmDialog}
      </div>
    )
  }

  return (
    <div className={styles.repoSection}>
      <div className={styles.repoSectionHead}>
        <div className={styles.sectionTitle}>{t('workspace.sectionRepos')}</div>
        <Button variant="ghost" size="sm" icon={<IconPlusOutline16 size={16} />} onClick={openModal}>
          {t('repos.add')}
        </Button>
      </div>
      {requirement.linkedRepos.map((linked) => {
        const repo = pool.kind === 'ready' ? pool.repos.find((candidate) => candidate.id === linked.repoId) : undefined
        const task = taskByRepo.get(linked.repoId)
        const name = repo?.name ?? t('repos.removedRepo')
        const entries: readonly MenuEntry[] = [
          { id: 'open', label: t('workspace.open'), disabled: repo === undefined },
          { id: 'reclone', label: t('repos.reclone'), disabled: repo === undefined || (task !== undefined && (task.status === 'cloning' || task.status === 'branching')) },
          ...(task !== undefined && (task.status === 'cloning' || task.status === 'branching')
            ? [{ id: 'cancel', label: t('repos.cancel') }]
            : []),
          { id: 'unlink', label: t('repos.removeLink'), danger: true },
        ]
        return (
          <div key={linked.repoId} className={styles.repoRow}>
            <div className={styles.repoMain}>
              {/* Name + branch only — the addresses are picker concerns; a
                  linked row's URL snapshot is ledger-invisible anyway. */}
              <span className={styles.repoName}>{name}</span>
              <span className={styles.repoBranch}>{linked.branch}</span>
            </div>
            <div className={styles.repoStatus}>
              {taskStatus(t, task)}
            </div>
            <RowMenu
              t={t}
              entries={entries}
              name={name}
              onOpen={() => repo !== undefined ? void revealDir(repo) : undefined}
              onReclone={() => repo !== undefined ? void reclone(repo) : undefined}
              onCancel={() => void cancelClone(linked.repoId)}
              onUnlink={() => setPendingRemove({ repoId: linked.repoId, name, repoName: repo?.name })}
            />
          </div>
        )
      })}
      {discoveryStrip}
      {modalOpen ? (
        <AddRepoModal
          t={t}
          pool={pool}
          filter={filter}
          branch={branch}
          submitting={submitting}
          inlineError={inlineError}
          linkedIds={linkedIds}
          selection={selection}
          onFilterChange={setFilter}
          onBranchChange={(value) => { setBranch(value); setInlineError(null) }}
          onSelectRepo={selectRepo}
          onSelectAddress={selectAddress}
          onCancel={() => setModalOpen(false)}
          onSubmit={() => void submit()}
        />
      ) : null}
      {confirmDialog}
    </div>
  )
}

function taskStatus(t: RequirementsT, task: CloneTaskSnapshot | undefined): ReactNode {
  if (task === undefined || task.status === 'done') return null
  if (task.status === 'cloning') {
    return (
      <>
        <StateDot state="ongoing" />
        <span>{t('repos.cloning')}{task.progressPct !== undefined ? ` ${task.progressPct}%` : ''}</span>
      </>
    )
  }
  if (task.status === 'branching') {
    return (
      <>
        <StateDot state="ongoing" />
        <span>{t('repos.branching')}</span>
      </>
    )
  }
  if (task.failureClass === 'aborted') {
    return (
      <>
        <StateDot state="idle" />
        <span>{t('repos.cancelled')}</span>
      </>
    )
  }
  const label = task.failureClass === 'auth'
    ? t('repos.failAuth')
    : task.failureClass === 'network'
      ? t('repos.failNetwork')
      : task.failureClass === 'git-missing'
        ? t('repos.failGitMissing')
        : t('repos.failedTag')
  return (
    <span title={task.detail ?? undefined}>
      <StateDot state="error" />
      <span>{label}</span>
    </span>
  )
}

/** Inline error copy per preflight rejection code (typed map, not a template key). */
const INLINE_ERROR_KEYS: Readonly<Record<'no-workspace' | 'invalid-branch' | 'dest-exists' | 'dest-missing' | 'no-branch' | 'busy' | 'too-many' | 'git-missing' | 'bad-request', Parameters<RequirementsT>[0]>> = {
  'no-workspace': 'repos.errNoWorkspace',
  'invalid-branch': 'repos.errInvalidBranch',
  'dest-exists': 'repos.errDestExists',
  'dest-missing': 'repos.errDestMissing',
  'no-branch': 'repos.errNoBranch',
  busy: 'repos.errBusy',
  'too-many': 'repos.errTooMany',
  'git-missing': 'repos.errGitMissing',
  // Defensive only (duplicate links are disabled in the picker); the wire
  // guard that fires here is the branch sanity regex — closest copy.
  'bad-request': 'repos.errInvalidBranch',
}

/** Owner-controlled ⋯ menu (the repos-pool row pattern). */
function RowMenu(props: {
  t: RequirementsT
  entries: readonly MenuEntry[]
  name: string
  onOpen: () => void
  onReclone: () => void
  onCancel: () => void
  onUnlink: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={props.entries}
      portal
      closeOnPointerLeave
      onSelect={(id) => {
        setOpen(false)
        if (id === 'open') props.onOpen()
        if (id === 'reclone') props.onReclone()
        if (id === 'cancel') props.onCancel()
        if (id === 'unlink') props.onUnlink()
      }}
      anchor={(
        <button type="button" className={styles.iconButton} aria-label={props.t('repos.menuLabel')} title={props.name} onClick={() => setOpen(true)}>
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}

function AddRepoModal(props: {
  t: RequirementsT
  pool: PoolState
  filter: string
  branch: string
  submitting: boolean
  inlineError: string | null
  linkedIds: ReadonlySet<string>
  selection: Selection
  onFilterChange: (value: string) => void
  onBranchChange: (value: string) => void
  onSelectRepo: (repoId: string) => void
  onSelectAddress: (repoId: string, slot: AddressSlot) => void
  onCancel: () => void
  onSubmit: () => void
}): ReactNode {
  const { t, pool } = props
  const candidates = pool.kind === 'ready'
    ? pool.repos.filter((repo) => !props.linkedIds.has(repo.id))
    : []
  // A hit on EITHER address keeps the row (the repos-pool view.tsx pattern);
  // description stays out — the row never shows it, so a hit would be
  // unexplainable.
  const visible = candidates.filter((repo) =>
    props.filter.trim().length === 0
    || repo.name.toLowerCase().includes(props.filter.trim().toLowerCase())
    || (repo.urlSsh?.toLowerCase().includes(props.filter.trim().toLowerCase()) ?? false)
    || (repo.urlHttp?.toLowerCase().includes(props.filter.trim().toLowerCase()) ?? false))
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={t('repos.selectRepo')}
      closeLabel={t('form.closeLabel')}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onCancel}>{t('form.cancel')}</Button>
          <Button
            variant="primary"
            icon={<IconPlusOutline16 size={16} />}
            disabled={props.submitting || props.selection === null}
            onClick={props.onSubmit}
          >
            {props.submitting ? t('form.submitting') : t('repos.link')}
          </Button>
        </>
      )}
    >
      <div className={styles.formBody}>
        <Input
          value={props.filter}
          placeholder={t('view.filterPlaceholder')}
          onChange={(event) => props.onFilterChange(event.target.value)}
        />
        <div className={styles.poolList}>
          {pool.kind === 'error' ? <div className={styles.fieldError}>{t('repos.poolError')}</div> : null}
          {pool.kind === 'ready' && visible.length === 0 && candidates.length === 0
            ? <div className={styles.setupHint}>{t('repos.emptyPool')}</div>
            : null}
          {visible.map((repo) => {
            const slots = rowSlots(repo)
            const recommended = pickAddress(repo)?.slot
            const rowSelected = props.selection?.repoId === repo.id
            const rowClass = rowSelected ? `${styles.poolRow} ${styles.poolRowSelected}` : styles.poolRow
            if (slots.length <= 1) {
              // Single-address rows keep the one whole-row button: nothing to
              // switch, and the common case keeps today's click-anywhere
              // interaction.
              const slot = slots[0]
              return (
                <button key={repo.id} type="button" className={rowClass} onClick={() => props.onSelectRepo(repo.id)}>
                  <span className={styles.poolName}>{repo.name}</span>
                  {slot !== undefined ? (
                    <span className={styles.poolAddrLine}>
                      <span className={styles.poolSlotLabel}>{slot.label}</span>
                      <span className={styles.repoUrl}>{slot.url}</span>
                      <Tag tone={STATUS_TAG_TONE[slot.status]}>{t(STATUS_KEY[slot.status])}</Tag>
                    </span>
                  ) : null}
                </button>
              )
            }
            // Dual-address rows: the row is a div — the name button and one
            // button per address are SIBLINGS (a button cannot nest buttons;
            // the linked-row div + RowMenu-button precedent).
            return (
              <div key={repo.id} className={`${rowClass} ${styles.poolRowDual}`}>
                <button type="button" className={styles.poolRepoBtn} onClick={() => props.onSelectRepo(repo.id)}>
                  <span className={styles.poolName}>{repo.name}</span>
                </button>
                {slots.map((slot) => {
                  const picked = rowSelected && props.selection?.slot === slot.slot
                  return (
                    <button
                      key={slot.slot}
                      type="button"
                      className={picked ? `${styles.poolAddrBtn} ${styles.poolAddrSelected}` : styles.poolAddrBtn}
                      onClick={() => props.onSelectAddress(repo.id, slot.slot)}
                    >
                      <span className={styles.poolSlotLabel}>{slot.label}</span>
                      <span className={styles.repoUrl}>{slot.url}</span>
                      <Tag tone={STATUS_TAG_TONE[slot.status]}>{t(STATUS_KEY[slot.status])}</Tag>
                      {recommended === slot.slot && !picked ? (
                        <span className={styles.poolRecBadge}>{t('repos.recommended')}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <label className={styles.fieldLabel}>
          {t('repos.branchLabel')}
          <Input value={props.branch} spellCheck={false} onChange={(event) => props.onBranchChange(event.target.value)} />
        </label>
        {props.inlineError !== null ? <div className={styles.fieldError}>{props.inlineError}</div> : null}
      </div>
    </Modal>
  )
}
