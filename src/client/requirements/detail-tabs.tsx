/**
 * Requirement detail tab seats (0003 P2 skeleton, P3a gains the workspace
 * seat; the placeholder seat retired; 0006's AI workbench seat lived here
 * for the P1a skeleton, then migrated to its own module — src/client/
 * workbench/register.tsx injects it directly since P1b).
 *
 * A tab is a slot entry in 'requirements.detail.view' — its label comes
 * from the registration options (a locale thunk), and the live requirement
 * arrives as the owner prop on every render (renderSlot's second argument,
 * swapped whole per call). Adding a future feature tab = one inject +
 * register in register.tsx pointing at a component here or elsewhere;
 * detail.tsx (the strip and the panel outlet) never changes.
 *
 * t and the workspace tab's dependencies (controller, remote capabilities)
 * ride the registration closure (the label thunk pattern), so the owner
 * carries only the runtime record.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsController } from './controller.js'
import type { RequirementsT } from './dictionary.js'
import { createWorkspaceTabSeat, type WorkspaceCapabilities } from './workspace-tab.js'
import styles from './view.module.css'

/** Overview seat: still the notice card (future: read-only metadata). */
function seat(t: RequirementsT): ReactNode {
  return <div className={styles.detailNotice}>{t('detail.tab.seat')}</div>
}

export function createRequirementTabSeats(options: {
  t: RequirementsT
  controller: RequirementsController
  capabilities: WorkspaceCapabilities
}): {
  RequirementOverviewTab: (props: PropsRuntime<'requirements.detail.view'>) => ReactNode
  RequirementWorkspaceTab: (props: PropsRuntime<'requirements.detail.view'>) => ReactNode
} {
  return {
    RequirementOverviewTab: () => seat(options.t),
    RequirementWorkspaceTab: createWorkspaceTabSeat(options),
  }
}
