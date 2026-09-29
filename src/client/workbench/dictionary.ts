/**
 * Workbench dictionaries (zh/en), the skyaxis.workbench namespace — its own
 * module since the seat migrated out of requirements (0006 P1b).
 *
 * Key set is mirrored verbatim into the LocaleNamespaceMap merge in
 * register.tsx — a key present here but missing there (or vice versa) is a
 * type error, which is the point: the two lists cannot drift.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'

export const WORKBENCH_LOCALE_NS = 'skyaxis.workbench'

interface WorkbenchDictionary {
  /** Detail tab label (the seat still lives in the requirements detail page). */
  readonly 'detail.tab.aiWorkbench': string
  // workbench.* — rail vocabulary (migrated verbatim from the P1a skeleton)
  readonly 'workbench.railLabel': string
  readonly 'workbench.stage.understand': string
  readonly 'workbench.stage.plan': string
  readonly 'workbench.stage.implement': string
  readonly 'workbench.stage.review': string
  readonly 'workbench.stage.deliver': string
  readonly 'workbench.stage.retro': string
  readonly 'workbench.stageHint.understand': string
  readonly 'workbench.stageHint.plan': string
  readonly 'workbench.stageHint.implement': string
  readonly 'workbench.stageHint.review': string
  readonly 'workbench.stageHint.deliver': string
  readonly 'workbench.stageHint.retro': string
  // page.* — load states
  readonly 'page.loading': string
  readonly 'page.degraded': string
  readonly 'page.degradedBackupHint': string
  readonly 'page.loadError': string
  // empty.* — first use (record null)
  readonly 'empty.firstUseHint': string
  // advance.* — stage advance control (pure user prerogative, no modal)
  readonly 'advance.stage': string
  readonly 'advance.close': string
  readonly 'advance.closed': string
  // badge.* — rail counts; zero/empty renders nothing (honesty: zero reads
  // as missing, hidden not placeholder).
  readonly 'badge.findingsOpen': string
  readonly 'badge.modules': string
  readonly 'badge.progress': string
  readonly 'badge.reviewOpen': string
  readonly 'badge.releaseItems': string
  readonly 'badge.candidates': string
  // finding.* — S1 minimal manual loop (dashed action card + inline form)
  readonly 'finding.add': string
  readonly 'finding.addTitle': string
  readonly 'finding.titleLabel': string
  readonly 'finding.detailLabel': string
  readonly 'finding.categoryLabel': string
  readonly 'finding.severityLabel': string
  readonly 'finding.submit': string
  readonly 'finding.cancel': string
  readonly 'finding.category.feasibility': string
  readonly 'finding.category.conflict': string
  readonly 'finding.category.compatibility': string
  readonly 'finding.category.risk': string
  readonly 'finding.category.capacity': string
  readonly 'finding.category.other': string
  readonly 'finding.severity.high': string
  readonly 'finding.severity.medium': string
  readonly 'finding.severity.low': string
  // error.* — banner copy
  readonly 'error.conflict': string
  readonly 'error.network': string
  readonly 'error.unreadableFile': string
  readonly 'error.notFound': string
  readonly 'error.internal': string
}

export type WorkbenchT = (key: keyof WorkbenchDictionary) => string

const zh: WorkbenchDictionary = {
  'detail.tab.aiWorkbench': 'AI 工作台',
  'workbench.railLabel': '工作流阶段',
  'workbench.stage.understand': '① 需求理解',
  'workbench.stage.plan': '② 探索规划',
  'workbench.stage.implement': '③ 执行实施',
  'workbench.stage.review': '④ 评审',
  'workbench.stage.deliver': '⑤ 交付',
  'workbench.stage.retro': '⑥ 沉淀',
  'workbench.stageHint.understand': '分析发现与验收标准将在此汇总；生成分析上下文包后可带入 session。',
  'workbench.stageHint.plan': '模块拆分与两道硬门（批准拆分 / 批准计划）将在此落地。',
  'workbench.stageHint.implement': '模块看板（含验证）与 session 关联将在此呈现。',
  'workbench.stageHint.review': '评审报告裁决与 PRD 覆盖矩阵将在此收口。',
  'workbench.stageHint.deliver': '上线产物登记（SQL / 配置 / 开关 / MQ）与 go/no-go 结论将在此管理。',
  'workbench.stageHint.retro': '知识候选激活与复盘统计将在此沉淀。',
  'page.loading': '正在加载 AI 工作台…',
  'page.degraded': 'AI 工作台账本文件不可读（可能已损坏）。',
  'page.degradedBackupHint': '可从 $DSH_HOME/skyaxis/ 下同名 .bak 文件手动恢复；修复前拒绝写入以保护现场。',
  'page.loadError': 'AI 工作台数据加载失败。',
  'empty.firstUseHint': '本需求尚未启用 AI 工作台：登记第一条发现即建立工作台记录，之后可推进阶段。',
  'advance.stage': '完成本阶段 →',
  'advance.close': '关闭需求 →',
  'advance.closed': '该需求已关闭（阶段推进停止，记录与产物保留可查）。',
  'badge.findingsOpen': '待处置',
  'badge.modules': '模块',
  'badge.progress': '已验收',
  'badge.reviewOpen': '待裁决',
  'badge.releaseItems': '上线项',
  'badge.candidates': '待审阅',
  'finding.add': '＋ 手动添加发现',
  'finding.addTitle': '登记发现',
  'finding.titleLabel': '标题',
  'finding.detailLabel': '说明',
  'finding.categoryLabel': '类别',
  'finding.severityLabel': '级别',
  'finding.submit': '保存',
  'finding.cancel': '取消',
  'finding.category.feasibility': '可行性',
  'finding.category.conflict': '冲突',
  'finding.category.compatibility': '兼容性',
  'finding.category.risk': '风险',
  'finding.category.capacity': '容量',
  'finding.category.other': '其他',
  'finding.severity.high': '高',
  'finding.severity.medium': '中',
  'finding.severity.low': '低',
  'error.conflict': '保存冲突：账本已被其他操作更新，已自动刷新',
  'error.network': '网络错误，请稍后重试',
  'error.unreadableFile': '账本文件不可写（可能已损坏），请检查 workbench.yaml',
  'error.notFound': '记录已不存在，已自动刷新',
  'error.internal': '服务内部错误',
}

const en: WorkbenchDictionary = {
  'detail.tab.aiWorkbench': 'AI Workbench',
  'workbench.railLabel': 'Workflow stages',
  'workbench.stage.understand': '① Understand',
  'workbench.stage.plan': '② Plan',
  'workbench.stage.implement': '③ Implement',
  'workbench.stage.review': '④ Review',
  'workbench.stage.deliver': '⑤ Deliver',
  'workbench.stage.retro': '⑥ Retro',
  'workbench.stageHint.understand': 'Analysis findings and acceptance criteria will be gathered here; generate an analysis context bundle to carry into a session.',
  'workbench.stageHint.plan': 'Module breakdown and the two hard gates (approve breakdown / approve plan) will land here.',
  'workbench.stageHint.implement': 'The module board (verification included) and linked sessions will appear here.',
  'workbench.stageHint.review': 'Review report verdicts and the PRD coverage matrix will be closed out here.',
  'workbench.stageHint.deliver': 'Release artifact registration (SQL / config / flags / MQ) and the go/no-go verdict will be managed here.',
  'workbench.stageHint.retro': 'Knowledge candidate activation and retro statistics will be distilled here.',
  'page.loading': 'Loading the AI workbench…',
  'page.degraded': 'The AI workbench ledger file is unreadable (possibly corrupted).',
  'page.degradedBackupHint': 'Restore manually from the matching .bak file under $DSH_HOME/skyaxis/; writes stay refused until fixed to preserve the scene.',
  'page.loadError': 'Failed to load AI workbench data.',
  'empty.firstUseHint': 'The AI workbench is not enabled for this requirement yet: recording the first finding creates the workbench record; stages can be advanced afterwards.',
  'advance.stage': 'Complete stage →',
  'advance.close': 'Close requirement →',
  'advance.closed': 'This requirement is closed (stage advance stopped; the record and artifacts stay readable).',
  'badge.findingsOpen': 'open',
  'badge.modules': 'modules',
  'badge.progress': 'accepted',
  'badge.reviewOpen': 'unresolved',
  'badge.releaseItems': 'release items',
  'badge.candidates': 'pending',
  'finding.add': '＋ Add a finding',
  'finding.addTitle': 'Record a finding',
  'finding.titleLabel': 'Title',
  'finding.detailLabel': 'Detail',
  'finding.categoryLabel': 'Category',
  'finding.severityLabel': 'Severity',
  'finding.submit': 'Save',
  'finding.cancel': 'Cancel',
  'finding.category.feasibility': 'Feasibility',
  'finding.category.conflict': 'Conflict',
  'finding.category.compatibility': 'Compatibility',
  'finding.category.risk': 'Risk',
  'finding.category.capacity': 'Capacity',
  'finding.category.other': 'Other',
  'finding.severity.high': 'High',
  'finding.severity.medium': 'Medium',
  'finding.severity.low': 'Low',
  'error.conflict': 'Save conflict: the ledger was updated by another action, refreshed automatically',
  'error.network': 'Network error, please retry later',
  'error.unreadableFile': 'The ledger file is unwritable (possibly corrupted); check workbench.yaml',
  'error.notFound': 'The record no longer exists, refreshed automatically',
  'error.internal': 'Internal server error',
}

export function registerWorkbenchDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(WORKBENCH_LOCALE_NS, { zh, en }),
    'skyaxis.workbench: dictionaries',
  )
}

export const workbenchZh = zh
export const workbenchEn = en
