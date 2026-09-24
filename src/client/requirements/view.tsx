/**
 * Requirements page: header (title + add button — the P1 toolbar seat),
 * failure banners, the list, and the add/edit form. Presentation only:
 * data flows in through props (store snapshot via useSyncExternalStore,
 * controller actions), no ctx in the view layer.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { IconListPenOutline16, IconPlusOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { RequirementsList } from './list.js'
import { RequirementForm } from './requirement-form.js'
import type { RequirementsStore } from './store.js'
import styles from './view.module.css'

/**
 * Sidebar.panellist glyph: the host shell owns the button chrome (tooltip,
 * aria, active styling, click wiring); this component only draws the icon at
 * the requested size (16 wide / 18 rail). `active` stays unconsumed —
 * activation feedback belongs to the shell.
 */
export function RequirementsIcon(props: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconListPenOutline16 size={props.size} />
}

const BANNER_KEY = {
  'conflict': 'error.conflict',
  'network': 'error.network',
  'unreadable-file': 'error.unreadableFile',
  'not-found': 'error.notFound',
  'bad-request': 'error.internal',
  'internal': 'error.internal',
} as const satisfies Record<NonNullable<import('./store.js').RequirementsState['banner']>['code'], Parameters<RequirementsT>[0]>

export function RequirementsPage(props: {
  t: RequirementsT
  store: RequirementsStore
  controller: RequirementsController
}): ReactNode {
  const { t, store, controller } = props
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
          aria-label={t('view.addRequirement')}
          title={t('view.addRequirement')}
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
        {state.requirements.length === 0 && state.phase !== 'loading' && state.phase !== 'load-error' ? (
          <div className={styles.empty}>{t('page.empty')}</div>
        ) : null}
        {state.requirements.length > 0 ? (
          <RequirementsList
            t={t}
            requirements={state.requirements}
            disabled={state.busy}
            onEdit={(requirement) => controller.openEdit(requirement)}
            onRemove={(requirement) => void controller.remove(requirement.id)}
          />
        ) : null}
      </div>
      {state.editing.kind !== 'closed' ? (
        <RequirementForm
          t={t}
          editing={state.editing}
          revision={state.revision}
          controller={controller}
        />
      ) : null}
    </section>
  )
}
