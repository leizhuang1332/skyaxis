/**
 * Requirements list: a dashed add card leading the ONE-column list, then one
 * row per record — a clickable main body (opens the detail view) carrying
 * title, creation time (right end of the title line), description (when set),
 * and a sibling row menu (edit / remove-danger).
 * The body is a button SIBLING of the menu anchor, never its parent:
 * buttons cannot nest. Host primitives only; colors ride the alias tokens
 * via view.module.css.
 *
 * The list renders in the order it is handed — ordering is the page's
 * projection (sortRequirements over the store's listSort), not this
 * component's business, so the rows stay a faithful rendering of the input.
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

/**
 * Record creation time for the row: `YYYY-MM-DD HH:mm` in the BROWSER's local
 * zone, hand-assembled from the local date fields.
 *
 * Not `iso.slice(0, 16)` — the ledger stores UTC (`new Date().toISOString()`
 * host-side), so slicing the wire string would print a UTC clock that reads up
 * to a day off for an evening record east of Greenwich. Not `Intl.DateTimeFormat`
 * either: its field order and separators ride the runtime locale, so the row
 * would reflow per browser language while the ledger's own timestamps stay
 * fixed-shape. An unparsable value renders '' and the caller drops the time —
 * a row never shows `Invalid Date`.
 */
export function createdAtText(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function RequirementRow(props: {
  t: RequirementsT
  requirement: RequirementRecord
  disabled: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t, requirement, disabled } = props
  const entries: readonly MenuEntry[] = [
    { id: 'edit', label: t('menu.edit') },
    { id: 'remove', label: t('menu.remove'), danger: true },
  ]
  const created = createdAtText(requirement.createdAt)
  return (
    <li className={styles.row}>
      {/* Row main is the open affordance; its accessible name comes from the
          record text, so no extra aria — keyboard reachability is native. */}
      <button type="button" className={styles.rowMain} disabled={disabled} onClick={props.onOpen}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{requirement.title}</span>
          {/* Creation time rides the title line's right end: the row is one
              column now, so there is a real second cell to use, and the menu
              anchor stays the row's only trailing affordance. The full wire
              timestamp goes to title — the row shows minutes, the hover gives
              seconds and the zone offset. */}
          {created.length > 0 ? (
            <span className={styles.rowTime} title={requirement.createdAt}>
              {t('view.createdPrefix')} {created}
            </span>
          ) : null}
        </div>
        {requirement.description ? <div className={styles.rowDesc}>{requirement.description}</div> : null}
      </button>
      <div className={styles.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={entries}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'edit') props.onEdit()
            if (id === 'remove') props.onRemove()
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={styles.iconButton}
              disabled={disabled}
              aria-label={t('menu.edit')}
              title={requirement.title}
              onClick={() => setMenuOpen(true)}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
        />
      </div>
    </li>
  )
}

/**
 * Add-requirement card: always the first grid cell. The whole card is one
 * button with a visible label — the affordance reads without hover, and the
 * empty list is simply this card alone.
 */
function AddRequirementCard(props: {
  label: string
  disabled: boolean
  onAdd: () => void
}): ReactNode {
  return (
    <li className={styles.addRow}>
      <button
        type="button"
        className={styles.addButton}
        disabled={props.disabled}
        onClick={props.onAdd}
      >
        <IconPlusOutline16 />
        <span>{props.label}</span>
      </button>
    </li>
  )
}

export function RequirementsList(props: {
  t: RequirementsT
  requirements: readonly RequirementRecord[]
  addLabel: string
  disabled: boolean
  onAdd: () => void
  onOpen: (requirement: RequirementRecord) => void
  onEdit: (requirement: RequirementRecord) => void
  onRemove: (requirement: RequirementRecord) => void
}): ReactNode {
  return (
    <ul className={styles.list}>
      <AddRequirementCard label={props.addLabel} disabled={props.disabled} onAdd={props.onAdd} />
      {props.requirements.map((requirement) => (
        <RequirementRow
          key={requirement.id}
          t={props.t}
          requirement={requirement}
          disabled={props.disabled}
          onOpen={() => props.onOpen(requirement)}
          onEdit={() => props.onEdit(requirement)}
          onRemove={() => props.onRemove(requirement)}
        />
      ))}
    </ul>
  )
}
