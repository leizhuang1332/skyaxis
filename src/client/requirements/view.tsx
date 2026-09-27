/**
 * Requirements page: header (title), then ONE of two in-panel views (0003
 * route B): the list view (filter bar, failure banners, skeleton/list with
 * the add card leading the grid) or the detail view (tab strip in the
 * header + active tab panel in the body). Only the body's content swaps —
 * the form/delete dialogs and the scroll container live at this page level
 * and survive view switches. The filter text and the active tab ride the
 * store (0004 P1): the host's keyed main slot has no keep-alive, so a panel
 * switch unmounts this component — store-held view state survives the
 * round-trip, and openDetail resets the tab only when the selection moves
 * to another requirement. Presentation only: data flows in through props
 * (store snapshot via useSyncExternalStore, controller actions), no ctx in
 * the view layer.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconChevronLeftOutline14, IconCloseOutline16, IconListPenOutline16, IconSearchOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { RequirementDetailPanel, RequirementDetailTabs } from './detail.js'
import { RequirementsList } from './list.js'
import { RequirementForm } from './requirement-form.js'
import type { RequirementDetailTab, RequirementsDetailTabsStore } from './register.js'
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
  detailTabs: RequirementsDetailTabsStore
  renderSlot: PropsRenderSlots<'requirements.detail.view'>['renderSlot']
}): ReactNode {
  const { t, store, controller } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const detailTabs = useSyncExternalStore(props.detailTabs.subscribe, props.detailTabs.getSnapshot)
  const [pendingRemove, setPendingRemove] = useState<RequirementRecord | null>(null)
  // null = list view; a record = detail view; undefined = the id outlived
  // its record (missing branch).
  const selected = state.selectedId === null
    ? null
    : state.requirements.find((requirement) => requirement.id === state.selectedId)
  // Active detail tab (store-held, 0004 P1): null = unselected, falls back
  // to the first tab; openDetail resets it when the selection moves.
  const activeTab: RequirementDetailTab | undefined = detailTabs.find((tab) => tab.id === state.detailTabId) ?? detailTabs[0]
  const needle = state.listFilter.trim().toLowerCase()
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
        {/* Detail state owns the header: a back affordance plus the record
            title as the heading (the panel title returns with the list).
            A missing record falls back to the panel title — the body shows
            the missing notice. */}
        {selected !== null ? (
          <div className={styles.detailHeader}>
            <div className={styles.detailHeaderRow}>
              <button
                type="button"
                className={styles.detailBack}
                onClick={() => controller.closeDetail()}
              >
                <IconChevronLeftOutline14 />
                <span>{t('detail.back')}</span>
              </button>
              <div className={styles.titleCluster}>
                <h1 className={styles.title}>{selected !== undefined ? selected.title : t('panel.title')}</h1>
                {selected !== undefined && selected.description ? (
                  <p className={styles.headerDesc}>{selected.description}</p>
                ) : null}
              </div>
            </div>
            {selected !== undefined ? (
              <RequirementDetailTabs tabs={detailTabs} activeId={activeTab?.id} onSelect={controller.selectDetailTab} />
            ) : null}
          </div>
        ) : (
          <h1 className={styles.title}>{t('panel.title')}</h1>
        )}
      </header>
      <div className={styles.body}>
        {selected !== null ? (
          selected === undefined ? (
            <div className={styles.detailNotice}>{t('detail.missing')}</div>
          ) : (
            <RequirementDetailPanel renderSlot={props.renderSlot} activeId={activeTab?.id} requirement={selected} />
          )
        ) : (
        <>
        <div className={styles.filterBar}>
          <Input
            className={styles.filterInput}
            value={state.listFilter}
            placeholder={t('view.filterPlaceholder')}
            icon={<IconSearchOutline16 size={16} />}
            spellCheck={false}
            aria-label={t('view.filterPlaceholder')}
            onChange={(event) => controller.setListFilter(event.target.value)}
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
