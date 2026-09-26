/**
 * Requirement detail view chrome (0003 P2, conversation.view-shaped).
 *
 * Two components, because the tab strip and the panel live in two page
 * regions (header body and scroll body); the active-tab state stays at the
 * page level and walks in as props:
 *
 *  - RequirementDetailTabs: the strip. Structure and behaviour are the
 *    host's ConversationSessionHeader tab block, ported verbatim — renders
 *    only when more than one tab exists, role=tablist/tab + aria-selected,
 *    no arrow-key navigation (host parity).
 *  - RequirementDetailPanel: the outlet. renderSlot with { only: activeId }
 *    mounts exactly the active slot entry, mirroring the host's view area;
 *    the live requirement travels as the owner prop.
 *
 * The missing branch lives in view.tsx (neither component renders then).
 * Presentation only, like the rest of the view layer.
 */
import type { ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementDetailTab } from './register.js'
import styles from './view.module.css'

export function RequirementDetailTabs(props: {
  tabs: readonly RequirementDetailTab[]
  activeId: string | undefined
  onSelect: (id: string) => void
}): ReactNode {
  const { tabs, activeId } = props
  if (tabs.length <= 1) return null
  return (
    <div className={styles.detailTabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={tab.id === activeId
            ? `${styles.detailTab} ${styles.detailTabActive}`
            : styles.detailTab}
          onClick={() => { props.onSelect(tab.id) }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function RequirementDetailPanel(props: {
  renderSlot: PropsRenderSlots<'requirements.detail.view'>['renderSlot']
  activeId: string | undefined
  requirement: RequirementRecord
}): ReactNode {
  const { renderSlot, activeId, requirement } = props
  if (activeId === undefined) return null
  return renderSlot('requirements.detail.view', { requirement }, { only: activeId })
}
