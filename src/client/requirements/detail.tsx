/**
 * Requirement detail body: the requirements panel's second view (0003 route
 * B — an in-panel subview, not a main-slot entry). The found branch renders
 * nothing here — the record title and its description ride in the page
 * header's title cluster (directly under the title, per the user ask); this
 * body area awaits the P2 metadata fields. Presentation only, like the rest
 * of the view layer: the record flows in via props.
 *
 * `requirement === undefined` is the missing branch — the id reference in
 * the store outlived the record (external removal / degraded file), so the
 * view shows a notice instead of popping the user out.
 */
import type { ReactNode } from 'react'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

export function RequirementDetail(props: {
  t: RequirementsT
  requirement: RequirementRecord | undefined
}): ReactNode {
  const { t, requirement } = props
  if (requirement === undefined) {
    return <div className={styles.detailMissing}>{t('detail.missing')}</div>
  }
  return null
}
