/**
 * Requirement detail tab seats (0003 P2 placeholder skeleton).
 *
 * A tab is a slot entry in 'requirements.detail.view' — its label comes
 * from the registration options (a locale thunk), and the live requirement
 * arrives as the owner prop on every render (renderSlot's second argument,
 * swapped whole per call). Adding a future feature tab = one inject +
 * register in register.tsx pointing at a component here or elsewhere;
 * detail.tsx (the strip and the panel outlet) never changes.
 *
 * The two shipped entries are placeholder seats (user: features TBD) —
 * they render the notice card so the skeleton is visible and switchable
 * end to end. t rides the registration closure (the label thunk pattern),
 * so the owner carries only the runtime record.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

/** Placeholder seat: the notice card, the detailMissing shape. */
function seat(t: RequirementsT): ReactNode {
  return <div className={styles.detailNotice}>{t('detail.tab.seat')}</div>
}

export function createRequirementTabSeats(t: RequirementsT): {
  RequirementOverviewTab: (props: PropsRuntime<'requirements.detail.view'>) => ReactNode
  RequirementPlaceholderTab: (props: PropsRuntime<'requirements.detail.view'>) => ReactNode
} {
  return {
    RequirementOverviewTab: () => seat(t),
    RequirementPlaceholderTab: () => seat(t),
  }
}
