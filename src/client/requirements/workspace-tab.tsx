/**
 * Workspace tab seat (0003 P3a): bind a host workspace directory to the
 * requirement — set (dialog with a host-suggested default, manual input, and
 * the OS directory picker when the composition provides one), inline path
 * editing, live directory status, reveal in file manager, unbind.
 *
 * Dependencies ride the seats-factory closure (the t pattern): the owner prop
 * carries only the live record. Remote faces (picker / session opener) are
 * OPTIONAL capabilities owned by register.tsx's inject scopes — the tab core
 * (manual input + status) only needs skyaxis's own HTTP endpoints, so the
 * seat itself registers unconditionally; buttons appear when the services do.
 *
 * Tab-internal state is component-local on purpose (requirement-form
 * precedent): short-lived, no outside readers.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconFolderOpenOutline16, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import type { WorkspaceStatusResult } from './fetcher.js'
import { ReposSection } from './repos-section.js'
import styles from './view.module.css'

/** Type-only faces off the remotes client assembly (never value-imported). */
export type DirectoryPickerFace = ClientRemote['directoryPicker']
export type SessionOpenerFace = ClientRemote['session']

type WorkspaceStatusOk = Extract<WorkspaceStatusResult, { kind: 'ok' }>

/**
 * Capability holder for the optional remote faces. A snapshot store (the tab
 * ledger pattern) so buttons appear reactively when a service arrives late —
 * a plain mutable object cannot do that.
 */
export function createWorkspaceCapabilities() {
  const store = createSnapshotStore<{ readonly picker?: DirectoryPickerFace; readonly opener?: SessionOpenerFace }>(
    {},
    { flush: 'raf' },
  )
  return {
    store,
    setPicker: (picker: DirectoryPickerFace | undefined): void => {
      store.set({ ...store.getSnapshot(), picker })
    },
    setOpener: (opener: SessionOpenerFace | undefined): void => {
      store.set({ ...store.getSnapshot(), opener })
    },
  }
}

export type WorkspaceCapabilities = ReturnType<typeof createWorkspaceCapabilities>

export function WorkspaceTabBody(props: {
  t: RequirementsT
  requirement: RequirementRecord
  controller: RequirementsController
  capabilities: WorkspaceCapabilities
}): ReactNode {
  const { t, requirement, controller } = props
  const caps = useSyncExternalStore(props.capabilities.store.subscribe, props.capabilities.store.getSnapshot)

  const [status, setStatus] = useState<WorkspaceStatusOk | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [pickerBroken, setPickerBroken] = useState(false)
  const [editing, setEditing] = useState<{ draft: string } | null>(null)
  // Short-circuits the blur handler right after Enter committed — the editor
  // unmounts, but the teardown blur must not cancel an already-sent mutation.
  const committedRef = useRef(false)

  const bound = requirement.workspacePath !== ''

  const pullStatus = async (): Promise<void> => {
    const result = await controller.workspaceStatus(requirement.id)
    if (result !== undefined && result.kind === 'ok') setStatus(result)
  }
  useEffect(() => {
    setStatus(undefined)
    void pullStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.id])

  const openModal = (): void => {
    setPathDraft(bound ? requirement.workspacePath : (status?.suggestedPath ?? ''))
    setInlineError(null)
    setModalOpen(true)
  }

  const submitModal = async (): Promise<void> => {
    const path = pathDraft.trim()
    if (path.length === 0) {
      setInlineError(t('workspace.invalidPath'))
      return
    }
    setSubmitting(true)
    const outcome = await controller.setWorkspace(requirement.id, path)
    setSubmitting(false)
    if (outcome === 'ok') {
      setModalOpen(false)
      setInlineError(null)
      void pullStatus()
    } else if (outcome === 'invalid-path') {
      setInlineError(t('workspace.invalidPath'))
    }
    // 'failed' keeps the dialog mounted — the banner behind explains.
  }

  const pickDirectory = async (): Promise<void> => {
    if (caps.picker === undefined) return
    const result = await caps.picker.pick()
    if (result.ok) {
      if (result.value !== null) {
        setPathDraft(result.value)
        setInlineError(null)
      }
      // null = user cancelled the native dialog; stay silent.
    } else if (result.error.code === 'directory-picker/unavailable') {
      setPickerBroken(true)
    }
    // Other remote errors stay silent — environmental facts, not form errors.
  }

  const commitInlineEdit = async (): Promise<void> => {
    if (editing === null) return
    const path = editing.draft.trim()
    if (path.length === 0 || path === requirement.workspacePath) {
      setEditing(null)
      return
    }
    committedRef.current = true
    const outcome = await controller.setWorkspace(requirement.id, path)
    if (outcome === 'ok') {
      setEditing(null)
      void pullStatus()
    } else if (outcome === 'invalid-path') {
      setInlineError(t('workspace.invalidPath'))
      committedRef.current = false
      return
    }
    // 'failed' collapses the editor; the banner explains.
    setEditing(null)
    committedRef.current = false
  }

  const [canOpen, setCanOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (caps.opener === undefined) {
      setCanOpen(false)
      return () => { cancelled = true }
    }
    void caps.opener.canOpenWorkspacePath().then((result) => {
      if (!cancelled) setCanOpen(result.ok && result.value === true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [caps.opener])

  const openDirectory = async (): Promise<void> => {
    if (caps.opener === undefined) return
    await caps.opener.openWorkspacePath({ path: requirement.workspacePath, action: 'reveal' }).catch(() => {})
    // Reveal failures are silent (nativeOpen config is an environment fact).
  }

  const unbind = async (): Promise<void> => {
    // No confirmation: reversible (re-binding the same path is idempotent),
    // never touches disk. The title attribute carries the hint.
    await controller.clearWorkspace(requirement.id)
    void pullStatus()
  }

  const rebind = async (): Promise<void> => {
    // Registry-only repair (the host row was deleted host-side — deletion
    // never touched the directory or the ledger). Idempotent and harmless
    // when the registration somehow still exists.
    const outcome = await controller.rebindWorkspace(requirement.id)
    if (outcome === 'ok') void pullStatus()
  }

  if (!bound) {
    return (
      <div className={styles.workspaceTab}>
        {/* The unbound state is ONE action card (the addCard language): dashed
            slot border, the whole card is the button. aria-label names the
            action — the visible text is a multi-part composition. */}
        <button
          type="button"
          className={styles.setupCard}
          aria-label={t('workspace.setUp')}
          onClick={openModal}
        >
          <IconFolderOpenOutline16 size={16} />
          <span className={styles.setupHint}>{t('workspace.emptyHint')}</span>
          <span className={styles.setupAction}>{t('workspace.setUp')}</span>
        </button>
        <GuideSection title={t('workspace.sectionRepos')} hint={t('workspace.sectionReposHint')} />
        <GuideSection title={t('workspace.sectionPrd')} hint={t('workspace.sectionPrdHint')} />
        {modalOpen ? (
          <WorkspaceSetupModal
            t={t}
            pathDraft={pathDraft}
            submitting={submitting}
            inlineError={inlineError}
            pickerAvailable={caps.picker !== undefined && !pickerBroken}
          pickerNote={pickerBroken ? t('workspace.pickerUnavailable') : null}
            onPathDraftChange={(value) => { setPathDraft(value); setInlineError(null) }}
            onBrowse={() => void pickDirectory()}
            onCancel={() => setModalOpen(false)}
            onSubmit={() => void submitModal()}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.workspaceTab}>
      <div className={styles.workspaceSection}>
        <div className={styles.sectionTitle}>{t('workspace.pathLabel')}</div>
        <div className={styles.workspacePathRow}>
          {editing === null ? (
            <button
              type="button"
              className={styles.pathText}
              onClick={() => { setInlineError(null); setEditing({ draft: requirement.workspacePath }) }}
            >
              {requirement.workspacePath}
            </button>
          ) : (
            <input
              className={styles.pathEditor}
              value={editing.draft}
              autoFocus
              spellCheck={false}
              onChange={(event) => setEditing({ draft: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(null)
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void commitInlineEdit()
              }}
              onBlur={() => {
                if (committedRef.current) return
                setEditing(null)
              }}
            />
          )}
          {editing === null ? (
            status === undefined ? null : (
              <Tag tone={status.directoryExists && status.registered ? 'success' : 'warning'}>
                {!status.directoryExists
                  ? t('workspace.tagMissing')
                  : (status.registered ? t('workspace.tagOk') : t('workspace.tagUnregistered'))}
              </Tag>
            )
          ) : null}
          {editing === null && status !== undefined && status.directoryExists && !status.registered ? (
            <Button variant="ghost" size="sm" onClick={() => void rebind()} title={t('workspace.rebindHint')}>
              {t('workspace.rebind')}
            </Button>
          ) : null}
          {editing === null && canOpen ? (
            <Button variant="ghost" size="sm" icon={<IconFolderOpenOutline16 size={16} />} onClick={() => void openDirectory()}>
              {t('workspace.open')}
            </Button>
          ) : null}
          {editing === null ? (
            <Button variant="ghost" size="sm" onClick={() => void unbind()} title={t('workspace.unbindHint')}>
              {t('workspace.unbind')}
            </Button>
          ) : null}
        </div>
        {inlineError !== null && editing !== null ? <div className={styles.fieldError}>{inlineError}</div> : null}
      </div>
      <ReposSection t={t} requirement={requirement} controller={controller} capabilities={props.capabilities} />
      <GuideSection title={t('workspace.sectionPrd')} hint={t('workspace.sectionPrdHint')} />
      {modalOpen ? (
        <WorkspaceSetupModal
          t={t}
          pathDraft={pathDraft}
          submitting={submitting}
          inlineError={inlineError}
          pickerAvailable={caps.picker !== undefined && !pickerBroken}
          pickerNote={pickerBroken ? t('workspace.pickerUnavailable') : null}
          onPathDraftChange={(value) => { setPathDraft(value); setInlineError(null) }}
          onBrowse={() => void pickDirectory()}
          onCancel={() => setModalOpen(false)}
          onSubmit={() => void submitModal()}
        />
      ) : null}
    </div>
  )
}

function GuideSection(props: { title: string; hint: string }): ReactNode {
  return (
    <div className={styles.guideSection}>
      <div className={styles.guideTitle}>{props.title}</div>
      <div className={styles.guideHint}>{props.hint}</div>
    </div>
  )
}

function WorkspaceSetupModal(props: {
  t: RequirementsT
  pathDraft: string
  submitting: boolean
  inlineError: string | null
  pickerAvailable: boolean
  pickerNote: string | null
  onPathDraftChange: (value: string) => void
  onBrowse: () => void
  onCancel: () => void
  onSubmit: () => void
}): ReactNode {
  const { t } = props
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={t('workspace.setUp')}
      closeLabel={t('form.closeLabel')}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onCancel}>{t('form.cancel')}</Button>
          <Button
            variant="primary"
            icon={<IconFolderOpenOutline16 size={16} />}
            disabled={props.submitting}
            onClick={props.onSubmit}
          >
            {props.submitting ? t('form.submitting') : t('form.submit')}
          </Button>
        </>
      )}
    >
      <div className={styles.formBody}>
        <label className={styles.fieldLabel}>
          {t('workspace.pathLabel')}
          <Input value={props.pathDraft} spellCheck={false} onChange={(event) => props.onPathDraftChange(event.target.value)} />
        </label>
        {props.pickerAvailable ? (
          <Button variant="outline" size="sm" onClick={props.onBrowse}>{t('workspace.browse')}</Button>
        ) : null}
        {props.pickerNote !== null ? <div className={styles.fieldError}>{props.pickerNote}</div> : null}
        {props.inlineError !== null ? <div className={styles.fieldError}>{props.inlineError}</div> : null}
      </div>
    </Modal>
  )
}

/** Seat wiring for detail-tabs.tsx (owner prop = live record; rest via closure). */
export function createWorkspaceTabSeat(options: {
  t: RequirementsT
  controller: RequirementsController
  capabilities: WorkspaceCapabilities
}): (props: PropsRuntime<'requirements.detail.view'>) => ReactNode {
  return (props) => <WorkspaceTabBody {...options} requirement={props.requirement} />
}
