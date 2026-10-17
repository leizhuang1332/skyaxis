/**
 * Execution view (0016 P1b) — the S3 second-level full-width dual-column view
 * that makes the dev session's process VISIBLE. The header row carries the
 * WP identity + a jump-to-session deep link; the left narrow column is the
 * execution archive (pure ledger data — criteria/plan/session/declaration/
 * acceptance); the right wide column is the collapsed live view (folded from
 * the session-digest tail window); the bottom is a metrics line and a sticky
 * "waiting for you" bar when the bound session has a pending interaction.
 *
 * Data flow: mount / session flip → controller.sessionDigest(latestDevSessionId)
 * → foldExecutionDigest → render. Event-driven (D7-A: flip/open/manual only,
 * never a polling loop). A missing/failed digest renders an honest line, never
 * a fabricated one (zero-fake-progress).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExecutionDigest, WorkbenchWorkPackage } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import type { RequirementWorkbenchState } from './store.js'
import { foldExecutionDigest } from './execution-fold.js'
import { sessionChipState } from './session-strip.js'
import { STATUS_TAG_TONE, STATUS_LABEL_KEY } from './work-package-dialog.js'
import styles from './view.module.css'

export function ExecutionSection(props: {
  t: WorkbenchT
  requirementId: string
  slot: RequirementWorkbenchState
  controller: WorkbenchController
  workPackage: WorkbenchWorkPackage
  /** Session summaries for the chip state + jump target. */
  sessions?: { ids: readonly string[]; summariesById: Readonly<Record<string, { id: string; displayTitle: string; running: boolean; blank: boolean } | undefined>> }
  /** SessionIds with a pending approval/question. */
  waitingIds?: ReadonlySet<string>
  onBack: () => void
  onNavigateSession: (sessionId: string) => void
}): ReactNode {
  const { t, controller, requirementId, slot } = props
  const workPackage = props.workPackage
  const record = slot.record
  const [digest, setDigest] = useState<ExecutionDigest | 'loading' | 'error' | 'missing' | 'no-session'>('loading')

  // Resolve the latest dev binding — the digest's target session
  const devBinding = useMemo(() =>
    [...workPackage.sessions].reverse().find((row) => row.purpose === 'dev'), [workPackage])

  // Fetch the digest on mount and on session-flip re-renders
  useEffect(() => {
    if (devBinding === undefined) {
      setDigest('no-session')
      return
    }
    const abort = new AbortController()
    setDigest('loading')
    void controller.sessionDigest(devBinding.sessionId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result === undefined || result.kind !== 'ok') {
        setDigest('error')
        return
      }
      const response = result.response
      if ('missing' in response) {
        setDigest('missing')
        return
      }
      setDigest(foldExecutionDigest(response.events, response.lastEventCount))
    })
    return () => { abort.abort() }
  }, [controller, devBinding?.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const criteria = record?.criteria ?? []
  const coveredCriteria = criteria.filter((c) => workPackage.covers.includes(c.id))
  const latestDevSession = devBinding ? props.sessions?.summariesById[devBinding.sessionId] : undefined
  const isWaiting = devBinding !== undefined && (props.waitingIds?.has(devBinding.sessionId) ?? false)

  // One-sentence summary: the LAST text entry's first 100 chars
  const summaryText = digest !== 'loading' && digest !== 'error' && digest !== 'missing' && digest !== 'no-session'
    ? [...digest.entries].reverse().find((e) => e.kind === 'text' && e.text !== undefined)?.text?.slice(0, 100)
    : undefined

  const renderLiveEntry = (entry: ExecutionDigest['entries'][number], index: number): ReactNode => {
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    switch (entry.kind) {
      case 'turn-start':
        return <div key={index} className={styles.executionTurnBoundary}>{t('execution.turnN').replaceAll('{n}', String(entry.turn))}</div>
      case 'turn-end':
        return null // collapsed — the next turn-start is the visual boundary
      case 'step-start':
        return null // steps render as their tool/text children
      case 'tool-call':
        return (
          <div key={index} className={styles.executionToolRow}>
            <span className={styles.executionToolIcon}>🔧</span>
            <span className={styles.executionToolName}>{entry.toolName}</span>
            {entry.toolArgsPreview !== undefined ? <span className={styles.executionToolArgs}>{entry.toolArgsPreview.slice(0, 80)}</span> : null}
            {entry.resultPreview !== undefined ? <span className={styles.executionToolResult}>{entry.resultPreview.slice(0, 60)}</span> : null}
            <span className={styles.executionTime}>{time}</span>
          </div>
        )
      case 'text':
        return entry.text !== undefined ? (
          <div key={index} className={styles.executionTextRow}>
            <span className={styles.executionToolIcon}>📝</span>
            <span className={styles.executionTextPreview}>{entry.text.slice(0, 120)}</span>
            <span className={styles.executionTime}>{time}</span>
          </div>
        ) : null
      case 'user-message':
        return entry.text !== undefined ? (
          <div key={index} className={styles.executionUserRow}>
            <span className={styles.executionToolIcon}>👤</span>
            <span className={styles.executionTextPreview}>{entry.text.slice(0, 80)}</span>
          </div>
        ) : null
    }
  }

  return (
    <div className={styles.executionSection}>
      {/* Header row: back + WP identity + jump */}
      <div className={styles.executionHeader}>
        <button type="button" className={styles.ghostButton} onClick={props.onBack}>
          ← {t('execution.backToBoard')}
        </button>
        <Tag tone={STATUS_TAG_TONE[workPackage.status]}>{t(STATUS_LABEL_KEY[workPackage.status])}</Tag>
        <span className={styles.executionWpTitle}>{workPackage.id}　{workPackage.title}</span>
        {summaryText !== undefined ? <span className={styles.executionSummary}>{summaryText}</span> : null}
        <span className={styles.executionSpacer} />
        {devBinding !== undefined ? (
          <button type="button" className={styles.ghostButton} onClick={() => { props.onNavigateSession(devBinding.sessionId) }}>
            {t('execution.jumpToSession')}
          </button>
        ) : null}
      </div>

      {/* Dual-column body */}
      <div className={styles.executionBody}>
        {/* Left narrow: execution archive (pure ledger data) */}
        <div className={styles.executionArchive}>
          <div className={styles.sectionTitle}>{t('execution.archiveTitle')}</div>
          {coveredCriteria.length > 0 ? (
            <div className={styles.executionArchiveBlock}>
              <span className={styles.executionArchiveLabel}>{t('criteria.sectionTitle')}</span>
              {coveredCriteria.map((c) => (
                <div key={c.id} className={styles.executionArchiveRow}>{c.id} {c.text.slice(0, 40)}</div>
              ))}
            </div>
          ) : null}
          {workPackage.plans.length > 0 ? (
            <div className={styles.executionArchiveBlock}>
              <span className={styles.executionArchiveLabel}>{t('detail.planSection')}</span>
              {[...workPackage.plans].sort((a, b) => b.version - a.version).map((plan) => (
                <div key={plan.version} className={styles.executionArchiveRow}>
                  v{plan.version} {plan.approvedAt !== undefined ? '✓' : '…'} {plan.note?.slice(0, 30) ?? ''}
                </div>
              ))}
            </div>
          ) : null}
          {workPackage.sessions.length > 0 ? (
            <div className={styles.executionArchiveBlock}>
              <span className={styles.executionArchiveLabel}>{t('detail.sessionsSection')}</span>
              {workPackage.sessions.map((binding) => {
                const summary = props.sessions?.summariesById[binding.sessionId]
                return (
                  <div key={binding.sessionId + binding.purpose} className={styles.executionArchiveRow}>
                    {binding.purpose === 'dev' ? 'dev' : binding.purpose} · {summary?.displayTitle ?? binding.sessionId.slice(0, 8)}
                    {summary !== undefined ? ` · ${t(sessionChipState(props.waitingIds?.has(binding.sessionId) ?? false, summary.running, summary.blank).labelKey)}` : ''}
                  </div>
                )
              })}
            </div>
          ) : null}
          {(workPackage.declarations ?? []).length > 0 ? (
            <div className={styles.executionArchiveBlock}>
              <span className={styles.executionArchiveLabel}>{t('declareCard.sectionTitle')}</span>
              {(workPackage.declarations ?? []).map((decl) => (
                <div key={decl.seq} className={styles.executionArchiveRow}>#{decl.seq} · {decl.at.slice(0, 16).replace('T', ' ')}</div>
              ))}
            </div>
          ) : null}
          {workPackage.acceptances.length > 0 ? (
            <div className={styles.executionArchiveBlock}>
              <span className={styles.executionArchiveLabel}>{t('detail.acceptanceSection')}</span>
              {workPackage.acceptances.map((acc, i) => (
                <div key={i} className={styles.executionArchiveRow}>
                  {acc.result === 'pass' ? '✓' : '✗'} {acc.at.slice(0, 16).replace('T', ' ')} {acc.note?.slice(0, 30) ?? ''}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right wide: collapsed live view */}
        <div className={styles.executionLive}>
          <div className={styles.sectionTitle}>{t('execution.liveTitle')}</div>
          {digest === 'loading' ? <div className={styles.formHint}>{t('page.loading')}</div> : null}
          {digest === 'error' ? <div className={styles.fieldError}>{t('execution.loadError')}</div> : null}
          {digest === 'missing' ? <div className={styles.formHint}>{t('execution.noSession')}</div> : null}
          {digest === 'no-session' ? <div className={styles.formHint}>{t('execution.noSession')}</div> : null}
          {digest !== 'loading' && digest !== 'error' && digest !== 'missing' && digest !== 'no-session' ? (
            <>
              <div className={styles.executionEntryList}>
                {digest.entries.map(renderLiveEntry)}
              </div>
              {/* Metrics line */}
              <div className={styles.executionMetrics}>
                {digest.totalTokens !== undefined ? <span>{t('execution.tokens').replaceAll('{n}', formatTokens(digest.totalTokens))}</span> : null}
                {digest.model !== undefined ? <span> · {digest.model}</span> : null}
                {digest.fileChanges.length > 0 ? <span> · {t('execution.filesChanged').replaceAll('{n}', String(digest.fileChanges.length))}</span> : null}
                {digest.queuedMessageCount > 0 ? <span> · {t('execution.queued').replaceAll('{n}', String(digest.queuedMessageCount))}</span> : null}
                {digest.unknownEventCount > 0 ? <span className={styles.executionUnknown}> · ?{digest.unknownEventCount}</span> : null}
              </div>
              {digest.fileChanges.length > 0 ? (
                <div className={styles.executionFileChanges}>
                  {digest.fileChanges.map((path) => (
                    <span key={path} className={styles.executionFileChip}>{path.split(/[\\/]/).pop()}</span>
                  ))}
                </div>
              ) : null}
              {digest.deliverableFiles.length > 0 ? (
                <div className={styles.executionDeliverables}>
                  {digest.deliverableFiles.map((file) => (
                    <span key={file.path} className={styles.executionFileChip} title={file.description}>📦 {file.path.split(/[\\/]/).pop()}</span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Sticky waiting bar */}
      {isWaiting && devBinding !== undefined ? (
        <div className={styles.executionWaitingBar}>
          <button type="button" className={styles.primaryButton} onClick={() => { props.onNavigateSession(devBinding.sessionId) }}>
            {t('execution.waitingForYou')} →
          </button>
        </div>
      ) : null}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
