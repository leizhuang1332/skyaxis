/**
 * Repos-pool page: header (title + add button), filter bar, failure banners
 * (dismissible), skeleton/list, the add/edit form, and the delete confirm
 * dialog. Presentation only: data flows in through props (store snapshot via
 * useSyncExternalStore, controller actions), no ctx in the view layer.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconCloseOutline16, IconDatabaseOutline16, IconPlusOutline16, IconSearchOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RepoRecord } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolController } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import type { ReposFetcher } from './fetcher.js'
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
  const needle = filter.trim().toLowerCase()
  const visibleRepos = needle.length === 0
    ? state.repos
    : state.repos.filter((repo) =>
        repo.name.toLowerCase().includes(needle)
        || repo.url.toLowerCase().includes(needle)
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
        {/* Quiet icon button — the host "New session" idiom (icon-only,
            aria-label + native tooltip), not a toolbar Button. */}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('view.addRepo')}
          title={t('view.addRepo')}
          disabled={state.busy}
          onClick={() => controller.openCreate()}
        >
          <IconPlusOutline16 />
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.filterBar}>
          <Input
            className={styles.filterInput}
            value={filter}
            placeholder={t('view.filterPlaceholder')}
            icon={<IconSearchOutline16 size={16} />}
            spellCheck={false}
            aria-label={t('view.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
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
              <IconCloseOutline16 />
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
        {state.repos.length === 0 && state.phase !== 'loading' && state.phase !== 'load-error' ? (
          <div className={styles.empty}>{t('page.empty')}</div>
        ) : null}
        {state.repos.length > 0 && visibleRepos.length === 0 ? (
          <div className={styles.empty}>{t('view.filterEmpty')}</div>
        ) : null}
        {visibleRepos.length > 0 ? (
          <ReposList
            t={t}
            repos={visibleRepos}
            disabled={state.busy}
            onEdit={(repo) => controller.openEdit(repo)}
            onRemove={(repo) => setPendingRemove(repo)}
          />
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
  return <IconDatabaseOutline16 size={props.size} />
}
