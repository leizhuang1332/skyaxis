/**
 * Requirement detail body: the requirements panel's second view (0003 route
 * B — an in-panel subview, not a main-slot entry). Presentation only, like
 * the rest of the view layer: the record flows in via props. The header
 * (title + back button) lives in the page component — this file renders the
 * body content only, so the detail owns the full panel visually.
 *
 * `requirement === undefined` is the missing branch — the id reference in
 * the store outlived the record (external removal / degraded file), so the
 * view shows a notice instead of popping the user out.
 *
 * P1 scope: description. Timestamps, Esc-to-back, and action entries land
 * in P2/P3.
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
  return (
    <article>
      {requirement.description ? <p className={styles.detailDesc}>{requirement.description}</p> : null}
    </article>
  )
}
