/**
 * S1 analysis report face (文件交付轮; 换形轮 = PRD-preview pattern): the
 * workspace report file (`.skyaxis/analysis/<requirementId>.md`) shows on the
 * page as a FILE ROW, never an inline body — clicking the row opens a
 * preview modal that fetches on open (the 工作区 PRD-doc precedent,
 * prd-section.tsx PrdRow/PreviewModal). The mount fetch survives but is
 * EXISTENCE-only (card vs honest hint); every modal open re-reads, which is
 * also the refresh path. Honest states unchanged: no workspace ⇒ the
 * no-file hint; 404 ⇒ the not-yet-generated hint; read failure ⇒ error +
 * retry; drift ⇒ the tampered warning INSIDE the modal (细化④: warn, never
 * block). The direct file path stays disclosed on the row (ADR 0005 产物
 * 导出承诺口径).
 *
 * 0012: the card core moved to WorkspaceDocSection (doc-section.tsx — the
 * extraction the twins' notes had scheduled for the FOURTH document face);
 * this file is now the analysis instance: namespace keys + display name +
 * rel-path + the controller read.
 *
 * Keyed by requirementId at the render site (a fetch for one requirement
 * never seeds another's panel).
 */
import type { ReactNode } from 'react'
import { analysisReportRelPath } from '../../workbench-shared/protocol.js'
import type { WorkbenchT } from './dictionary.js'
import type { WorkbenchController } from './controller.js'
import { WorkspaceDocSection } from './doc-section.js'

/** Row/modal display name — a readable stand-in for the uuid file name. */
const reportDisplayName = (requirementId: string): string => `analysis/${requirementId.slice(0, 8)}.md`

export function ReportSection(props: {
  t: WorkbenchT
  controller: WorkbenchController
  requirementId: string
  /** Bound workspace root ('' = unbound — no file channel, honest hint). */
  workspacePath: string
}): ReactNode {
  const { t, controller, requirementId, workspacePath } = props
  return (
    <WorkspaceDocSection
      t={t}
      controller={controller}
      requirementId={requirementId}
      workspacePath={workspacePath}
      ns="report"
      displayName={reportDisplayName(requirementId)}
      relPath={analysisReportRelPath(requirementId)}
      fetchContent={controller.analysisReportContent}
    />
  )
}
