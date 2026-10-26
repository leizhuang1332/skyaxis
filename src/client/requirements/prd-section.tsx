/**
 * PRD documents section (P3c): upload (any file, streaming), create Markdown,
 * listing, .md preview, delete-with-confirmation — all against the workspace
 * prds/ directory, which IS the source of truth (scanned, never ledgered).
 *
 * Local state throughout (the status/repos precedents): docs listing, dialogs.
 * Every successful mutation seeds the response's fresh docs immediately —
 * the liveness lesson from P3b — no polling (files are disk facts; remount
 * re-pulls). The fetcher is used directly (no ledger writes → no store rows).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  FileTypeIcon,
  IconEllipsisOutlineRegular,
  IconPaperclipOutlineRegular,
  IconPlusOutlineRegular,
  Input,
  MarkdownText,
  Menu,
  Modal,
  Tag,
  fileSizeText,
  relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PrdDocSummary, RequirementRecord } from '../../requirements-shared/protocol.js'
import { PRD_CREATE_MAX_CHARS, PRD_UPLOAD_MAX_BYTES } from '../../requirements-shared/prd-file.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { createRequirementsFetcher } from './fetcher.js'
import type { PrdContentResult, PrdDocsResult } from './fetcher.js'
import styles from './view.module.css'

type DocsState =
  | { kind: 'loading' }
  | { kind: 'ready'; docs: readonly PrdDocSummary[] }
  | { kind: 'error' }

const fetcher = createRequirementsFetcher()

function usePrdDocs(requirementId: string): [DocsState, (docs: readonly PrdDocSummary[]) => void] {
  const [state, setState] = useState<DocsState>({ kind: 'loading' })
  useEffect(() => {
    setState({ kind: 'loading' })
    const abort = new AbortController()
    void fetcher.prdDocs(requirementId, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      setState(result.kind === 'ok' ? { kind: 'ready', docs: result.docs } : { kind: 'error' })
    })
    return () => abort.abort()
  }, [requirementId])
  const seed = (docs: readonly PrdDocSummary[]): void => {
    setState({ kind: 'ready', docs })
  }
  return [state, seed]
}

/** relativeTime bucket copy; {n} is replaced inline (the plugin owns the words). */
function timeText(t: RequirementsT, at: number, now: number): string {
  const { unit, n } = relativeTime(at, now)
  if (unit === 'now') return t('prd.timeNow')
  return t(`prd.time${unit[0].toUpperCase()}${unit.slice(1)}` as 'prd.timeMinutes').replace('{n}', String(n))
}

/** Inline error copy per rejection code (typed map, not a template key). */
const INLINE_ERROR_KEYS: Readonly<Record<'duplicate-name' | 'too-large' | 'no-workspace' | 'bad-content-type' | 'bad-request', Parameters<RequirementsT>[0]>> = {
  'duplicate-name': 'prd.errDuplicate',
  'too-large': 'prd.errTooLarge',
  'no-workspace': 'prd.errNoWorkspace',
  'bad-content-type': 'prd.errInvalidName',
  'bad-request': 'prd.errInvalidName',
}

function inlineCopy(t: RequirementsT, result: PrdDocsResult | PrdContentResult | undefined): string | null {
  if (result === undefined || result.kind === 'ok') return null
  if (result.kind === 'network') return t('prd.loadError')
  const key = INLINE_ERROR_KEYS[result.code as 'duplicate-name']
  return key !== undefined ? t(key) : t('prd.loadError')
}

export function PrdSection(props: {
  t: RequirementsT
  requirement: RequirementRecord
  controller: RequirementsController
}): ReactNode {
  const { t, requirement } = props
  const [docsState, seedDocs] = usePrdDocs(requirement.id)
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState<string | null>(null)

  const docs = docsState.kind === 'ready' ? docsState.docs : []

  const empty = docsState.kind === 'ready' && docs.length === 0

  return (
    <div className={styles.repoSection}>
      {empty ? (
        /* Empty state mirrors the repos section (P3c feedback): the dashed
           action card IS the button — title row + head button stay hidden. */
        <>
          <div className={styles.sectionTitle}>{t('workspace.sectionPrd')}</div>
          <button type="button" className={styles.repoAddCard} aria-label={t('prd.create')} onClick={() => setCreateOpen(true)}>
            <IconPlusOutlineRegular size={16} />
            <span className={styles.setupHint}>{t('prd.emptyHint')}</span>
            <span className={styles.setupAction}>{t('prd.create')}</span>
          </button>
        </>
      ) : (
        <div className={styles.repoSectionHead}>
          <div className={styles.sectionTitle}>{t('workspace.sectionPrd')}</div>
          {/* One entry (P3c feedback): the create dialog also carries the
              upload affordance — pick a file there and it uploads immediately. */}
          <Button variant="ghost" size="sm" icon={<IconPlusOutlineRegular size={16} />} onClick={() => setCreateOpen(true)}>
            {t('prd.create')}
          </Button>
        </div>
      )}

      {docsState.kind === 'error' ? <div className={styles.fieldError}>{t('prd.loadError')}</div> : null}

      {docs.map((doc) => (
        <PrdRow
          key={doc.name}
          t={t}
          doc={doc}
          onDelete={() => setPendingDelete(doc.name)}
          onPreview={() => setPreviewName(doc.name)}
        />
      ))}

      {createOpen ? (
        <CreatePrdModal
          t={t}
          onCancel={() => setCreateOpen(false)}
          onCreated={(docs$1) => {
            setCreateOpen(false)
            seedDocs(docs$1)
          }}
          onUploadError={() => void props.controller.refresh()}
          requirementId={requirement.id}
        />
      ) : null}

      {pendingDelete !== null ? (
        <Modal
          open
          onClose={() => setPendingDelete(null)}
          title={`${t('prd.deleteTitle')} — ${pendingDelete}`}
          closeLabel={t('form.closeLabel')}
          description={t('prd.deleteDesc')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>{t('form.cancel')}</Button>
              <Button
                variant="primary"
                className={styles.dangerButton}
                onClick={() => {
                  const name = pendingDelete
                  setPendingDelete(null)
                  void fetcher.deletePrdDoc(requirement.id, name).then((result) => {
                    if (result.kind === 'ok') seedDocs(result.docs)
                  })
                }}
              >
                {t('prd.deleteConfirm')}
              </Button>
            </>
          )}
        />
      ) : null}

      {previewName !== null ? (
        <PreviewModal t={t} requirementId={requirement.id} name={previewName} onClose={() => setPreviewName(null)} />
      ) : null}
    </div>
  )
}

function PrdRow(props: {
  t: RequirementsT
  doc: PrdDocSummary
  onDelete: () => void
  onPreview: () => void
}): ReactNode {
  const { t, doc } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const isMd = doc.name.toLowerCase().endsWith('.md')
  const entries: readonly MenuEntry[] = [
    ...(isMd ? [{ id: 'preview', label: t('prd.preview') }] : []),
    { id: 'delete', label: t('prd.delete'), danger: true },
  ]
  return (
    <div className={styles.repoRow}>
      {/* Click the card to preview (P3c feedback) — markdown only. */}
      {isMd ? (
        <button type="button" className={styles.prdRowMain} onClick={props.onPreview}>
          <div className={styles.prdMain}>
            <span className={styles.prdNameLine}>
              <FileTypeIcon path={doc.name} size={16} />
              <span className={styles.prdName}>{doc.name}</span>
            </span>
            <span className={styles.prdMeta}>
              {fileSizeText(doc.size)} · {timeText(t, doc.modifiedAt, Date.now())}
            </span>
          </div>
        </button>
      ) : (
        <div className={styles.prdMain}>
          <span className={styles.prdNameLine}>
            <FileTypeIcon path={doc.name} size={16} />
            <span className={styles.prdName}>{doc.name}</span>
          </span>
          <span className={styles.prdMeta}>
            {fileSizeText(doc.size)} · {timeText(t, doc.modifiedAt, Date.now())}
          </span>
        </div>
      )}
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={entries}
        portal
        closeOnPointerLeave
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'preview') props.onPreview()
          if (id === 'delete') props.onDelete()
        }}
        anchor={(
          <button type="button" className={styles.iconButton} aria-label={t('prd.menuLabel')} title={doc.name} onClick={() => setMenuOpen(true)}>
            <IconEllipsisOutlineRegular />
          </button>
        )}
      />
    </div>
  )
}

function CreatePrdModal(props: {
  t: RequirementsT
  requirementId: string
  onCancel: () => void
  onCreated: (docs: readonly PrdDocSummary[]) => void
  onUploadError: () => void
}): ReactNode {
  const { t } = props
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file again still fires change.
    event.target.value = ''
    if (file === undefined) return
    if (file.size > PRD_UPLOAD_MAX_BYTES) {
      setError(t('prd.errTooLarge'))
      return
    }
    setUploading(true)
    setError(null)
    const result = await fetcher.uploadPrdDoc(props.requirementId, file.name, file)
    setUploading(false)
    if (result.kind === 'ok') {
      props.onCreated(result.docs)
      return
    }
    setError(inlineCopy(t, result) ?? t('prd.loadError'))
    if (result.kind === 'http-error' && result.status === 404) props.onUploadError()
  }

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError(t('prd.errInvalidName'))
      return
    }
    if (content.length > PRD_CREATE_MAX_CHARS) {
      setError(t('prd.errTooLarge'))
      return
    }
    // Predictable suffix: '搜索方案' → '搜索方案.md', 'v1.2' → 'v1.2.md'.
    const finalName = trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`
    setSubmitting(true)
    const result = await fetcher.createPrdDoc({ id: props.requirementId, action: 'create', name: finalName, content })
    setSubmitting(false)
    if (result.kind === 'ok') {
      props.onCreated(result.docs)
      return
    }
    setError(inlineCopy(t, result) ?? t('prd.loadError'))
  }

  return (
    <Modal
      open
      onClose={props.onCancel}
      title={t('prd.createTitle')}
      closeLabel={t('form.closeLabel')}
      className={styles.prdWideDialog}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onCancel}>{t('form.cancel')}</Button>
          <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('form.submitting') : t('form.submit')}
          </Button>
        </>
      )}
    >
      {/* Two ways, one pick (P3c feedback): upload on the left is the
          recommended path (whole card is the picker); manual markdown on
          the right. Either action completes on its own. */}
      <div className={styles.prdCreateGrid}>
        <div className={styles.prdUploadPane}>
          <div className={styles.prdPaneTitle}>
            {t('prd.upload')}
            <Tag tone="info">{t('prd.recommend')}</Tag>
          </div>
          <button
            type="button"
            className={styles.prdUploadCard}
            aria-label={t('prd.upload')}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPaperclipOutlineRegular size={16} />
            <span className={styles.setupHint}>{t('prd.uploadHint')}</span>
          </button>
          <input ref={fileInputRef} type="file" hidden onChange={(event) => void onPickFile(event)} />
        </div>
        <div className={styles.prdFormPane}>
          <div className={styles.prdPaneTitle}>{t('prd.manualCreate')}</div>
          <label className={styles.fieldLabel}>
            {t('prd.nameLabel')}
            <Input
              value={name}
              placeholder={t('prd.namePlaceholder')}
              maxLength={128}
              onChange={(event) => { setName(event.target.value); setError(null) }}
            />
          </label>
          <div className={styles.setupHint}>{t('prd.mdSuffixHint')}</div>
          <label className={styles.fieldLabel}>
            {t('prd.contentLabel')}
            <textarea
              className={styles.textarea}
              value={content}
              rows={10}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          {error !== null ? <div className={styles.fieldError}>{error}</div> : null}
        </div>
      </div>
    </Modal>
  )
}

function PreviewModal(props: {
  t: RequirementsT
  requirementId: string
  name: string
  onClose: () => void
}): ReactNode {
  const { t, name } = props
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [text, setText] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    setState('loading')
    void fetcher.prdDocContent(props.requirementId, name, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      if (result.kind === 'ok') {
        setText(result.text)
        setState('ready')
      } else {
        setState('error')
      }
    })
    return () => abort.abort()
  }, [props.requirementId, name])

  // Stable identity — MarkdownText's memo drops its render cache otherwise.
  const labels = useMemo(() => ({
    code: { copyLabel: t('prd.mdCopyCode'), copiedLabel: t('prd.mdCopiedCode') },
    footnotes: t('prd.mdFootnotes'),
  }), [t])

  return (
    <Modal open onClose={props.onClose} title={name} closeLabel={t('form.closeLabel')} className={styles.prdWideDialog}>
      {state === 'loading' ? <div className={styles.setupHint}>{t('form.submitting')}</div> : null}
      {state === 'error' ? <div className={styles.fieldError}>{t('prd.previewFailed')}</div> : null}
      {state === 'ready' ? (
        <div className={styles.prdPreviewBody}>
          <MarkdownText text={text} labels={labels} />
        </div>
      ) : null}
    </Modal>
  )
}
