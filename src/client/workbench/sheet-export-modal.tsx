/**
 * Release-sheet export modal (P3a, the sow-modal precedent): the copy
 * three-state machine (idle/busy/copied, 1s reset, refused-write stays
 * retryable with an alert). 挂账轮 adds [下载] beside the clipboard: blob +
 * a[download] via web-platform capability (the repo's first download — no
 * DSH download API exists; the webview's real download behavior is the
 * round's 实机验收 open point, so the fallback line stays honest: 失败请改用
 * 复制). writeClipboard and download are both injectable (the sow-modal
 * contract — tests pass fakes; jsdom cannot exercise the anchor click).
 *
 * 渲染轮 (2026-10-27 user ruling「上线单展示要渲染markdown」— supersedes the
 * 0021 D2 boundary for the release-sheet consumer ONLY) + 编辑轮 (same-day
 * follow-up「支持编辑」): renderMarkdown ⇒ the 0009/0021 sow-modal twin —
 * the rendered MarkdownText default face + an 编辑 toggle into a textarea
 * (the 0006 read-only <pre> retired for this consumer); the user edit wins
 * over the live build (editedText ?? sheet — a dirty edit survives face
 * swaps) and the copy/download verbs carry THAT text (所见即所复制 evolves
 * into 所见即所发: every face shows the same text the verbs use). 恢复生成
 * 内容 resyncs to the live build. Absent prop ⇒ the 0006 <pre>-only face
 * verbatim (knowledge export / understanding sheet were not named).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MarkdownText, Modal, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** 渲染轮+编辑轮: rendered default + 编辑 toggle + user-edit-wins verbs (release sheet only — see header). */
  renderMarkdown?: boolean
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
  // 渲染轮+编辑轮: editMode false = the rendered default face; the toggle
  // swaps in the textarea editor. Edits survive face swaps (0009); reopen
  // resets to the rendered default and drops the edit (the sow-modal twin).
  const [editMode, setEditMode] = useState(false)
  const [editedText, setEditedText] = useState<string | null>(null)
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
      setEditMode(false)
      setEditedText(null)
    }
  }, [props.open])

  // The user edit (if any) wins over the live build; copy/download both use
  // THIS text (0009 — the sow-modal contract).
  const text = editedText ?? props.sheet

  const onCopy = (): void => {
    if (copyState !== 'idle') return
    setCopyState('busy')
    void (props.copy ?? writeClipboard)(text).then((ok) => {
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
    if ((props.download ?? downloadTextFile)(props.filename, text)) {
      setDownloadFailed(false)
      setDownloadState('downloaded')
      if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current)
      downloadTimerRef.current = window.setTimeout(() => { setDownloadState('idle') }, 1000)
    } else {
      setDownloadFailed(true)
    }
  }

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the prd-section labels-memo precedent).
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('md.copyCode'), copiedLabel: t('md.copiedCode') },
    footnotes: t('md.footnotes'),
  }), [t])

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
            {props.renderMarkdown === true && editedText !== null ? (
              <button type="button" className={styles.ghostButton} onClick={() => { setEditedText(null) }}>{t('sheet.resetEdit')}</button>
            ) : null}
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
      {/* 渲染轮+编辑轮: renderMarkdown ⇒ rendered default + 编辑 toggle into a
          textarea (the sowEditor/sowRendered vocabulary — the sow-modal twin);
          absent ⇒ the 0006 <pre>-only face verbatim. */}
      {props.renderMarkdown === true ? (
        <>
          <div className={styles.sowEditBar}>
            <button
              type="button"
              className={styles.ghostButton}
              data-testid="sheet-view-toggle"
              onClick={() => { setEditMode((prev) => !prev) }}
            >
              {editMode ? t('md.preview') : t('md.edit')}
            </button>
          </div>
          {editMode ? (
            <textarea
              className={styles.sowEditor}
              data-testid="sheet-preview"
              value={text}
              spellCheck={false}
              onChange={(event) => { setEditedText(event.target.value) }}
            />
          ) : (
            <div className={styles.sowRendered} data-testid="sheet-rendered">
              <MarkdownText text={text} labels={markdownLabels} />
            </div>
          )}
        </>
      ) : (
        <pre data-testid="sheet-preview" className={styles.sowPreview}>{props.sheet}</pre>
      )}
    </Modal>
  )
}
