/**
 * Repos-pool list: a dashed add card leading the grid, then one row per
 * record — name, address, description, a status Tag, and a row menu
 * (edit / remove-danger). Host primitives only; colors ride the alias
 * tokens via view.module.css.
 *
 * P1 dual-address adaptation: the row shows the RECOMMENDED address and its
 * slot's status (pickAddress, decision 0004 / D7); per-address rows and
 * Tags arrive with the P3 two-box form.
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16, Menu, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { pickAddress } from '../../repos-pool-shared/address.js'
import type { RepoRecord, RepoStatus } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolT } from './dictionary.js'
import styles from './view.module.css'

const STATUS_TAG_TONE: Record<RepoStatus, 'success' | 'neutral' | 'warning' | 'warning'> = {
  'verified': 'success',
  'unverified': 'neutral',
  'forced-network': 'warning',
  'forced-auth': 'warning',
}

const STATUS_KEY: Record<RepoStatus, Parameters<ReposPoolT>[0]> = {
  'verified': 'status.verified',
  'unverified': 'status.unverified',
  'forced-network': 'status.forcedNetwork',
  'forced-auth': 'status.forcedAuth',
}

function RepoRow(props: {
  t: ReposPoolT
  repo: RepoRecord
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t, repo, disabled } = props
  const picked = pickAddress(repo)
  const entries: readonly MenuEntry[] = [
    { id: 'edit', label: t('menu.edit') },
    { id: 'remove', label: t('menu.remove'), danger: true },
  ]
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{repo.name}</span>
          {picked !== undefined ? <Tag tone={STATUS_TAG_TONE[picked.status]}>{t(STATUS_KEY[picked.status])}</Tag> : null}
        </div>
        {picked !== undefined ? <div className={styles.rowUrl} title={picked.url}>{picked.url}</div> : null}
        {repo.description ? <div className={styles.rowDesc}>{repo.description}</div> : null}
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
              title={repo.name}
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
 * Add-repo card: always the first grid cell. The whole card is one button
 * with a visible label — the affordance reads without hover, and the empty
 * list is simply this card alone.
 */
function AddRepoCard(props: {
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

export function ReposList(props: {
  t: ReposPoolT
  repos: readonly RepoRecord[]
  addLabel: string
  disabled: boolean
  onAdd: () => void
  onEdit: (repo: RepoRecord) => void
  onRemove: (repo: RepoRecord) => void
}): ReactNode {
  return (
    <ul className={styles.list}>
      <AddRepoCard label={props.addLabel} disabled={props.disabled} onAdd={props.onAdd} />
      {props.repos.map((repo) => (
        <RepoRow
          key={repo.id}
          t={props.t}
          repo={repo}
          disabled={props.disabled}
          onEdit={() => props.onEdit(repo)}
          onRemove={() => props.onRemove(repo)}
        />
      ))}
    </ul>
  )
}
