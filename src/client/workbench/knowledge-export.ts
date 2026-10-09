/**
 * Knowledge export document assembly (P5a, research 0006 §7.4) — pure
 * functions, no React, no fetch (the buildSow conventions carried over):
 * fixed zh literals for the artifact itself, every trigger/scope carries its
 * raw value alongside, and the document ends with the generation stamp.
 *
 * Form aligns with AGENTS.md / steering / SKILL.md — rows are markdown
 * sections a user can commit into a repository; delivery is the CLIPBOARD
 * (the user-ratified P5a ruling — the repo has no download precedent), so
 * the paste target is the user's editor, and the file lands where they put
 * it. Scope/path metadata rides each section head so the export stays
 * re-importable by eye.
 */
import type { WorkbenchKnowledgeRecord } from '../../workbench-shared/protocol.js'

const SCOPE_LABEL: Record<WorkbenchKnowledgeRecord['scope'], string> = {
  global: '全局',
  workspace: '工作区',
  requirement: '本需求',
}

function rowSection(row: WorkbenchKnowledgeRecord): string {
  const trigger = row.trigger.value !== undefined && row.trigger.value.length > 0
    ? `${row.trigger.mode}: ${row.trigger.value}`
    : row.trigger.mode
  const meta = [
    `scope ${SCOPE_LABEL[row.scope]}`,
    row.scope === 'workspace' && row.path !== undefined ? `path ${row.path}` : null,
    `type ${row.type}`,
    `触发 ${trigger}`,
  ].filter((part) => part !== null).join(' · ')
  return [`## ${row.title}`, meta, '', row.content].join('\n')
}

/** Assemble the export markdown for the given rows (batch = one document). */
export function buildKnowledgeDoc(rows: readonly WorkbenchKnowledgeRecord[], generatedAt: string): string {
  const blocks = rows.map(rowSection)
  const date = generatedAt.slice(0, 10)
  const stamp = `导出于 skyaxis 知识库 · ${date} · 账本为真源，导出为分发`
  return [...blocks, stamp].join('\n\n')
}
