/**
 * Release-sheet export modal (P3a, the sow-modal precedent): a monospace
 * <pre> preview carrying the EXACT text the copy button places on the
 * clipboard (所见即所复制 — MarkdownText would lose the literal), plus the
 * copy three-state machine (idle/busy/copied, 1s reset, refused-write stays
 * retryable with an alert). Clipboard, not a file download: the repo has no
 * download precedent and research §7.3's verb is「贴进发布单/工单」.
 * writeClipboard is injectable (the sow-modal contract — tests pass fakes).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export function SheetExportModal(props: {
  t: WorkbenchT
  open: boolean
  /** The assembled export text (buildReleaseSheet / buildKnowledgeDoc output). */
  sheet: string
  /** Optional modal title override (P5a: the knowledge export reuses this shell). */
  title?: string
  onClose: () => void
  copy?: (text: string) => Promise<boolean>
}): ReactNode {
  const { t } = props
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied'>('idle')
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])
  // Reopen resets the feedback (the preview itself is derived from props).
  useEffect(() => {
    if (props.open) {
      setCopyState('idle')
      setCopyFailed(false)
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

  const warnText = copyFailed ? t('sheet.copyFailed') : null

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
          {warnText !== null ? <div className={styles.sowWarn} role="alert">{warnText}</div> : null}
          <div className={styles.wpFooterMain}>
            <button type="button" className={styles.ghostButton} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
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
