/**
 * Requirements page: header (title), then ONE of two in-panel views (0003
 * route B): the list view (filter bar, failure banners, skeleton/list with
 * the add card leading the grid) or the detail view (RequirementDetail).
 * Only the body's content swaps — the filter state, the form/delete
 * dialogs, and the scroll container live at this page level and survive
 * view switches. Presentation only: data flows in through props (store
 * snapshot via useSyncExternalStore, controller actions), no ctx in the
 * view layer.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconCloseOutline16, IconListPenOutline16, IconSearchOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { RequirementDetail } from './detail.js'
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
  const [filter, setFilter] = useState('')
  const [pendingRemove, setPendingRemove] = useState<RequirementRecord | null>(null)
  // null = list view; a record = detail view; undefined = the id outlived
  // its record (missing branch, rendered by RequirementDetail).
  const selected = state.selectedId === null
    ? null
    : state.requirements.find((requirement) => requirement.id === state.selectedId)
  const needle = filter.trim().toLowerCase()
  const visibleRequirements = needle.length === 0
    ? state.requirements
    : state.requirements.filter((requirement) =>
        requirement.title.toLowerCase().includes(needle)
        || requirement.description.toLowerCase().includes(needle))

  // Mount + window focus: pull the list (abort the mount pull on unmount).
  // Focus/visibility covers externally edited requirements.yaml — the
  // pull-only channel has no push, so "switch back to the tab" is the
  // natural moment.
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
        {selected !== null ? (
          <RequirementDetail t={t} requirement={selected} onBack={() => controller.closeDetail()} />
        ) : (
        <>
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
        {/* The list always renders outside loading/load-error — its first
            cell is the dashed add card, so the empty state IS that card and
            filtered-out views keep the add affordance in place. */}
        {state.phase !== 'loading' && state.phase !== 'load-error' ? (
          <>
            <RequirementsList
              t={t}
              requirements={visibleRequirements}
              addLabel={t('view.addRequirement')}
              disabled={state.busy}
              onAdd={() => controller.openCreate()}
              onOpen={(requirement) => controller.openDetail(requirement.id)}
              onEdit={(requirement) => controller.openEdit(requirement)}
              onRemove={(requirement) => setPendingRemove(requirement)}
            />
            {state.requirements.length > 0 && visibleRequirements.length === 0 ? (
              <div className={styles.empty}>{t('view.filterEmpty')}</div>
            ) : null}
          </>
        ) : null}
        </>
        )}
      </div>
      {state.editing.kind !== 'closed' ? (
        <RequirementForm
          t={t}
          editing={state.editing}
          revision={state.revision}
          controller={controller}
        />
      ) : null}
      {pendingRemove !== null ? (
        <Modal
          open
          onClose={() => setPendingRemove(null)}
          title={`${t('delete.title')} — ${pendingRemove.title}`}
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
