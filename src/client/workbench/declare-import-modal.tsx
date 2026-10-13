/**
 * Declare-block import modal (P3b, the repos-pool import-dialog contract
 * over the user-ratified 逐条勾选 UX):
 *
 *  - TWO CHANNELS CONVERGE ON TEXT: the bound-session fetch only fills the
 *    textarea (the user sees the exact text before anything parses); the
 *    paste channel is always alive and never depends on the session face
 *    (D3 fallback — the fetch section hides entirely when the face is
 *    absent, honest no-render).
 *  - Two-stage with the revision anchor: the REAL import carries the
 *    revision the DRY-RUN response returned (never the store's current);
 *    conflict NEVER auto-chains — it lands in a stale state and only the
 *    user's re-parse re-runs against the refreshed snapshot.
 *  - Importing disables onClose — the server has committed by then
 *    (repos-pool load-bearing property).
 *  - Per-row checkboxes default to checked EXCEPT duplicate-flagged rows
 *    (advisory: correction = new item + old rolled-back may be identical);
 *    skipped rows are listed, not checkable — they were never importable.
 *  - stageReady renders as an advisory line ONLY — the four powers stay
 *    with the user (research §5.1); nothing lands anywhere.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeclareEntry, DeclarePreviewResponseOk, DeclareReport, DeclareSkipReason } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import type { WorkbenchSessionsFace } from './view.js'
import type { WorkbenchFailure } from './fetcher.js'
import styles from './view.module.css'

/** Skip reason → dictionary key. Exhaustive Record — a new enum member is a type error here. */
const SKIP_REASON_KEY: Record<DeclareSkipReason, Parameters<WorkbenchT>[0]> = {
  'bad-shape': 'declare.skip.bad-shape',
  'bad-type': 'declare.skip.bad-type',
  'bad-severity': 'declare.skip.bad-severity',
  'bad-title': 'declare.skip.bad-title',
  'bad-content': 'declare.skip.bad-content',
  'over-cap': 'declare.skip.over-cap',
  'bad-envs': 'declare.skip.bad-envs',
  'wp-not-found': 'declare.skip.wp-not-found',
  'wp-not-in-dev': 'declare.skip.wp-not-in-dev',
}

type Phase =
  | { kind: 'edit' }
  | { kind: 'parsing' }
  | { kind: 'preview'; preview: DeclarePreviewResponseOk }
  | { kind: 'importing' }
  | { kind: 'stale' }
  | { kind: 'done'; report: DeclareReport }

const FETCH_ERROR_KEY: Partial<Record<string, Parameters<WorkbenchT>[0]>> = {
  'no-service': 'declare.fetchNoService',
  'not-found': 'declare.fetchNotFound',
  'unreadable': 'declare.fetchUnreadable',
  'no-declare-block': 'declare.fetchNoBlock',
}

const ARTIFACT_TYPE_GROUP_KEY: Record<'sql' | 'config' | 'flag' | 'mq' | 'other', Parameters<WorkbenchT>[0]> = {
  sql: 'release.group.sql',
  config: 'release.group.config',
  flag: 'release.group.flag',
  mq: 'release.group.mq',
  other: 'release.group.other',
}

const entryLabel = (t: WorkbenchT, entry: DeclareEntry): string => {
  if (entry.kind === 'built') return `${entry.workPackageId} · built`
  if (entry.kind === 'artifact') {
    const envs = entry.envs.length > 0 ? ` · env ${entry.envs.join(',')}` : ''
    return `${entry.title}（${t(ARTIFACT_TYPE_GROUP_KEY[entry.type])}）${envs}`
  }
  return `${entry.title}（${entry.type}）`
}

export function DeclareImportModal(props: {
  t: WorkbenchT
  open: boolean
  requirementId: string
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  /** Optional live-session face — absent (jsdom/tests) ⇒ paste channel only. */
  sessions?: WorkbenchSessionsFace
  onClose: () => void
}): ReactNode {
  const { t, controller, requirementId, slot } = props
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [parseError, setParseError] = useState<string | null>(null)

  // Reopen resets everything (the repos-pool pick-state reset).
  useEffect(() => {
    if (props.open) {
      setText('')
      setPhase({ kind: 'edit' })
      setFetchError(null)
      setFetchBusy(false)
      setSessionId('')
      setSelected(new Set())
      setParseError(null)
    }
  }, [props.open])

  const record = slot.record
  const boundSessions = Array.from(new Set(
    (record?.workPackages ?? []).flatMap((workPackage) => workPackage.sessions.map((binding) => binding.sessionId)),
  ))
  const sessionTitle = (id: string): string =>
    props.sessions?.summariesById[id]?.displayTitle ?? `${id.slice(0, 8)}…`

  const onFetch = (): void => {
    if (fetchBusy || sessionId === '') return
    setFetchBusy(true)
    setFetchError(null)
    void controller.declareFetch(sessionId).then((result) => {
      setFetchBusy(false)
      if (result === undefined) return
      if (result.kind !== 'ok') {
        setFetchError(t('error.network'))
        return
      }
      const response = result.response
      if ('missing' in response) {
        const key = FETCH_ERROR_KEY[response.missing]
        setFetchError(key !== undefined ? t(key) : t('error.internal'))
        return
      }
      setText(response.text)
    })
  }

  const runParse = (): void => {
    if (text.trim().length === 0) return
    setPhase({ kind: 'parsing' })
    setParseError(null)
    void controller.declarePreview(requirementId, text).then((result) => {
      if (result === undefined) return
      if (result.kind !== 'ok') {
        // conflict → stale (the user re-parses against the refreshed
        // snapshot); anything else → back to edit with an error line.
        if (result.kind === 'http-error' && result.status === 409) {
          setPhase({ kind: 'stale' })
          return
        }
        setParseError(t(result.kind === 'network' ? 'error.network' : 'error.internal'))
        setPhase({ kind: 'edit' })
        return
      }
      const preview = result.preview
      if (preview.blockError !== undefined) {
        setParseError(preview.blockError === 'no-declare-block'
          ? t('declare.blockNoBlock')
          : t('declare.blockYamlSyntax').replaceAll('{n}', String(preview.blockErrorLine ?? '?')))
        setPhase({ kind: 'edit' })
        return
      }
      // Default selection: everything importable EXCEPT duplicates.
      setSelected(new Set(preview.entries.filter((entry) => !(entry.kind !== 'built' && entry.duplicate)).map((entry) => entry.key)))
      setPhase({ kind: 'preview', preview })
    })
  }

  const onImport = (): void => {
    if (phase.kind !== 'preview' || selected.size === 0) return
    setPhase({ kind: 'importing' })
    void controller.declareImport(requirementId, text, [...selected], phase.preview.revision, sessionId !== '' ? sessionId : undefined).then((result) => {
      if (result === undefined) return
      if ('built' in result) {
        setPhase({ kind: 'done', report: result })
        return
      }
      if (result.kind === 'http-error' && result.status === 409) {
        setPhase({ kind: 'stale' })
        return
      }
      setParseError(t(result.kind === 'network' ? 'error.network' : 'error.internal'))
      setPhase({ kind: 'edit' })
    })
  }

  const onReparse = (): void => {
    // Refresh the slot first so the fresh preview anchors to the live ledger.
    void controller.open(requirementId).then(() => { runParse() })
  }

  const importing = phase.kind === 'importing'
  const preview = phase.kind === 'preview' ? phase.preview : null
  const groups: Array<{ label: string; entries: DeclareEntry[] }> = preview === null ? [] : [
    { label: t('declare.groupBuilt'), entries: preview.entries.filter((entry) => entry.kind === 'built') },
    { label: t('declare.groupArtifacts'), entries: preview.entries.filter((entry) => entry.kind === 'artifact') },
    { label: t('declare.groupKnowledge'), entries: preview.entries.filter((entry) => entry.kind === 'knowledge') },
  ].filter((group) => group.entries.length > 0)

  const toggle = (key: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const busyRow = (label: string): ReactNode => <div className={styles.formHint}>{label}</div>

  return (
    <Modal
      open={props.open}
      onClose={() => {
        // importing: the server has already committed — closing would read
        // as a cancel that isn't one (repos-pool).
        if (!importing) props.onClose()
      }}
      title={t('declare.title')}
      closeLabel={t('action.cancel')}
      className={styles.sowDialog}
      contentClassName={styles.wpDialogBody}
      footer={
        <>
          {parseError !== null ? <div className={styles.sowWarn} role="alert">{parseError}</div> : null}
          <div className={styles.wpFooterMain}>
            {phase.kind === 'stale' ? (
              <>
                <button type="button" className={styles.ghostButton} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
                <button type="button" className={styles.primaryButton} onClick={onReparse}>{t('declare.reparseButton')}</button>
              </>
            ) : phase.kind === 'done' ? (
              <button type="button" className={styles.primaryButton} onClick={() => { props.onClose() }}>{t('action.confirm')}</button>
            ) : phase.kind === 'preview' ? (
              <>
                <button type="button" className={styles.ghostButton} disabled={importing} onClick={() => { setPhase({ kind: 'edit' }) }}>{t('action.cancel')}</button>
                <button type="button" className={styles.primaryButton} disabled={selected.size === 0} onClick={onImport}>{t('declare.importSubmit')}</button>
              </>
            ) : (
              <>
                <button type="button" className={styles.ghostButton} disabled={importing} onClick={() => { props.onClose() }}>{t('action.cancel')}</button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={text.trim().length === 0 || phase.kind === 'parsing'}
                  onClick={runParse}
                >
                  {t('declare.parseButton')}
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      {phase.kind === 'done' ? (
        <div className={styles.modalForm}>
          <div className={styles.formHint}>
            {t('declare.doneTitle')}：{t('declare.doneCounts')
              .replaceAll('{b}', String(phase.report.built))
              .replaceAll('{a}', String(phase.report.artifacts))
              .replaceAll('{k}', String(phase.report.knowledge))
              .replaceAll('{s}', String(phase.report.skipped.length))}
          </div>
          {phase.report.skipped.length > 0 ? (
            <div className={styles.formField}>
              <span>{t('declare.skippedTitle')}</span>
              <ul className={styles.checkList}>
                {phase.report.skipped.map((skip) => (
                  <li key={skip.key} className={styles.checkRow}>
                    {skip.label === '' ? skip.key : skip.label}
                    {' — '}
                    {t(SKIP_REASON_KEY[skip.reason])}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : phase.kind === 'preview' && preview !== null ? (
        <div className={styles.modalForm}>
          {preview.stageReady ? <div className={styles.formHint}>{t('declare.stageReadyProposal')}</div> : null}
          {preview.entries.length === 0 ? <div className={styles.formHint}>{t('declare.empty')}</div> : null}
          {groups.map((group) => (
            <div key={group.label} className={styles.formField}>
              <span>{group.label}</span>
              <div className={styles.checkList}>
                {group.entries.map((entry) => (
                  <label key={entry.key} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.key)}
                      onChange={() => { toggle(entry.key) }}
                    />
                    <span>
                      {entryLabel(t, entry)}
                      {entry.kind !== 'built' && entry.duplicate ? `（${t('declare.duplicateHint')}）` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {preview.skipped.length > 0 ? (
            <div className={styles.formField}>
              <span>{t('declare.skippedTitle')}</span>
              <ul className={styles.checkList}>
                {preview.skipped.map((skip) => (
                  <li key={skip.key} className={styles.checkRow}>
                    {skip.label === '' ? skip.key : skip.label}
                    {' — '}
                    {t(SKIP_REASON_KEY[skip.reason])}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.modalForm}>
          {props.sessions !== undefined ? (
            <div className={styles.formField}>
              <span>{t('declare.sessionLabel')}</span>
              {boundSessions.length === 0 ? (
                <div className={styles.formHint}>{t('declare.noBoundSessions')}</div>
              ) : (
                <div className={styles.findingFieldRow}>
                  <select value={sessionId} onChange={(event) => { setSessionId(event.target.value) }}>
                    <option value="">{t('declare.sessionPlaceholder')}</option>
                    {boundSessions.map((id) => (
                      <option key={id} value={id}>{sessionTitle(id)}</option>
                    ))}
                  </select>
                  <button type="button" className={styles.ghostButton} disabled={fetchBusy || sessionId === ''} onClick={onFetch}>
                    {t('declare.fetchButton')}
                  </button>
                </div>
              )}
              {fetchError !== null ? <div className={styles.fieldError}>{fetchError}</div> : null}
            </div>
          ) : null}
          <label className={styles.formField}>
            <span>{t('declare.textLabel')}</span>
            <textarea
              rows={10}
              className={styles.wpDraftTextarea}
              value={text}
              onChange={(event) => { setText(event.target.value) }}
            />
          </label>
          {phase.kind === 'parsing' ? busyRow(t('page.loading')) : null}
        </div>
      )}
    </Modal>
  )
}
