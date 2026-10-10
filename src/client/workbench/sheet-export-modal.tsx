/**
 * Release-sheet export modal (P3a, the sow-modal precedent): a monospace
 * <pre> preview carrying the EXACT text the copy button places on the
 * clipboard (所见即所复制 — MarkdownText would lose the literal), plus the
 * copy three-state machine (idle/busy/copied, 1s reset, refused-write stays
 * retryable with an alert). 挂账轮 adds [下载] beside the clipboard: blob +
 * a[download] via web-platform capability (the repo's first download — no
 * DSH download API exists; the webview's real download behavior is the
 * round's 实机验收 open point, so the fallback line stays honest: 失败请改用
 * 复制). writeClipboard and download are both injectable (the sow-modal
 * contract — tests pass fakes; jsdom cannot exercise the anchor click).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

/** Default download impl — the repo's first: object URL + anchor click, revoked next tick. */
export function downloadTextFile(filename: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    // Revoke on the next tick: revoking synchronously can race the browser's
    // download hand-off in some engines.
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
    return true
  } catch {
    return false
  }
}

export function SheetExportModal(props: {
  t: WorkbenchT
  open: boolean
  /** The assembled export text (buildReleaseSheet / buildKnowledgeDoc output). */
  sheet: string
  /** Download filename (挂账轮) — callers mint it (release-sheet-<rid>.md / knowledge-export-<stamp>.md). */
  filename: string
  /** Optional modal title override (P5a: the knowledge export reuses this shell). */
  title?: string
  onClose: () => void
  copy?: (text: string) => Promise<boolean>
  download?: (filename: string, text: string) => boolean
}): ReactNode {
  const { t } = props
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied'>('idle')
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const [downloadState, setDownloadState] = useState<'idle' | 'downloaded'>('idle')
  const [downloadFailed, setDownloadFailed] = useState(false)
  const downloadTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current)
  }, [])
  // Reopen resets the feedback (the preview itself is derived from props).
  useEffect(() => {
    if (props.open) {
      setCopyState('idle')
      setCopyFailed(false)
      setDownloadState('idle')
      setDownloadFailed(false)
    }
  }, [props.open])

  const onCopy = (): void => {
    if (copyState !== 'idle') return
    setCopyState('busy')
    void (props.copy ?? writeClipboard)(props.sheet).then((ok) => {
      if (ok) {
        setCopyFailed(false)
        setCopyState('copied')
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => { setCopyState('idle') }, 1000)
      } else {
        setCopyState('idle')
        setCopyFailed(true)
      }
    })
  }

  const onDownload = (): void => {
    if (downloadState !== 'idle') return
    // Synchronous DOM work — no busy state ever renders (unlike the async
    // clipboard); the tri-state still gates double clicks within the 1s window.
    if ((props.download ?? downloadTextFile)(props.filename, props.sheet)) {
      setDownloadFailed(false)
      setDownloadState('downloaded')
      if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current)
      downloadTimerRef.current = window.setTimeout(() => { setDownloadState('idle') }, 1000)
    } else {
      setDownloadFailed(true)
    }
  }

  const warns: string[] = []
  if (copyFailed) warns.push(t('sheet.copyFailed'))
  if (downloadFailed) warns.push(t('sheet.downloadFailed'))

  return (
    <Modal
      open={props.open}
      onClose={() => { props.onClose() }}
      title={props.title ?? t('sheet.title')}
      closeLabel={t('action.cancel')}
      className={styles.sheetDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <>
          {warns.length > 0
            ? warns.map((warn) => <div key={warn} className={styles.sowWarn} role="alert">{warn}</div>)
            : null}
          <div className={styles.wpFooterMain}>
            <button type="button" className={styles.ghostButton} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={downloadState !== 'idle'}
              onClick={onDownload}
            >
              {downloadState === 'downloaded' ? t('sheet.downloaded') : t('sheet.download')}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={copyState !== 'idle'}
              onClick={onCopy}
            >
              {copyState === 'copied' ? t('sheet.copied') : t('sheet.copy')}
            </button>
          </div>
        </>
      }
    >
      <pre data-testid="sheet-preview" className={styles.sowPreview}>{props.sheet}</pre>
    </Modal>
  )
}
