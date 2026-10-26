/**
 * Repos-pool page: header (title), filter bar, failure banners (dismissible),
 * skeleton/list (the add card always leads the grid), the add/edit form, and
 * the delete confirm dialog. Presentation only: data flows in through props
 * (store snapshot via useSyncExternalStore, controller actions), no ctx in
 * the view layer.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconDatabaseOutlineRegular, IconDownloadOutlineRegular, IconSearchOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RepoRecord } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolController } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import type { ReposFetcher } from './fetcher.js'
import { ImportDialog } from './import-dialog.js'
import { ReposList } from './list.js'
import { RepoForm } from './repo-form.js'
import type { ReposPoolStore } from './store.js'
import styles from './view.module.css'

const BANNER_KEY = {
  'conflict': 'error.conflict',
  'network': 'error.network',
  'unreadable-file': 'error.unreadableFile',
  'not-found': 'error.notFound',
  'bad-request': 'error.internal',
  'invalid-url': 'error.invalidUrl',
  'duplicate-url': 'error.duplicateUrl',
  'internal': 'error.internal',
} as const satisfies Record<NonNullable<import('./store.js').ReposPoolState['banner']>['code'], Parameters<ReposPoolT>[0]>

export function ReposPoolPage(props: {
  t: ReposPoolT
  store: ReposPoolStore
  controller: ReposPoolController
  fetcher: ReposFetcher
}): ReactNode {
  const { t, store, controller, fetcher } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [filter, setFilter] = useState('')
  const [pendingRemove, setPendingRemove] = useState<RepoRecord | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const needle = filter.trim().toLowerCase()
  const visibleRepos = needle.length === 0
    ? state.repos
    : state.repos.filter((repo) =>
        repo.name.toLowerCase().includes(needle)
        || (repo.urlSsh?.toLowerCase().includes(needle) ?? false)
        || (repo.urlHttp?.toLowerCase().includes(needle) ?? false)
        || repo.description.toLowerCase().includes(needle))

  // Mount + window focus: pull the list (abort the mount pull on unmount).
  // Focus/visibility covers externally edited repos.yaml — the pull-only
  // channel has no push, so "switch back to the tab" is the natural moment.
  useEffect(() => {
    const abort = new AbortController()
    void controller.refresh(abort.signal)
    const onFocus = (): void => {
      void controller.refresh()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') onFocus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      abort.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller])

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('panel.title')}</h1>
      </header>
      <div className={styles.body}>
        <div className={styles.filterBar}>
          <Input
            className={styles.filterInput}
            value={filter}
            placeholder={t('view.filterPlaceholder')}
            icon={<IconSearchOutlineRegular size={16} />}
            spellCheck={false}
            aria-label={t('view.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
          {/* Import entry: enabled only on a ready, non-busy pool — any other
              phase holds a stale or zero revision and the dry-run would 409
              (decision 0004 / D5 degraded gate is a subset of this matrix). */}
          <Button
            variant="ghost"
            icon={<IconDownloadOutlineRegular size={16} />}
            disabled={state.phase !== 'ready' || state.busy}
            onClick={() => setImportOpen(true)}
          >
            {t('view.import')}
          </Button>
        </div>
        {state.banner ? (
          <div className={styles.banner} role="alert">
            <div className={styles.bannerBody}>{t(BANNER_KEY[state.banner.code])}</div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('form.closeLabel')}
              title={t('form.closeLabel')}
              onClick={() => controller.dismissBanner()}
            >
              <IconCloseOutlineRegular />
            </button>
          </div>
        ) : null}
        {state.phase === 'degraded' ? (
          <div className={styles.banner} role="alert">
            <div className={styles.bannerBody}>
              {t('page.degraded')}
              {state.degraded?.hasBackup ? <div className={styles.bannerHint}>{t('page.degradedBackupHint')}</div> : null}
            </div>
          </div>
        ) : null}
        {state.phase === 'loading' ? (
          <div className={styles.list} aria-hidden>
            <div className={styles.skeletonCard}>
              <div className={styles.skeletonLine} style={{ width: '60%' }} />
              <div className={styles.skeletonLine} style={{ width: '40%' }} />
            </div>
            <div className={styles.skeletonCard}>
              <div className={styles.skeletonLine} style={{ width: '55%' }} />
              <div className={styles.skeletonLine} style={{ width: '45%' }} />
            </div>
          </div>
        ) : null}
        {state.phase === 'load-error' ? (
          <div className={styles.banner} role="alert">{t('error.network')}</div>
        ) : null}
        {/* The list always renders outside loading/load-error — its first
            cell is the dashed add card, so the empty state IS that card and
            filtered-out views keep the add affordance in place. */}
        {state.phase !== 'loading' && state.phase !== 'load-error' ? (
          <>
            <ReposList
              t={t}
              repos={visibleRepos}
              addLabel={t('view.addRepo')}
              disabled={state.busy}
              onAdd={() => controller.openCreate()}
              onEdit={(repo) => controller.openEdit(repo)}
              onRemove={(repo) => setPendingRemove(repo)}
            />
            {state.repos.length > 0 && visibleRepos.length === 0 ? (
              <div className={styles.empty}>{t('view.filterEmpty')}</div>
            ) : null}
          </>
        ) : null}
      </div>
      {state.editing.kind !== 'closed' ? (
        <RepoForm
          t={t}
          editing={state.editing}
          revision={state.revision}
          repos={state.repos}
          fetcher={fetcher}
          controller={controller}
        />
      ) : null}
      <ImportDialog
        t={t}
        open={importOpen}
        revision={state.revision}
        controller={controller}
        onClose={() => setImportOpen(false)}
      />
      {pendingRemove !== null ? (
        <Modal
          open
          onClose={() => setPendingRemove(null)}
          title={`${t('delete.title')} — ${pendingRemove.name}`}
          closeLabel={t('form.closeLabel')}
          description={t('delete.description')}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setPendingRemove(null)}>{t('delete.cancel')}</Button>
              <Button
                variant="primary"
                className={styles.dangerButton}
                disabled={state.busy}
                onClick={() => {
                  const id = pendingRemove.id
                  setPendingRemove(null)
                  void controller.remove(id)
                }}
              >
                {t('delete.confirm')}
              </Button>
            </>
          )}
        />
      ) : null}
    </section>
  )
}

/**
 * Sidebar.panellist glyph: the host shell owns the button chrome (tooltip,
 * aria, active styling, click wiring); this component only draws the icon at
 * the requested size (16 wide / 18 rail). `active` stays unconsumed —
 * activation feedback belongs to the shell.
 */
export function ReposPoolIcon(props: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconDatabaseOutlineRegular size={props.size} />
}
