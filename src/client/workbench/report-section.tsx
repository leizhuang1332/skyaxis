/**
 * S1 analysis report face (文件交付轮; 换形轮 = PRD-preview pattern): the
 * workspace report file (`.skyaxis/analysis/<requirementId>.md`) shows on the
 * page as a FILE ROW, never an inline body — clicking the row opens a
 * preview modal that fetches on open (the 工作区 PRD-doc precedent,
 * prd-section.tsx PrdRow/PreviewModal). The mount fetch survives but is
 * EXISTENCE-only (card vs honest hint — no fake card before the session
 * writes the file); every modal open re-reads, which is also the refresh
 * path (the old inline [刷新] retires with the body — 刷新 lives on only as
 * the hint rows' retry). Honest states unchanged: no workspace ⇒ the
 * no-file hint; 404 ⇒ the not-yet-generated hint; read failure ⇒ error +
 * retry; drift ⇒ the tampered warning INSIDE the modal (细化④: warn, never
 * block). The direct file path stays disclosed on the row (ADR 0005 产物
 * 导出承诺口径 — the file is the user's to open outside the panel too).
 *
 * Keyed by requirementId at the render site (a fetch for one requirement
 * never seeds another's panel).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileTypeIcon, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { analysisReportRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import styles from './view.module.css'

/** Row/modal display name — a readable stand-in for the uuid file name. */
const reportDisplayName = (requirementId: string): string => `analysis/${requirementId.slice(0, 8)}.md`

/** The existence face the ROW needs (the modal re-reads for the body itself). */
type RowState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'missing' }
  | { kind: 'error' }

export function ReportSection(props: {
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
    void controller.analysisReportContent(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result === undefined) {
        setState({ kind: 'error' })
        return
      }
      if (result.kind === 'ok') {
        setState({ kind: 'ready' })
        return
      }
      // 404 = the honest missing state (the session may not have written yet);
      // every other failure is the error state with the retry entry.
      setState(result.kind === 'http-error' && result.status === 404 ? { kind: 'missing' } : { kind: 'error' })
    })
    return () => { abort.abort() }
  }, [controller, requirementId, workspacePath, nonce])

  if (workspacePath === '') {
    return (
      <div className={styles.findingSection}>
        <div className={styles.sectionTitle}>{t('report.title')}</div>
        <div className={styles.formHint}>{t('report.noWorkspace')}</div>
      </div>
    )
  }

  const name = reportDisplayName(requirementId)

  return (
    <div className={styles.findingSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('report.title')}</div>
        {state.kind === 'missing' || state.kind === 'error' ? (
          <button type="button" className={styles.ghostButton} onClick={() => { setNonce(nonce + 1) }}>{t('report.refresh')}</button>
        ) : null}
      </div>
      {state.kind === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state.kind === 'ready' ? (
        // Click the card to preview (the PrdRow precedent — markdown file).
        <button
          type="button"
          className={styles.reportRowMain}
          aria-label={`${t('report.preview')} — ${name}`}
          onClick={() => { setPreviewOpen(true) }}
        >
          <span className={styles.reportRowNameLine}>
            <FileTypeIcon path={name} size={16} />
            <span className={styles.reportRowName}>{name}</span>
          </span>
          <span className={styles.findingRowMeta}>{t('report.pathPrefix')}{workspacePath.replaceAll('\\', '/')}/{analysisReportRelPath(requirementId)}</span>
        </button>
      ) : null}
      {state.kind === 'missing' ? <div className={styles.formHint}>{t('report.missing')}</div> : null}
      {state.kind === 'error' ? <div className={styles.fieldError}>{t('report.loadError')}</div> : null}
      {previewOpen ? (
        <ReportPreviewModal t={t} controller={controller} requirementId={requirementId} onClose={() => { setPreviewOpen(false) }} />
      ) : null}
    </div>
  )
}

/** The PRD PreviewModal twin: fetch on open (every open is a fresh read), the
 * tampered warning above the body, close discards — no cached body. */
function ReportPreviewModal(props: {
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
    void controller.analysisReportContent(requirementId, abort.signal).then((result) => {
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

  // Stable identity — MarkdownText's memo drops its render cache otherwise.
  const labels = useMemo(() => ({
    code: { copyLabel: t('report.mdCopyCode'), copiedLabel: t('report.mdCopiedCode') },
    footnotes: t('report.mdFootnotes'),
  }), [t])

  return (
    <Modal open onClose={props.onClose} title={t('report.title')} closeLabel={t('action.cancel')} className={styles.reportWideDialog}>
      {state === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state === 'missing' ? <div className={styles.formHint}>{t('report.missing')}</div> : null}
      {state === 'error' ? <div className={styles.fieldError}>{t('report.loadError')}</div> : null}
      {state === 'ready' && tampered ? <div className={styles.fieldError}>{t('report.tampered')}</div> : null}
      {state === 'ready' ? (
        <div className={styles.reportPreviewBody}>
          <MarkdownText text={text} labels={labels} />
        </div>
      ) : null}
    </Modal>
  )
}
