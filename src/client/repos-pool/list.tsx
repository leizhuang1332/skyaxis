/**
 * Repos-pool list: a dashed add card leading the grid, then one row per
 * record — name, per-address lines and status Tags, description, and a row
 * menu (edit / remove-danger). Host primitives only; colors ride the alias
 * tokens via view.module.css.
 *
 * Dual-address (decision 0004 / D1): each configured address renders its own
 * line (SSH:/HTTP: label) with its own status Tag; absent slots render
 * nothing.
 */
import { useState, type ReactNode } from 'react'
import { IconEllipsisOutline16, IconPlusOutline16, Menu, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AddressSlot, RepoRecord, RepoStatus } from '../../repos-pool-shared/protocol.js'
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

interface RowSlot {
  readonly slot: AddressSlot
  readonly label: string
  readonly url: string
  readonly status: RepoStatus
}

function rowSlots(repo: RepoRecord): readonly RowSlot[] {
  const slots: RowSlot[] = []
  if (repo.urlSsh !== undefined && repo.statusSsh !== undefined) {
    slots.push({ slot: 'ssh', label: 'SSH', url: repo.urlSsh, status: repo.statusSsh })
  }
  if (repo.urlHttp !== undefined && repo.statusHttp !== undefined) {
    slots.push({ slot: 'http', label: 'HTTP', url: repo.urlHttp, status: repo.statusHttp })
  }
  return slots
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
  const slots = rowSlots(repo)
  const entries: readonly MenuEntry[] = [
    { id: 'edit', label: t('menu.edit') },
    { id: 'remove', label: t('menu.remove'), danger: true },
  ]
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{repo.name}</span>
          {slots.map((s) => <Tag key={s.slot} tone={STATUS_TAG_TONE[s.status]}>{t(STATUS_KEY[s.status])}</Tag>)}
        </div>
        {slots.map((s) => (
          <div key={s.slot} className={styles.rowUrl} title={s.url}>
            <span className={styles.rowUrlLabel}>{s.label}</span>
            {s.url}
          </div>
        ))}
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
