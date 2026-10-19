/**
 * S1 requirement-baseline-doc face (0008 需求基线文档轮) — the consolidated
 * requirement document (`.skyaxis/requirements/<requirementId>.md`) shows on
 * the page as a FILE ROW with a click-to-preview modal, the report-section
 * twin. Mount fetch is EXISTENCE-only; every modal open re-reads (the
 * refresh path); tamper compare rides understandBaseline.docHash (present +
 * ≠ disk ⇒ warning, never block). The direct file path stays disclosed on
 * the row (ADR 0005 导出承诺口径).
 *
 * 0012: the card core moved to WorkspaceDocSection (doc-section.tsx — the
 * extraction the fourth document face triggered); this file is now the
 * baseline instance.
 *
 * Keyed by requirementId at the render site.
 */
import type { ReactNode } from 'react'
// headerExtra pass-through (布局重塑轮) — the face's own action rides the card head.
import { requirementDocRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import { WorkspaceDocSection } from './doc-section.js'

/** Row/modal display name — a readable stand-in for the uuid file name. */
const docDisplayName = (requirementId: string): string => `requirements/${requirementId.slice(0, 8)}.md`

export function RequirementDocSection(props: {
  t: WorkbenchT
  controller: WorkbenchController
  requirementId: string
  /** Bound workspace root ('' = unbound — no file channel, honest hint). */
  workspacePath: string
  /** Face-specific head action (the 生成整理任务书 entry — its output IS this card's file). */
  headerExtra?: ReactNode
}): ReactNode {
  const { t, controller, requirementId, workspacePath } = props
  return (
    <WorkspaceDocSection
      t={t}
      controller={controller}
      requirementId={requirementId}
      workspacePath={workspacePath}
      headerExtra={props.headerExtra}
      ns="baseline"
      displayName={docDisplayName(requirementId)}
      relPath={requirementDocRelPath(requirementId)}
      fetchContent={controller.requirementDocContent}
    />
  )
}
