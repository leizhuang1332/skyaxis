/**
 * Linked repositories section (P3b): pool picker dialog → clone task rows
 * with live progress polling → row menus (reveal / re-clone / cancel /
 * unlink).
 *
 * Local state throughout (the status precedent — nothing here enters the
 * page store): task snapshots, the pool list, and the dialog. Polling runs
 * only while a non-terminal task exists (1s interval, the pull-only channel;
 * cleared on unmount, in-flight fetch aborted).
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
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { createReposFetcher } from '../repos-pool/fetcher.js'
import type { RepoRecord } from '../../repos-pool-shared/protocol.js'
import type { CloneTaskSnapshot, RequirementRecord } from '../../requirements-shared/protocol.js'
import { repoDirName } from '../../requirements-shared/repo-dir.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import type { WorkspaceCapabilities } from './workspace-tab.js'
import styles from './view.module.css'

type PoolState =
  | { kind: 'loading' }
  | { kind: 'ready'; repos: readonly RepoRecord[] }
  | { kind: 'error' }

function useReposPool(): [PoolState, () => void] {
  const [state, setState] = useState<PoolState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    void createReposFetcher().list().then((result) => {
      if (cancelled) return
      setState(result.kind === 'ok' ? { kind: 'ready', repos: result.repos } : { kind: 'error' })
    })
    return () => { cancelled = true }
  }, [nonce])
  // The picker re-pulls on open: repos added in the pool panel while this tab
  // stays mounted must appear (mount-only fetch would serve a stale list).
  return [state, () => { setState({ kind: 'loading' }); setNonce((n) => n + 1) }]
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
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<{ repoId: string; name: string; repoName?: string } | null>(null)

  const linkedIds = new Set(requirement.linkedRepos.map((linked) => linked.repoId))
  const taskByRepo = new Map(tasks.map((task) => [task.repoId, task]))
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

  const openModal = (): void => {
    setFilter('')
    setSelectedRepoId(null)
    setBranch(`req-${requirement.id.slice(0, 8)}`)
    setInlineError(null)
    refreshPool()
    setModalOpen(true)
  }

  const submit = async (): Promise<void> => {
    if (selectedRepoId === null || pool.kind !== 'ready') return
    const repo = pool.repos.find((candidate) => candidate.id === selectedRepoId)
    if (repo === undefined) return
    setSubmitting(true)
    const outcome = await controller.linkRepo(requirement.id, { repoId: repo.id, repoUrl: repo.url, repoName: repo.name }, branch.trim())
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
    const outcome = await controller.recloneRepo(requirement.id, { repoId: repo.id, repoUrl: repo.url, repoName: repo.name })
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
    if (outcome.kind === 'ok') seedTasks(outcome.tasks)
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
        {modalOpen ? (
          <AddRepoModal
            t={t}
            pool={pool}
            filter={filter}
            branch={branch}
            submitting={submitting}
            inlineError={inlineError}
            linkedIds={linkedIds}
            selectedRepoId={selectedRepoId}
            onFilterChange={setFilter}
            onBranchChange={(value) => { setBranch(value); setInlineError(null) }}
            onSelect={setSelectedRepoId}
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
              <span className={styles.repoName}>{name}</span>
              {repo !== undefined ? <span className={styles.repoUrl}>{repo.url}</span> : null}
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
      {modalOpen ? (
        <AddRepoModal
          t={t}
          pool={pool}
          filter={filter}
          branch={branch}
          submitting={submitting}
          inlineError={inlineError}
          linkedIds={linkedIds}
          selectedRepoId={selectedRepoId}
          onFilterChange={setFilter}
          onBranchChange={(value) => { setBranch(value); setInlineError(null) }}
          onSelect={setSelectedRepoId}
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
const INLINE_ERROR_KEYS: Readonly<Record<'no-workspace' | 'invalid-branch' | 'dest-exists' | 'busy' | 'too-many' | 'git-missing' | 'bad-request', Parameters<RequirementsT>[0]>> = {
  'no-workspace': 'repos.errNoWorkspace',
  'invalid-branch': 'repos.errInvalidBranch',
  'dest-exists': 'repos.errDestExists',
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
  selectedRepoId: string | null
  onFilterChange: (value: string) => void
  onBranchChange: (value: string) => void
  onSelect: (id: string | null) => void
  onCancel: () => void
  onSubmit: () => void
}): ReactNode {
  const { t, pool } = props
  const candidates = pool.kind === 'ready'
    ? pool.repos.filter((repo) => !props.linkedIds.has(repo.id))
    : []
  const visible = candidates.filter((repo) =>
    props.filter.trim().length === 0
    || repo.name.toLowerCase().includes(props.filter.trim().toLowerCase())
    || repo.url.toLowerCase().includes(props.filter.trim().toLowerCase()))
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
            disabled={props.submitting || props.selectedRepoId === null}
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
          {visible.map((repo) => (
            <button
              key={repo.id}
              type="button"
              className={repo.id === props.selectedRepoId ? `${styles.poolRow} ${styles.poolRowSelected}` : styles.poolRow}
              onClick={() => props.onSelect(repo.id === props.selectedRepoId ? null : repo.id)}
            >
              <span className={styles.poolName}>{repo.name}</span>
              <span className={styles.repoUrl}>{repo.url}</span>
            </button>
          ))}
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
