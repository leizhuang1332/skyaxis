/**
 * Requirements list: one row per record — title, description (when set),
 * and a row menu (edit / remove-danger). Host primitives only; colors ride
 * the alias tokens via view.module.css.
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

function RequirementRow(props: {
  t: RequirementsT
  requirement: RequirementRecord
  disabled: boolean
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
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{requirement.title}</span>
        </div>
        {requirement.description ? <div className={styles.rowDesc}>{requirement.description}</div> : null}
      </div>
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

export function RequirementsList(props: {
  t: RequirementsT
  requirements: readonly RequirementRecord[]
  disabled: boolean
  onEdit: (requirement: RequirementRecord) => void
  onRemove: (requirement: RequirementRecord) => void
}): ReactNode {
  return (
    <ul className={styles.list}>
      {props.requirements.map((requirement) => (
        <RequirementRow
          key={requirement.id}
          t={props.t}
          requirement={requirement}
          disabled={props.disabled}
          onEdit={() => props.onEdit(requirement)}
          onRemove={() => props.onRemove(requirement)}
        />
      ))}
    </ul>
  )
}
