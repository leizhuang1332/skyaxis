/**
 * Repos-pool list: one row per record — name, url, description, a status
 * Tag, and a row menu (edit / remove-danger). Host primitives only; colors
 * ride the alias tokens via view.module.css.
 */
import { useState, type ReactNode } from 'react'
import { Button, IconEllipsisOutline16, Menu, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const entries: readonly MenuEntry[] = [
    { id: 'edit', label: t('menu.edit') },
    { id: 'remove', label: t('menu.remove'), danger: true },
  ]
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowName}>{repo.name}</span>
          <Tag tone={STATUS_TAG_TONE[repo.status]}>{t(STATUS_KEY[repo.status])}</Tag>
        </div>
        <div className={styles.rowUrl} title={repo.url}>{repo.url}</div>
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
            <Button
              variant="toolbar"
              size="sm"
              disabled={disabled}
              aria-label={t('menu.edit')}
              onClick={() => setMenuOpen(true)}
            >
              <IconEllipsisOutline16 size={16} />
            </Button>
          )}
        />
      </div>
    </li>
  )
}

export function ReposList(props: {
  t: ReposPoolT
  repos: readonly RepoRecord[]
  disabled: boolean
  onEdit: (repo: RepoRecord) => void
  onRemove: (repo: RepoRecord) => void
}): ReactNode {
  return (
    <ul className={styles.list}>
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
