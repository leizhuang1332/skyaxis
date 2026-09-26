/**
 * Requirement detail: the requirements panel's second view (0003 P1, route B
 * — an in-panel subview, not a main-slot entry). Presentation only, like the
 * rest of the view layer: record flows in via props, navigation flows out
 * via onBack. `requirement === undefined` is the missing branch — the id
 * reference in the store outlived the record (external removal / degraded
 * file), so the view shows a notice instead of popping the user out.
 *
 * P1 scope: back button + title/description. Timestamps, Esc-to-back, and
 * action entries land in P2/P3.
 */
import type { ReactNode } from 'react'
import { IconChevronLeftOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

export function RequirementDetail(props: {
  t: RequirementsT
  requirement: RequirementRecord | undefined
  onBack: () => void
}): ReactNode {
  const { t, requirement } = props
  return (
    <section>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.detailBack} onClick={props.onBack}>
          <IconChevronLeftOutline14 />
          <span>{t('detail.back')}</span>
        </button>
      </div>
      {requirement === undefined ? (
        <div className={styles.detailMissing}>{t('detail.missing')}</div>
      ) : (
        <article>
          <h2 className={styles.detailTitle}>{requirement.title}</h2>
          {requirement.description ? <p className={styles.detailDesc}>{requirement.description}</p> : null}
        </article>
      )}
    </section>
  )
}
