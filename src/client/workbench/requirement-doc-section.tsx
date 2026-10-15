/**
 * S1 requirement-baseline-doc face (0008 需求基线文档轮) — the consolidated
 * requirement document (`.skyaxis/requirements/<requirementId>.md`) shows on
 * the page as a FILE ROW with a click-to-preview modal, the report-section
 * twin (which is itself the prd-section twin — the repo's per-document-surface
 * copy convention; three faces now, the generic-WorkspaceDocSection extraction
 * stays deferred until a fourth). Mount fetch is EXISTENCE-only; every modal
 * open re-reads (the refresh path); tamper compare rides
 * understandBaseline.docHash (present + ≠ disk ⇒ warning, never block).
 * The direct file path stays disclosed on the row (ADR 0005 导出承诺口径).
 *
 * Keyed by requirementId at the render site.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileTypeIcon, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { requirementDocRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import styles from './view.module.css'

/** Row/modal display name — a readable stand-in for the uuid file name. */
const docDisplayName = (requirementId: string): string => `requirements/${requirementId.slice(0, 8)}.md`

/** The existence face the ROW needs (the modal re-reads for the body itself). */
type RowState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'missing' }
  | { kind: 'error' }

export function RequirementDocSection(props: {
  t: WorkbenchT
  controller: WorkbenchController
  requirementId: string
  /** Bound workspace root ('' = unbound — no file channel, honest hint). */
  workspacePath: string
}): ReactNode {
  const { t, controller, requirementId, workspacePath } = props
  const [state, setState] = useState<RowState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (workspacePath === '') return
    setState({ kind: 'loading' })
    const abort = new AbortController()
    void controller.requirementDocContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result === undefined) {
        setState({ kind: 'error' })
        return
      }
      if (result.kind === 'ok') {
        setState({ kind: 'ready' })
        return
      }
      // 404 = the honest missing state (no consolidation session has written
      // the doc yet); every other failure is the error state with retry.
      setState(result.kind === 'http-error' && result.status === 404 ? { kind: 'missing' } : { kind: 'error' })
    })
    return () => { abort.abort() }
  }, [controller, requirementId, workspacePath, nonce])

  if (workspacePath === '') {
    return (
      <div className={styles.findingSection}>
        <div className={styles.sectionTitle}>{t('baseline.title')}</div>
        <div className={styles.formHint}>{t('baseline.noWorkspace')}</div>
      </div>
    )
  }

  const name = docDisplayName(requirementId)

  return (
    <div className={styles.findingSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('baseline.title')}</div>
        {state.kind === 'missing' || state.kind === 'error' ? (
          <button type="button" className={styles.ghostButton} onClick={() => { setNonce(nonce + 1) }}>{t('baseline.refresh')}</button>
        ) : null}
      </div>
      {state.kind === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state.kind === 'ready' ? (
        <button
          type="button"
          className={styles.reportRowMain}
          aria-label={`${t('baseline.preview')} — ${name}`}
          onClick={() => { setPreviewOpen(true) }}
        >
          <span className={styles.reportRowNameLine}>
            <FileTypeIcon path={name} size={16} />
            <span className={styles.reportRowName}>{name}</span>
          </span>
          <span className={styles.findingRowMeta}>{t('baseline.pathPrefix')}{workspacePath.replaceAll('\\', '/')}/{requirementDocRelPath(requirementId)}</span>
        </button>
      ) : null}
      {state.kind === 'missing' ? <div className={styles.formHint}>{t('baseline.missing')}</div> : null}
      {state.kind === 'error' ? <div className={styles.fieldError}>{t('baseline.loadError')}</div> : null}
      {previewOpen ? (
        <DocPreviewModal t={t} controller={controller} requirementId={requirementId} onClose={() => { setPreviewOpen(false) }} />
      ) : null}
    </div>
  )
}

/** The ReportPreviewModal twin: fetch on open, tampered warning above the
 * body (vs understandBaseline.docHash), close discards — no cached body. */
function DocPreviewModal(props: {
  t: WorkbenchT
  controller: WorkbenchController
  requirementId: string
  onClose: () => void
}): ReactNode {
  const { t, controller, requirementId } = props
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [text, setText] = useState('')
  const [tampered, setTampered] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    setState('loading')
    void controller.requirementDocContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result === undefined) {
        setState('error')
        return
      }
      if (result.kind === 'ok') {
        setText(result.content)
        setTampered(result.contentTampered)
        setState('ready')
        return
      }
      setState(result.kind === 'http-error' && result.status === 404 ? 'missing' : 'error')
    })
    return () => { abort.abort() }
  }, [controller, requirementId])

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the report.* md chrome keys are generic markdown chrome, shared).
  const labels = useMemo(() => ({
    code: { copyLabel: t('report.mdCopyCode'), copiedLabel: t('report.mdCopiedCode') },
    footnotes: t('report.mdFootnotes'),
  }), [t])

  return (
    <Modal open onClose={props.onClose} title={t('baseline.title')} closeLabel={t('action.cancel')} className={styles.reportWideDialog}>
      {state === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state === 'missing' ? <div className={styles.formHint}>{t('baseline.missing')}</div> : null}
      {state === 'error' ? <div className={styles.fieldError}>{t('baseline.loadError')}</div> : null}
      {state === 'ready' && tampered ? <div className={styles.fieldError}>{t('baseline.tampered')}</div> : null}
      {state === 'ready' ? (
        <div className={styles.reportPreviewBody}>
          <MarkdownText text={text} labels={labels} />
        </div>
      ) : null}
    </Modal>
  )
}
