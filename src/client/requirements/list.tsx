/**
 * Requirements list: a dashed add card leading the grid, then one row per
 * record — a clickable main body (opens the detail view) carrying title,
 * description (when set), and a sibling row menu (edit / remove-danger).
 * The body is a button SIBLING of the menu anchor, never its parent:
 * buttons cannot nest. Host primitives only; colors ride the alias tokens
 * via view.module.css.
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

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
  return (
    <li className={styles.row}>
      {/* Row main is the open affordance; its accessible name comes from the
          record text, so no extra aria — keyboard reachability is native. */}
      <button type="button" className={styles.rowMain} disabled={disabled} onClick={props.onOpen}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{requirement.title}</span>
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
