/**
 * Requirements page: header (title), then ONE of two in-panel views (0003
 * route B): the list view (filter + sort bar, failure banners, skeleton/list
 * with the add card leading the one-column list) or the detail view (back
 * affordance + requirement switcher + tab strip in the header, active tab
 * panel in the body). Only the body's content swaps —
 * the form/delete dialogs and the scroll container live at this page level
 * and survive view switches. The filter text, the sort direction and the
 * active tab ride the store (0004 P1): the host's keyed main slot has no
 * keep-alive, so a panel switch unmounts this component — store-held view
 * state survives the round-trip, and openDetail resets the tab only when the
 * selection moves to another requirement.
 *
 * Ordering is a pure view projection: the ledger keeps file order as its
 * truth, and this page filters then sorts the snapshot for display
 * (sortRequirements). Presentation only: data flows in through props
 * (store snapshot via useSyncExternalStore, controller actions), no ctx in
 * the view layer.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconChecklistOutlineMedium, IconChevronDownOutlineMedium, IconChevronLeftOutlineMedium, IconClockOutlineRegular, IconCloseOutlineRegular, IconListPenOutlineRegular, IconSearchOutlineRegular, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { RequirementDetailPanel, RequirementDetailTabs } from './detail.js'
import { RequirementsList } from './list.js'
import { RequirementForm } from './requirement-form.js'
import type { RequirementDetailTab, RequirementsDetailTabsStore } from './register.js'
import type { RequirementsStore, RequirementSort } from './store.js'
import { sortRequirements } from './store.js'
import styles from './view.module.css'

/** Sort-direction copy: one entry per RequirementSort, so the union cannot
 *  grow without this record erroring (the BANNER_KEY discipline). */
const SORT_KEY = {
  'created-desc': 'view.sortCreatedDesc',
  'created-asc': 'view.sortCreatedAsc',
} as const satisfies Record<RequirementSort, Parameters<RequirementsT>[0]>

/** Menu row order is fixed and independent of the active direction: a menu
 *  that reordered itself under the pointer would make the second click a
 *  moving target. Newest-first leads because it is the default. Labels need
 *  the bound dictionary, so the rows are built in the component. */
const SORT_IDS: readonly RequirementSort[] = ['created-desc', 'created-asc']

/**
 * Sidebar.panellist glyph: the host shell owns the button chrome (tooltip,
 * aria, active styling, click wiring); this component only draws the icon at
 * the requested size (16 wide / 18 rail). `active` stays unconsumed —
 * activation feedback belongs to the shell.
 */
export function RequirementsIcon(props: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconListPenOutlineRegular size={props.size} />
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
  // Switcher menu open flag: a pure transient (dies with the component on a
  // panel switch) — unlike the tab/filter, nothing is lost by dropping it.
  const [switchOpen, setSwitchOpen] = useState(false)
  // Sort menu open flag: same class of transient as switchOpen — dropping it
  // on a panel switch loses nothing (the direction itself is store-held).
  const [sortOpen, setSortOpen] = useState(false)
  // In-place menus don't reposition on scroll (no portal tracking): close
  // instead — scrolling away is a leave intent. The capture listener hears
  // EVERY scroll (scroll events don't bubble but do capture), so the menu's
  // own list scrolling must be excluded or the list could never scroll
  // (each wheel tick would close the menu).
  useEffect(() => {
    if (!switchOpen) return
    const close = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return
      setSwitchOpen(false)
    }
    window.addEventListener('scroll', close, { capture: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [switchOpen])
  // null = list view; a record = detail view; undefined = the id outlived
  // its record (missing branch).
  const selected = state.selectedId === null
    ? null
    : state.requirements.find((requirement) => requirement.id === state.selectedId)
  // Active detail tab (store-held, 0004): a PER-REQUIREMENT memory — each
  // requirement lands on the tab it was last viewed on; no entry yet (or a
  // retired tab id) falls back to the first tab.
  const rememberedTabId = state.selectedId === null ? undefined : state.detailTabByRequirement[state.selectedId]
  const activeTab: RequirementDetailTab | undefined = detailTabs.find((tab) => tab.id === rememberedTabId) ?? detailTabs[0]
  // Menu rows for the sort control, rebuilt per render so the labels track the
  // bound dictionary (a locale switch mid-panel changes them with everything
  // else). Row order stays SORT_IDS — independent of the active direction.
  const sortItems: readonly MenuEntry[] = SORT_IDS.map((id) => ({ id, label: t(SORT_KEY[id]) }))
  const needle = state.listFilter.trim().toLowerCase()
  // Filter first, then order: the filter decides WHICH rows exist, the sort
  // decides the order they read in. Both are pure projections of the store
  // snapshot — the ledger keeps file order and never hears about either.
  const visibleRequirements = sortRequirements(
    needle.length === 0
      ? state.requirements
      : state.requirements.filter((requirement) =>
          requirement.title.toLowerCase().includes(needle)
          || requirement.description.toLowerCase().includes(needle)),
    state.listSort,
  )

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
                <IconChevronLeftOutlineMedium />
                <span>{t('detail.back')}</span>
              </button>
              {/* Requirement switcher (0004 P2): one-step swap without the
                  list round-trip. Renders only with something to switch to;
                  selection rides openDetail into the per-requirement tab
                  memory. In-place (NOT portal): the cap on the list height
                  rides the className → [role=menu] descendant selector — a
                  portaled list lands under document.body, out of the
                  owner's selector reach; the header chain has no overflow
                  clip, and scrolling the page closes the menu instead. */}
              {selected !== undefined && state.requirements.length > 1 ? (
                <Menu
                  open={switchOpen}
                  onClose={() => setSwitchOpen(false)}
                  className={styles.detailSwitchMenu}
                  autoFocus
                  dense
                  items={state.requirements.map((requirement) => ({ id: requirement.id, label: requirement.title }))}
                  selectedId={selected.id}
                  onSelect={(id) => {
                    setSwitchOpen(false)
                    controller.openDetail(id)
                  }}
                  anchor={(
                    <button
                      type="button"
                      className={styles.detailSwitch}
                      disabled={state.busy}
                      onClick={() => setSwitchOpen(true)}
                    >
                      <IconChecklistOutlineMedium />
                      <span>{t('detail.switch')}</span>
                      <IconChevronDownOutlineMedium />
                    </button>
                  )}
                />
              ) : null}
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
            icon={<IconSearchOutlineRegular size={16} />}
            spellCheck={false}
            aria-label={t('view.filterPlaceholder')}
            onChange={(event) => controller.setListFilter(event.target.value)}
          />
          {/* Sort sits with the search field, not at the bar's far end: both
              shape WHICH rows you see, so they read as one control cluster.
              The button labels the CURRENT direction (the menu is the affordance
              to change it), so the order is legible without opening anything.
              Portal mode, like the row menus: this bar lives inside .body,
              whose overflow: auto clips an in-place list. (The detail switcher
              above is in-place for the opposite reason — it sits in the header,
              outside any clip, and its CSS height cap needs the list reachable
              by the owner's selector.) */}
          <Menu
            open={sortOpen}
            onClose={() => setSortOpen(false)}
            items={sortItems}
            selectedId={state.listSort}
            onSelect={(id) => {
              setSortOpen(false)
              // Narrow through the id list instead of casting: Menu hands back
              // a bare string, and an unknown id is a no-op, not a write.
              const next = SORT_IDS.find((candidate) => candidate === id)
              if (next !== undefined) controller.setListSort(next)
            }}
            portal
            dense
            autoFocus
            anchor={(
              <button
                type="button"
                className={styles.sortButton}
                // Purpose + current direction in one name. A bare
                // aria-label="排序" would OVERRIDE the button's visible text,
                // so a screen-reader user could not tell which order they were
                // looking at; and the direction alone ("创建时间倒序") reads as a
                // status rather than a control. The composed name also keeps
                // the visible label inside the accessible name (WCAG 2.5.3).
                aria-label={`${t('view.sort')}: ${t(SORT_KEY[state.listSort])}`}
                title={`${t('view.sort')}: ${t(SORT_KEY[state.listSort])}`}
                onClick={() => setSortOpen(true)}
              >
                <IconClockOutlineRegular size={16} />
                <span>{t(SORT_KEY[state.listSort])}</span>
                <IconChevronDownOutlineMedium />
              </button>
            )}
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
