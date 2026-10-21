/**
 * 0019 rework-note modal (decision 0019 D1-B/D2-C/D3-B): the failed-
 * acceptance feedback channel's send side — a PREVIEW that renders the
 * buildReworkMessage markdown by default (0021 渲染轮 — MarkdownText, the
 * sow-modal twin) with an edit toggle into the 0009 textarea editor (the
 * user edit wins over the live build), a
 * target-session row (the WP's tail dev binding, dev-watcher.ts:70 addressing
 * precedent) with the jump-to-host button, and the send verb through the
 * session messenger (delivery.ts createSessionMessenger — prompt('queue')
 * into the EXISTING session; a degraded send already opened the session page
 * with the draft, so both outcomes close). The messenger face absent (jsdom /
 * conversation-less compositions) hides the send button — copy stays the
 * manual fallback (the P5a honest no-render discipline).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { SendMessageFace } from './delivery.js'
import { buildReworkMessage } from './sow.js'
import { CopyTextButton } from './copy-text-button.js'
import styles from './view.module.css'

export function ReworkModal(props: {
  t: WorkbenchT
  open: boolean
  workPackage: WorkbenchWorkPackage
  requirementTitle: string
  /** The WP's tail dev binding — the send target (view resolves it; absent ⇒ the modal is not rendered). */
  targetSessionId: string
  /** Live-session display title (absent for gone/unresolved sessions). */
  targetDisplayTitle?: string
  /** 0019 send face — absent ⇒ no send button (copy stays the fallback). */
  send?: SendMessageFace
  onNavigateSession?: (sessionId: string) => void
  onClose: () => void
}): ReactNode {
  const { t, workPackage, requirementTitle, targetSessionId } = props

  const [editedText, setEditedText] = useState<string | null>(null)
  const [sendState, setSendState] = useState<'idle' | 'busy' | 'failed'>('idle')

  // 0021 渲染轮: rendered markdown is the default face; the toggle swaps in
  // the 0009 textarea editor (edits survive the swap — the sow-modal twin).
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setEditedText(null)
    setSendState('idle')
    setEditMode(false)
  }, [props.open])

  const preview = useMemo(() => buildReworkMessage(workPackage, requirementTitle), [workPackage, requirementTitle])
  // The user edit (if any) wins over the live build — the copy/send verbs
  // both use THIS text (0009).
  const text = editedText ?? preview

  // Stable identity — MarkdownText's memo drops its render cache otherwise
  // (the prd-section labels-memo precedent).
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('md.copyCode'), copiedLabel: t('md.copiedCode') },
    footnotes: t('md.footnotes'),
  }), [t])

  const onSend = (): void => {
    // Guard busy only — the failed state stays retryable (the alert already
    // told the user why; a dead retry button would strand them — the
    // sow-modal onDeliver precedent).
    if (sendState === 'busy' || props.send === undefined) return
    setSendState('busy')
    void props.send(targetSessionId, text).then((outcome) => {
      if (outcome.ok) {
        props.onClose()
        return
      }
      setSendState('failed')
    })
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t('rework.title')}
      closeLabel={t('action.cancel')}
      description={`${workPackage.id} ${workPackage.title}`}
      contentClassName={styles.wpDialogBody}
      footer={
        <>
          {sendState === 'failed' ? <div className={styles.sowWarn} role="alert">{t('rework.sendFailed')}</div> : null}
          <div className={styles.wpFooterMain}>
            {props.onNavigateSession !== undefined ? (
              <button type="button" className={styles.ghostButton} onClick={() => { props.onNavigateSession?.(targetSessionId) }}>
                {t('inbox.jumpToSession')}
              </button>
            ) : null}
            <CopyTextButton t={t} text={text} />
            <button type="button" className={styles.ghostButton} onClick={props.onClose}>{t('action.cancel')}</button>
            {props.send !== undefined ? (
              <button type="button" className={styles.primaryButton} disabled={sendState === 'busy'} onClick={onSend}>
                {t('rework.send')}
              </button>
            ) : null}
          </div>
        </>
      }
    >
      <div className={styles.sowGroup}>
        <div className={styles.sowGroupTitle}>{t('rework.targetLabel')}</div>
        <div className={styles.findingRowMeta}>
          {targetSessionId.slice(0, 8)} {props.targetDisplayTitle ?? ''}
        </div>
      </div>
      {/* 0021 渲染轮: label→div — the control is conditional behind the
          render↔edit toggle, so a wrapping label has no stable control. */}
      <div className={styles.formField}>
        <div className={styles.sowEditBar}>
          <span>{t('rework.previewLabel')}</span>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="rework-view-toggle"
            onClick={() => { setEditMode((prev) => !prev) }}
          >
            {editMode ? t('md.preview') : t('md.edit')}
          </button>
        </div>
        {editMode ? (
          <textarea
            rows={10}
            className={styles.sowEditor}
            data-testid="rework-preview"
            value={text}
            spellCheck={false}
            onChange={(event) => { setEditedText(event.target.value) }}
          />
        ) : (
          <div className={styles.sowRendered} data-testid="rework-rendered">
            <MarkdownText text={text} labels={markdownLabels} />
          </div>
        )}
      </div>
    </Modal>
  )
}
