/**
 * Generic workspace-doc card (0012 两步化轮) — the file-card family's shared
 * core, extracted from the report-section / requirement-doc-section twins at
 * the point a FOURTH document face arrived (the planning doc — the extraction
 * the twins' header notes had scheduled). Mount fetch is EXISTENCE-only;
 * every modal open re-reads (the refresh path); the caller supplies the tamper
 * anchor key (each face compares against its own ledger hash — the response
 * carries the boolean, this card only renders it). The direct file path stays
 * disclosed on the row (ADR 0005 导出承诺口径).
 *
 * Not migrated: the requirements-module prd-section (different module,
 * different fetch face — out of this round's scope, recorded in the plan).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileTypeIcon, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchController } from './controller.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchArtifactContentResult } from './fetcher.js'
import styles from './view.module.css'

/** The per-face dictionary keys (resolved once per ns — the template-key dodge for the typed t). */
const DOC_NS_KEYS = {
  report: {
    title: 'report.title', missing: 'report.missing', noWorkspace: 'report.noWorkspace',
    pathPrefix: 'report.pathPrefix', tampered: 'report.tampered', refresh: 'report.refresh',
    preview: 'report.preview', loadError: 'report.loadError',
  },
  baseline: {
    title: 'baseline.title', missing: 'baseline.missing', noWorkspace: 'baseline.noWorkspace',
    pathPrefix: 'baseline.pathPrefix', tampered: 'baseline.tampered', refresh: 'baseline.refresh',
    preview: 'baseline.preview', loadError: 'baseline.loadError',
  },
  planning: {
    title: 'planning.title', missing: 'planning.missing', noWorkspace: 'planning.noWorkspace',
    pathPrefix: 'planning.pathPrefix', tampered: 'planning.tampered', refresh: 'planning.refresh',
    preview: 'planning.preview', loadError: 'planning.loadError',
  },
  splitResult: {
    title: 'splitResult.title', missing: 'splitResult.missing', noWorkspace: 'splitResult.noWorkspace',
    pathPrefix: 'splitResult.pathPrefix', tampered: 'splitResult.tampered', refresh: 'splitResult.refresh',
    preview: 'splitResult.preview', loadError: 'splitResult.loadError',
  },
} as const satisfies Record<string, Record<'title' | 'missing' | 'noWorkspace' | 'pathPrefix' | 'tampered' | 'refresh' | 'preview' | 'loadError', Parameters<WorkbenchT>[0]>>

export type DocSectionNs = keyof typeof DOC_NS_KEYS

/** The existence face the ROW needs (the modal re-reads for the body itself). */
type RowState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'missing' }
  | { kind: 'error' }

export function WorkspaceDocSection(props: {
  t: WorkbenchT
  controller: WorkbenchController
  requirementId: string
  /** Bound workspace root ('' = unbound — no file channel, honest hint). */
  workspacePath: string
  /** Which dictionary family the card's copy comes from. */
  ns: DocSectionNs
  /** Row/modal display name — a readable stand-in for the uuid file name. */
  displayName: string
  /** Display-form workspace-relative path (forward slashes). */
  relPath: string
  /** The content read (an arrow-method off the controller — bound by the caller). */
  fetchContent: (requirementId: string, signal?: AbortSignal) => Promise<WorkbenchArtifactContentResult | undefined>
  /** Optional head slot (布局重塑轮): face-specific actions ride the section
   *  head — e.g. the baseline face carries its 生成整理任务书 entry here. */
  headerExtra?: ReactNode
}): ReactNode {
  const { t, controller, requirementId, workspacePath, ns, displayName, relPath, fetchContent } = props
  const keys = DOC_NS_KEYS[ns]
  const [state, setState] = useState<RowState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (workspacePath === '') return
    setState({ kind: 'loading' })
    const abort = new AbortController()
    void fetchContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result === undefined) {
        setState({ kind: 'error' })
        return
      }
      if (result.kind === 'ok') {
        setState({ kind: 'ready' })
        return
      }
      // 404 = the honest missing state (no session has written the doc yet);
      // every other failure is the error state with retry.
      setState(result.kind === 'http-error' && result.status === 404 ? { kind: 'missing' } : { kind: 'error' })
    })
    return () => { abort.abort() }
  }, [fetchContent, requirementId, workspacePath, nonce])

  if (workspacePath === '') {
    return (
      <div className={styles.findingSection}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>{t(keys.title)}</div>
          {props.headerExtra}
        </div>
        <div className={styles.formHint}>{t(keys.noWorkspace)}</div>
      </div>
    )
  }

  return (
    <div className={styles.findingSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t(keys.title)}</div>
        {props.headerExtra}
        {state.kind === 'missing' || state.kind === 'error' ? (
          <button type="button" className={styles.ghostButton} onClick={() => { setNonce(nonce + 1) }}>{t(keys.refresh)}</button>
        ) : null}
      </div>
      {state.kind === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state.kind === 'ready' ? (
        <button
          type="button"
          className={styles.reportRowMain}
          aria-label={`${t(keys.preview)} — ${displayName}`}
          onClick={() => { setPreviewOpen(true) }}
        >
          <span className={styles.reportRowNameLine}>
            <FileTypeIcon path={displayName} size={16} />
            <span className={styles.reportRowName}>{displayName}</span>
          </span>
          <span className={styles.findingRowMeta}>{t(keys.pathPrefix)}{workspacePath.replaceAll('\\', '/')}/{relPath}</span>
        </button>
      ) : null}
      {state.kind === 'missing' ? <div className={styles.formHint}>{t(keys.missing)}</div> : null}
      {state.kind === 'error' ? <div className={styles.fieldError}>{t(keys.loadError)}</div> : null}
      {previewOpen ? (
        <DocPreviewModal t={t} fetchContent={fetchContent} requirementId={requirementId} title={t(keys.title)} tamperedLabel={t(keys.tampered)} missingLabel={t(keys.missing)} onClose={() => { setPreviewOpen(false) }} />
      ) : null}
    </div>
  )
}

/** The ReportPreviewModal twin: fetch on open, tampered warning above the
 * body, close discards — no cached body. */
function DocPreviewModal(props: {
  t: WorkbenchT
  fetchContent: (requirementId: string, signal?: AbortSignal) => Promise<WorkbenchArtifactContentResult | undefined>
  requirementId: string
  title: string
  tamperedLabel: string
  missingLabel: string
  onClose: () => void
}): ReactNode {
  const { t, fetchContent, requirementId, title, tamperedLabel, missingLabel } = props
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [text, setText] = useState('')
  const [tampered, setTampered] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    setState('loading')
    void fetchContent(requirementId, abort.signal).then((result) => {
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
  }, [fetchContent, requirementId])

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the report.* md chrome keys are generic markdown chrome, shared).
  const labels = useMemo(() => ({
    code: { copyLabel: t('report.mdCopyCode'), copiedLabel: t('report.mdCopiedCode') },
    footnotes: t('report.mdFootnotes'),
  }), [t])

  return (
    <Modal open onClose={props.onClose} title={title} closeLabel={t('action.cancel')} className={styles.reportWideDialog}>
      {state === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state === 'missing' ? <div className={styles.formHint}>{missingLabel}</div> : null}
      {state === 'error' ? <div className={styles.fieldError}>{t('report.loadError')}</div> : null}
      {state === 'ready' && tampered ? <div className={styles.fieldError}>{tamperedLabel}</div> : null}
      {state === 'ready' ? (
        <div className={styles.reportPreviewBody}>
          <MarkdownText text={text} labels={labels} />
        </div>
      ) : null}
    </Modal>
  )
}
