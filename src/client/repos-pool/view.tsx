/**
 * Repos-pool page: header (title + add button — the P1 toolbar seat),
 * failure banners, the list, and the add/edit form. Presentation only:
 * data flows in through props (store snapshot via useSyncExternalStore,
 * controller actions), no ctx in the view layer.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { IconDatabaseOutline16, IconPlusOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReposPoolController } from './controller.js'
import type { ReposPoolT } from './dictionary.js'
import type { ReposFetcher } from './fetcher.js'
import { ReposList } from './list.js'
import { RepoForm } from './repo-form.js'
import type { ReposPoolStore } from './store.js'
import styles from './view.module.css'

/**
 * Sidebar.panellist glyph: the host shell owns the button chrome (tooltip,
 * aria, active styling, click wiring); this component only draws the icon at
 * the requested size (16 wide / 18 rail). `active` stays unconsumed —
 * activation feedback belongs to the shell.
 */
export function ReposPoolIcon(props: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconDatabaseOutline16 size={props.size} />
}

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

  // Mount: pull the list once (abort on unmount). The controller itself
  // lives with the registration disposer — the task-graph lazy pattern,
  // collapsed to "refresh on mount".
  useEffect(() => {
    const abort = new AbortController()
    void controller.refresh(abort.signal)
    return () => abort.abort()
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
        {state.banner ? (
          <div className={styles.banner} role="alert">
            {t(BANNER_KEY[state.banner.code])}
          </div>
        ) : null}
        {state.phase === 'loading' ? (
          <div className={styles.phaseRow}>
            <StateDot state="ongoing" />
            <span className={styles.fieldHint}>{t('page.loading')}</span>
          </div>
        ) : null}
        {state.phase === 'load-error' ? (
          <div className={styles.banner} role="alert">{t('error.network')}</div>
        ) : null}
        {state.phase === 'degraded' ? (
          <div className={styles.banner} role="alert">
            {t('page.degraded')}
            {state.degraded?.hasBackup ? <div className={styles.bannerHint}>{t('page.degradedBackupHint')}</div> : null}
          </div>
        ) : null}
        {state.repos.length === 0 && state.phase !== 'loading' && state.phase !== 'load-error' ? (
          <div className={styles.empty}>{t('page.empty')}</div>
        ) : null}
        {state.repos.length > 0 ? (
          <ReposList
            t={t}
            repos={state.repos}
            disabled={state.busy}
            onEdit={(repo) => controller.openEdit(repo)}
            onRemove={(repo) => void controller.remove(repo.id)}
          />
        ) : null}
      </div>
      {state.editing.kind !== 'closed' ? (
        <RepoForm
          t={t}
          editing={state.editing}
          revision={state.revision}
          fetcher={fetcher}
          controller={controller}
        />
      ) : null}
    </section>
  )
}
