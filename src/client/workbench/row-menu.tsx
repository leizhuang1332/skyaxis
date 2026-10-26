/**
 * Shared ⋯ row menu (the requirements list.tsx row-menu precedent: the Menu
 * primitive renders its anchor in place; portal + close-on-pointer-leave;
 * danger items). One component so S2 work-package rows and S1 criteria rows
 * share item semantics and test selectors (getByRole('menuitem', { name })).
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './view.module.css'

export interface RowMenuItem {
  readonly id: string
  readonly label: string
  readonly danger?: boolean
}

export function RowMenu(props: { items: readonly RowMenuItem[]; menuLabel: string; onSelect: (id: string) => void }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={props.items.map((item) => ({ id: item.id, label: item.label, danger: item.danger }))}
      onSelect={(id) => {
        setOpen(false)
        props.onSelect(id)
      }}
      portal
      closeOnPointerLeave
      anchor={(
        <button
          type="button"
          className={styles.iconButton}
          aria-label={props.menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconEllipsisOutlineRegular />
        </button>
      )}
    />
  )
}
