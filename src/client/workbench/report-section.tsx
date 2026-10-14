/**
 * S1 analysis report panel (文件交付轮): renders the workspace report file
 * the analysis session writes (`.skyaxis/analysis/<requirementId>.md`) —
 * the report BODY that previously only lived in the conversation. Pure read
 * via the artifacts route's analysis-report face (the controller's
 * planContent precedent — no ledger writes, no slot churn); fetch on mount
 * + manual refresh nonce (the scan-modal pattern). Honest states only: no
 * workspace ⇒ the no-file hint, 404 ⇒ the not-yet-generated hint, drift ⇒
 * the tampered warning (细化④: warn, never block) — never a placeholder
 * body. The direct file path is disclosed (the ADR 0005 产物导出承诺
 * precedent — the file is the user's to open outside the panel too).
 *
 * Keyed by requirementId at the render site (a fetch for one requirement
 * never seeds another's panel).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { analysisReportRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import styles from './view.module.css'

type ReportState =
  | { kind: 'loading' }
  | { kind: 'ready'; content: string; tampered: boolean }
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
  const [state, setState] = useState<ReportState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

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
        setState({ kind: 'ready', content: result.content, tampered: result.contentTampered })
        return
      }
      // 404 = the honest missing state (the session may not have written yet);
      // every other failure is the error state with the retry entry.
      setState(result.kind === 'http-error' && result.status === 404 ? { kind: 'missing' } : { kind: 'error' })
    })
    return () => { abort.abort() }
  }, [controller, requirementId, workspacePath, nonce])

  // Stable identity — MarkdownText's memo drops its render cache otherwise.
  const labels = useMemo(() => ({
    code: { copyLabel: t('report.mdCopyCode'), copiedLabel: t('report.mdCopiedCode') },
    footnotes: t('report.mdFootnotes'),
  }), [t])

  if (workspacePath === '') {
    return (
      <div className={styles.findingSection}>
        <div className={styles.sectionTitle}>{t('report.title')}</div>
        <div className={styles.formHint}>{t('report.noWorkspace')}</div>
      </div>
    )
  }

  return (
    <div className={styles.findingSection}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{t('report.title')}</div>
        <button type="button" className={styles.ghostButton} onClick={() => { setNonce(nonce + 1) }}>{t('report.refresh')}</button>
      </div>
      <div className={styles.findingRowMeta}>{t('report.pathPrefix')}{workspacePath.replaceAll('\\', '/')}/{analysisReportRelPath(requirementId)}</div>
      {state.kind === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
      {state.kind === 'missing' ? <div className={styles.formHint}>{t('report.missing')}</div> : null}
      {state.kind === 'error' ? <div className={styles.fieldError}>{t('report.loadError')}</div> : null}
      {state.kind === 'ready' && state.tampered ? <div className={styles.fieldError}>{t('report.tampered')}</div> : null}
      {state.kind === 'ready' ? <MarkdownText text={state.content} labels={labels} /> : null}
    </div>
  )
}
