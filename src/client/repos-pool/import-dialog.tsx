/**
 * Import dialog (decision 0004 / D5+D6, P3): pick a JSON/YAML file →
 * dry-run preview → user confirmation → real import → report.
 *
 * Load-bearing flow properties (P3 adversarial review):
 *  - The REAL import carries the revision the DRY-RUN response returned
 *    (held in preview state) — never the store's current revision, or a
 *    background focus-refresh would silently merge onto a different
 *    snapshot than the one the user confirmed.
 *  - conflict NEVER auto-chains: it lands in a "stale" state and only the
 *    user's click re-runs the dry-run (against the refreshed snapshot).
 *  - importing disables onClose — the server has committed by then; closing
 *    would look like a cancel while the write already happened.
 *  - Two-stage size guard: coarse byte precheck before reading the file
 *    into memory, then the exact code-unit check on the read content.
 *  - skipped detail is only rendered when it is a known UrlRejection enum
 *    (the host's slot-conflict detail is a hardcoded zh sentence — showing
 *    it on an English UI would leak the language).
 *
 * All state is dialog-local useState (short-lived, no outside readers).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconPaperclipOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IMPORT_MAX_CONTENT_CHARS,
  IMPORT_PRECHECK_MAX_BYTES,
} from '../../repos-pool-shared/import-file.js'
import type { ImportReport, ImportSkipReason, UrlRejection } from '../../repos-pool-shared/protocol.js'
import type { ImportOutcome, ReposPoolController } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import { REJECTION_KEY } from './rejection-keys.js'
import styles from './view.module.css'

const SKIP_REASON_KEY: Record<ImportSkipReason, Parameters<ReposPoolT>[0]> = {
  'empty-urls': 'skipReason.emptyUrls',
  'invalid-name': 'skipReason.invalidName',
  'invalid-url': 'skipReason.invalidUrl',
  'invalid-description': 'skipReason.invalidDescription',
  'slot-conflict': 'skipReason.slotConflict',
  'ambiguous-name': 'skipReason.ambiguousName',
  'duplicate-url': 'skipReason.duplicateUrl',
}

const URL_REJECTIONS: readonly string[] = [
  'empty', 'too-long', 'scheme-forbidden', 'no-scheme-local-path', 'scp-ambiguous', 'embedded-credentials', 'malformed-url',
]

type ImportState =
  | { kind: 'pick' }
  | { kind: 'busy'; stage: 'reading' | 'previewing' | 'importing' }
  | { kind: 'preview'; report: ImportReport; revision: number }
  | { kind: 'stale' }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'error'; message: string }

const ERROR_KEY = {
  'network': 'import.errNetwork',
  'conflict': 'import.errConflict',
  'unreadable-file': 'import.errUnreadable',
  'bad-request': 'import.errParse',
  'too-large': 'import.errTooLarge',
  'internal': 'import.errParse',
} as const

export function ImportDialog(props: {
  t: ReposPoolT
  open: boolean
  /** Current store revision — the anchor for the NEXT dry-run only. */
  revision: number
  controller: ReposPoolController
  onClose: () => void
}): ReactNode {
  const { t, controller } = props
  const [state, setState] = useState<ImportState>({ kind: 'pick' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** The picked file's text, carried from pick through preview to import. */
  const contentRef = useRef('')

  useEffect(() => {
    if (props.open) setState({ kind: 'pick' })
  }, [props.open])

  const runDryRun = async (): Promise<void> => {
    setState({ kind: 'busy', stage: 'previewing' })
    const result = await controller.importRepos(contentRef.current, { dryRun: true, expectedRevision: props.revision })
    settleDryRun(result)
  }

  const settleDryRun = (result: ImportOutcome): void => {
    if (result.kind === 'ok') {
      setState({ kind: 'preview', report: result.report, revision: result.revision })
      return
    }
    // conflict: the pool changed — the dialog is NOT a chained retry; the
    // user re-runs the preview against the refreshed snapshot on purpose.
    if (result.code === 'conflict') {
      setState({ kind: 'stale' })
      return
    }
    setState({ kind: 'error', message: t(ERROR_KEY[result.code]) })
  }

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file again still fires change.
    event.target.value = ''
    if (file === undefined) return
    if (file.size > IMPORT_PRECHECK_MAX_BYTES) {
      setState({ kind: 'error', message: t('import.errTooLarge') })
      return
    }
    setState({ kind: 'busy', stage: 'reading' })
    let content: string
    try {
      content = await file.text()
    } catch {
      setState({ kind: 'error', message: t('import.errParse') })
      return
    }
    if (content.length > IMPORT_MAX_CONTENT_CHARS) {
      setState({ kind: 'error', message: t('import.errTooLarge') })
      return
    }
    contentRef.current = content
    await runDryRun()
  }

  const confirmImport = async (): Promise<void> => {
    if (state.kind !== 'preview') return
    setState({ kind: 'busy', stage: 'importing' })
    // Anchor: the revision the DRY-RUN response returned — the user
    // confirmed a merge onto exactly that snapshot.
    const result = await controller.importRepos(contentRef.current, { dryRun: false, expectedRevision: state.revision })
    if (result.kind === 'ok') {
      setState({ kind: 'done', report: result.report })
      return
    }
    if (result.code === 'conflict') {
      setState({ kind: 'stale' })
      return
    }
    setState({ kind: 'error', message: t(ERROR_KEY[result.code]) })
  }

  const importing = state.kind === 'busy' && state.stage === 'importing'
  const working = state.kind === 'busy'

  const skippedDetail = (reason: ImportSkipReason, detail: string | undefined): string => {
    if (reason !== 'invalid-url' || detail === undefined) return ''
    if (!URL_REJECTIONS.includes(detail)) return '' // host-localized sentence — never echo it
    return `（${t(REJECTION_KEY[detail as UrlRejection])}）`
  }

  const reportView = (report: ImportReport): ReactNode => (
    <div className={styles.importReport}>
      <div className={styles.importCounts}>
        <span className={styles.importCount}>{t('import.created')} <b>{report.created}</b></span>
        <span className={styles.importCount}>{t('import.updated')} <b>{report.updated}</b></span>
        <span className={styles.importCount}>{t('import.unchanged')} <b>{report.unchanged}</b></span>
        <span className={`${styles.importCount} ${report.skipped.length > 0 ? styles.importCountWarn : ''}`}>
          {t('import.skipped')} <b>{report.skipped.length}</b>
        </span>
      </div>
      {report.skipped.length > 0 ? (
        <div className={styles.importSkipped}>
          <div className={styles.importSkippedTitle}>{t('import.skippedTitle')}</div>
          <ul className={styles.importSkippedList}>
            {report.skipped.map((skip, index) => (
              <li key={`${skip.name}-${skip.reason}-${index}`}>
                {skip.name === '' ? t('import.unnamed') : skip.name}
                {' — '}
                {t(SKIP_REASON_KEY[skip.reason])}
                {skippedDetail(skip.reason, skip.detail)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )

  return (
    <Modal
      open={props.open}
      onClose={() => {
        // importing: the server has already committed — closing would read
        // as a cancel that isn't one.
        if (!importing) props.onClose()
      }}
      title={state.kind === 'done' ? t('import.doneTitle') : t('import.title')}
      closeLabel={t('form.closeLabel')}
      footer={(() => {
        if (state.kind === 'pick') {
          return <Button variant="ghost" onClick={props.onClose}>{t('form.cancel')}</Button>
        }
        if (state.kind === 'preview') {
          return (
            <>
              <Button variant="ghost" onClick={props.onClose}>{t('form.cancel')}</Button>
              <Button variant="primary" disabled={working} onClick={() => void confirmImport()}>{t('import.confirm')}</Button>
            </>
          )
        }
        if (state.kind === 'stale') {
          return (
            <>
              <Button variant="ghost" onClick={props.onClose}>{t('form.cancel')}</Button>
              <Button variant="primary" disabled={working} onClick={() => void runDryRun()}>{t('import.rePreview')}</Button>
            </>
          )
        }
        if (state.kind === 'done') {
          return <Button variant="primary" onClick={props.onClose}>{t('import.finish')}</Button>
        }
        if (state.kind === 'error') {
          return (
            <>
              <Button variant="ghost" onClick={props.onClose}>{t('form.cancel')}</Button>
              <Button variant="primary" onClick={() => setState({ kind: 'pick' })}>{t('import.rePick')}</Button>
            </>
          )
        }
        return <Button variant="ghost" disabled>{t('form.cancel')}</Button>
      })()}
    >
      <div className={styles.formBody}>
        {state.kind === 'pick' || state.kind === 'error' ? (
          <>
            <button
              type="button"
              className={styles.importPickCard}
              aria-label={t('import.pick')}
              disabled={working}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclipOutlineRegular size={16} />
              <span className={styles.importPickHint}>{t('import.pickHint')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".json,.yaml,.yml"
              onChange={(event) => void onPickFile(event)}
            />
          </>
        ) : null}
        {state.kind === 'busy' ? (
          <div className={styles.fieldHint}>
            {state.stage === 'reading' ? t('import.reading') : state.stage === 'previewing' ? t('import.previewing') : t('import.importing')}
          </div>
        ) : null}
        {state.kind === 'preview' ? (
          <>
            <div className={styles.fieldHint}>{t('import.previewHint')}</div>
            {reportView(state.report)}
          </>
        ) : null}
        {state.kind === 'stale' ? <div className={styles.fieldHint}>{t('import.staleHint')}</div> : null}
        {state.kind === 'done' ? reportView(state.report) : null}
        {state.kind === 'error' ? <div className={styles.fieldError} role="alert">{state.message}</div> : null}
      </div>
    </Modal>
  )
}
