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
  readonly 'proposal.adopt': string
  readonly 'proposal.answer': string
  readonly 'proposal.answerCancel': string
  readonly 'proposal.answered': string
  readonly 'proposal.answerPlaceholder': string
  readonly 'proposal.answerPrefix': string
  readonly 'proposal.answerSave': string
  readonly 'proposal.blocksPrefix': string
  readonly 'proposal.clarificationsTitle': string
  readonly 'proposal.criteriaTitle': string
  readonly 'proposal.dismiss': string
  readonly 'proposal.findingsTitle': string
  readonly 'proposal.ignore': string
  readonly 'proposal.lockedHint': string
  readonly 'proposal.recommendationPrefix': string
  readonly 'proposal.retry': string
  readonly 'proposal.scanPrefix': string
  readonly 'proposal.seedMissReportFileMissing': string
  readonly 'proposal.seedMissReportFileSyntax': string
  readonly 'proposal.seedMissReportFileTooLarge': string
  readonly 'proposal.seedMissSplitFileMissing': string
  readonly 'proposal.seedMissSplitFileSyntax': string
  readonly 'proposal.seedMissSplitFileTooLarge': string
  // 0018 刀一: the wp-plan file channel's miss copy (completes SEED_MISS_KEY's
  // exhaustive map; the disclosure row lands with 刀二's source-session line).
  readonly 'proposal.seedMissWpPlanFileMissing': string
  readonly 'proposal.seedMissWpPlanFileTooLarge': string
  readonly 'proposal.sourcePrefix': string
  readonly 'proposal.waitingHint': string
  // report.* — 文件交付轮 S1 report panel
  readonly 'report.title': string
  readonly 'report.refresh': string
  readonly 'report.preview': string
  readonly 'report.pathPrefix': string
  readonly 'report.missing': string
  readonly 'report.noWorkspace': string
  readonly 'report.loadError': string
  readonly 'report.tampered': string
  /** MarkdownText chrome (the prd.md* precedent, workbench namespace). */
  readonly 'report.mdCopyCode': string
  readonly 'report.mdCopiedCode': string
  readonly 'report.mdFootnotes': string
  // empty.* — first use (record null)
  readonly 'empty.firstUseHint': string
  // advance.* — stage advance control (pure user prerogative, no modal)
  readonly 'advance.stage': string
  readonly 'advance.close': string
  readonly 'advance.closed': string
  // badge.* — rail counts; zero/empty renders nothing (honesty: zero reads
  // as missing, hidden not placeholder).
  readonly 'badge.findingsOpen': string
  readonly 'badge.workPackages': string
  readonly 'badge.progress': string
  readonly 'badge.reviewOpen': string
  readonly 'badge.releaseItems': string
  readonly 'badge.candidates': string
  // finding.* — S1 minimal manual loop (dashed action card + inline form)
  readonly 'finding.sectionTitle': string
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
  readonly 'error.lockedSplit': string
  readonly 'error.lockedVersion': string
  // action.* — shared modal/form verbs (new sections reuse; finding.* keeps its own)
  readonly 'action.cancel': string
  readonly 'action.save': string
  readonly 'action.confirm': string
  // menu.* — shared row-menu items (S2 rows and criteria rows)
  readonly 'menu.edit': string
  readonly 'menu.remove': string
  readonly 'menu.moveUp': string
  readonly 'menu.moveDown': string
  // criteria.* — S1 acceptance-criteria section
  readonly 'criteria.sectionTitle': string
  readonly 'criteria.add': string
  readonly 'criteria.addTitle': string
  readonly 'criteria.editTitle': string
  readonly 'criteria.textLabel': string
  readonly 'criteria.sourceLabel': string
  readonly 'criteria.removeTitle': string
  readonly 'criteria.removeDescription': string
  readonly 'criteria.uncovered': string
  readonly 'criteria.lockedHint': string
  // understand.* — 0007 定稿软门：S1 就绪披露 + 定稿动作 + 撤销 + 摘要导出
  readonly 'triptych.title': string
  readonly 'triptych.noSessionHint': string
  readonly 'triptych.settledHint': string
  readonly 'understand.stageReadyTag': string
  readonly 'understand.exportButton': string
  readonly 'understand.exportTitle': string
  readonly 'understand.approveButton': string
  readonly 'understand.approveTitle': string
  readonly 'understand.statCriteria': string
  readonly 'understand.statFindings': string
  readonly 'understand.statClarifications': string
  readonly 'understand.statProposals': string
  readonly 'understand.approveAck': string
  readonly 'understand.approveConfirm': string
  readonly 'understand.approvedTag': string
  readonly 'understand.approvedAtPrefix': string
  readonly 'understand.bannerChanged': string
  readonly 'understand.revoke': string
  readonly 'understand.revokeTitle': string
  readonly 'understand.revokeDescription': string
  readonly 'understand.revokeAck': string
  readonly 'understand.revokeConfirm': string
  // 0008 需求基线文档轮：整理任务书入口 + ack 文档态披露 + 基线文档卡片
  readonly 'understand.consolidateButton': string
  readonly 'understand.ackDocWillAnchor': string
  readonly 'understand.ackNoDoc': string
  readonly 'baseline.title': string
  readonly 'baseline.missing': string
  readonly 'baseline.noWorkspace': string
  readonly 'baseline.pathPrefix': string
  readonly 'baseline.tampered': string
  readonly 'baseline.refresh': string
  readonly 'baseline.preview': string
  readonly 'baseline.loadError': string
  /** 0012 采纳软门（planning 文档卡 = baseline 卡的孪生 + 采纳/撤销/stale 面）。 */
  readonly 'planning.title': string
  readonly 'planning.missing': string
  readonly 'planning.noWorkspace': string
  readonly 'planning.pathPrefix': string
  readonly 'planning.tampered': string
  readonly 'planning.refresh': string
  readonly 'planning.preview': string
  readonly 'planning.loadError': string
  readonly 'planning.adoptButton': string
  readonly 'planning.adoptTitle': string
  readonly 'planning.adoptAck': string
  readonly 'planning.adoptConfirm': string
  readonly 'planning.ackDocWillAnchor': string
  readonly 'planning.ackNoDoc': string
  readonly 'planning.adoptedTag': string
  readonly 'planning.adoptedAtPrefix': string
  readonly 'planning.revokeButton': string
  readonly 'planning.revokeTitle': string
  readonly 'planning.revokeConfirm': string
  readonly 'planning.revokeAck': string
  readonly 'planning.staleBadge': string
  // split.* — S2 breakdown list + hard gate ①
  readonly 'split.sectionTitle': string
  readonly 'split.add': string
  readonly 'split.approve': string
  readonly 'split.approveTitle': string
  readonly 'split.statWorkPackages': string
  readonly 'split.statCovered': string
  readonly 'split.statHole': string
  readonly 'split.approveAck': string
  readonly 'split.approveConfirm': string
  readonly 'split.approvedTag': string
  readonly 'split.approvedAtPrefix': string
  readonly 'split.revoke': string
  readonly 'split.revokeTitle': string
  readonly 'split.revokeDescription': string
  readonly 'split.revokeConfirm': string
  // split.stale* — P5b §7.6 变更失效与对账
  readonly 'split.staleBadge': string
  readonly 'split.staleReason': string
  readonly 'split.stalePrd': string
  readonly 'split.staleFindings': string
  readonly 'split.staleUnderstand': string
  readonly 'split.staleClarifications': string
  readonly 'split.staleRequirementDoc': string
  readonly 'split.stalePlanning': string
  readonly 'split.stillValid': string
  readonly 'split.reSplit': string
  readonly 'split.reSplitBlocked': string
  readonly 'split.reSplitTitle': string
  readonly 'split.reSplitCount': string
  readonly 'split.reSplitAck': string
  readonly 'split.reSplitConfirm': string
  readonly 'split.droppedSectionTitle': string
  readonly 'split.droppedTag': string
  readonly 'split.restore': string
  /** 0012 拆包提议区（splitProposals 容器的 S2 呈现面）。 */
  readonly 'splitProposal.sectionTitle': string
  readonly 'splitProposal.waiting': string
  readonly 'splitProposal.retry': string
  readonly 'splitProposal.adoptSelected': string
  readonly 'splitProposal.ignore': string
  readonly 'splitProposal.lockedHint': string
  readonly 'splitProposal.proposedTag': string
  /** 0012 拆分结果文档卡（验收驱动补面——与规划卡同权的第五张文件卡）。 */
  readonly 'splitResult.title': string
  readonly 'splitResult.missing': string
  readonly 'splitResult.noWorkspace': string
  readonly 'splitResult.pathPrefix': string
  readonly 'splitResult.tampered': string
  readonly 'splitResult.refresh': string
  readonly 'splitResult.preview': string
  readonly 'splitResult.loadError': string
  // wp.* — work-package form fields
  readonly 'wp.addTitle': string
  readonly 'wp.editTitle': string
  readonly 'wp.titleLabel': string
  readonly 'wp.boundaryLabel': string
  readonly 'wp.dependsLabel': string
  readonly 'wp.coversLabel': string
  readonly 'wp.parallelLabel': string
  readonly 'wp.parallelTag': string
  readonly 'wp.noneMark': string
  readonly 'wp.copyBody': string
  readonly 'wp.removeTitle': string
  readonly 'wp.removeDescription': string
  // board.* — S3 kanban columns, cards, acceptance queue
  readonly 'board.colPlanned': string
  readonly 'board.colPlanApproved': string
  readonly 'board.colInDev': string
  readonly 'board.colBuilt': string
  readonly 'board.colAccepted': string
  readonly 'board.lockedHint': string
  readonly 'board.notDrafted': string
  readonly 'board.drafting': string
  readonly 'board.planTag': string
  readonly 'board.planMissing': string
  readonly 'board.declareReady': string
  readonly 'board.sessions': string
  readonly 'board.viewExecution': string
  readonly 'board.commits': string
  readonly 'board.progressAccepted': string
  readonly 'board.progressBuilt': string
  readonly 'board.progressInDev': string
  readonly 'board.progressPlanApproved': string
  readonly 'board.progressPlanned': string
  readonly 'board.accept': string
  readonly 'board.reject': string
  readonly 'board.rejectTitle': string
  readonly 'board.rejectReasonLabel': string
  readonly 'board.rejectReasonRequired': string
  readonly 'board.rejectSubmit': string
  // detail.* — work-package dialog (statuses, plan section, lifecycle actions)
  readonly 'detail.statusPlanned': string
  readonly 'detail.statusPlanDraft': string
  readonly 'detail.statusPlanApproved': string
  readonly 'detail.statusInDev': string
  readonly 'detail.statusBuilt': string
  readonly 'detail.statusAccepted': string
  readonly 'detail.statusDropped': string
  readonly 'detail.contentSection': string
  readonly 'detail.planSection': string
  readonly 'detail.versionCurrent': string
  readonly 'detail.versionDraft': string
  readonly 'detail.versionArchived': string
  readonly 'detail.versionApproved': string
  readonly 'detail.noPlans': string
  readonly 'detail.planMissing': string
  readonly 'detail.planRewrite': string
  readonly 'detail.planLoadFailed': string
  readonly 'detail.tampered': string
  readonly 'detail.draftLabel': string
  readonly 'detail.draftPlaceholder': string
  readonly 'detail.draftSave': string
  readonly 'detail.sessionsSection': string
  readonly 'detail.commitsSection': string
  readonly 'detail.acceptanceSection': string
  readonly 'detail.acceptanceEmpty': string
  readonly 'detail.acceptancePass': string
  readonly 'detail.acceptanceFail': string
  // rework.* — 0019 返工反馈通道（送返工话）
  readonly 'rework.title': string
  readonly 'rework.send': string
  readonly 'rework.targetLabel': string
  readonly 'rework.previewLabel': string
  readonly 'rework.sendFailed': string
  readonly 'detail.builtSourceManual': string
  readonly 'detail.returnForEdit': string
  readonly 'detail.approvePlan': string
  readonly 'detail.startWork': string
  readonly 'detail.markBuilt': string
  readonly 'detail.reopen': string
  readonly 'detail.drop': string
  readonly 'detail.dropTitle': string
  // md.* — MarkdownText labels (the prd-section precedent; stable identity via useMemo at the call site)
  // + 0021 渲染轮: md.edit/md.preview — 任务书预览面的渲染↔编辑切换钮
  readonly 'md.copyCode': string
  readonly 'md.copiedCode': string
  readonly 'md.edit': string
  readonly 'md.footnotes': string
  readonly 'md.preview': string

  // --- P2: session strip / knowledge base / SOW generation ---
  // scan.* — 产物对账 Modal（挂账轮：P1b scan 端点首个消费面，只读披露）
  readonly 'scan.button': string
  readonly 'scan.empty': string
  readonly 'scan.failed': string
  readonly 'scan.kindPlan': string
  readonly 'scan.kindReview': string
  readonly 'scan.kindUnknown': string
  readonly 'scan.loading': string
  readonly 'scan.missing': string
  readonly 'scan.orphans': string
  readonly 'scan.refresh': string
  readonly 'scan.title': string
  readonly 'scan.trash': string
  readonly 'session.stateWaiting': string
  readonly 'session.stateRunning': string
  readonly 'session.stateIdle': string
  readonly 'session.stateBlank': string
  readonly 'session.stateGone': string
  readonly 'session.purposeAnalysis': string
  readonly 'session.purposeDev': string
  readonly 'session.purposeReview': string
  /** 0022 (0018 D8 修订): the wp-plan delivery's sessions[] row label. */
  readonly 'session.purposeWpPlan': string
  readonly 'session.bindButton': string
  readonly 'session.bindTitle': string
  readonly 'session.pickerHint': string
  readonly 'session.pickerEmpty': string
  readonly 'session.pickerPurposeLabel': string
  readonly 'session.pickerSubmit': string
  readonly 'session.boundAtPrefix': string
  readonly 'session.sectionTitle': string
  readonly 'knowledge.candidatesTitle': string
  readonly 'knowledge.candidateDraftPrefix': string
  readonly 'knowledge.proposedSessionPrefix': string
  readonly 'knowledge.activate': string
  readonly 'knowledge.edit': string
  readonly 'knowledge.drop': string
  readonly 'knowledge.dropTitle': string
  readonly 'knowledge.dropDescription': string
  readonly 'knowledge.activateTitle': string
  readonly 'knowledge.scopeLabel': string
  readonly 'knowledge.scopeGlobal': string
  readonly 'knowledge.scopeRequirement': string
  readonly 'knowledge.scopeWorkspace': string
  readonly 'knowledge.metaWorkspace': string
  readonly 'knowledge.pathLabel': string
  readonly 'knowledge.globLabel': string
  readonly 'knowledge.triggerPath': string
  readonly 'knowledge.exportButton': string
  readonly 'knowledge.exportOne': string
  readonly 'knowledge.exportTitle': string
  readonly 'knowledge.typeLabel': string
  readonly 'knowledge.typeBusiness': string
  readonly 'knowledge.typeConvention': string
  readonly 'knowledge.triggerLabel': string
  readonly 'knowledge.triggerAlways': string
  readonly 'knowledge.triggerKeyword': string
  readonly 'knowledge.triggerManual': string
  readonly 'knowledge.keywordLabel': string
  readonly 'knowledge.activeTitle': string
  readonly 'knowledge.metaRequirement': string
  readonly 'knowledge.metaGlobal': string
  readonly 'knowledge.activatedAtPrefix': string
  readonly 'knowledge.archive': string
  readonly 'knowledge.archiveTitle': string
  readonly 'knowledge.archiveDescription': string
  readonly 'knowledge.add': string
  readonly 'knowledge.formTitleNew': string
  readonly 'knowledge.formTitleEdit': string
  readonly 'knowledge.titleLabel': string
  readonly 'knowledge.contentLabel': string
  readonly 'knowledge.emptyCandidates': string
  readonly 'knowledge.emptyActive': string
  readonly 'knowledge.loadError': string
  readonly 'knowledge.statSessions': string
  readonly 'knowledge.statFindings': string
  readonly 'knowledge.statRework': string
  readonly 'knowledge.statCycleDays': string
  readonly 'sow.analysisButton': string
  readonly 'sow.planButton': string
  readonly 'sow.splitButton': string
  readonly 'sow.workPackageButton': string
  readonly 'sow.wpPlanButton': string
  readonly 'sow.title': string
  readonly 'sow.knowledgeHit': string
  readonly 'sow.knowledgeEmpty': string
  readonly 'sow.knowledgeOverLimit': string
  readonly 'sow.wpGroup': string
  readonly 'sow.wpBoundaryPlan': string
  readonly 'sow.wpDeps': string
  readonly 'sow.wpNoApprovedPlan': string
  readonly 'sow.deliver': string
  readonly 'sow.deliverFailed': string
  readonly 'sow.copy': string
  readonly 'sow.copied': string
  readonly 'sow.copyFailed': string
  readonly 'sow.resetEdit': string
  readonly 'detail.dropDescription': string
  // 0018 刀二：dev 直投 ack（无已批准计划的软门确认）+ 规划收取来源会话行
  readonly 'detail.devNoPlanAckTitle': string
  readonly 'detail.devNoPlanAckBody': string
  readonly 'detail.devNoPlanAckConfirm': string
  readonly 'detail.planSeedSource': string
  /** 0018 缺陷修复：AI 尾草稿 missing 面板的「重新收取」动词（区别于人工尾草稿的「重试写入」） */
  readonly 'detail.planReseed': string
  // release.* — S5 上线清单（P3a：手动 CRUD + go/no-go + 漂移披露 + 上线单导出）
  readonly 'release.sectionTitle': string
  readonly 'release.add': string
  readonly 'release.exportButton': string
  readonly 'release.empty': string
  readonly 'release.gonogoGo': string
  readonly 'release.gonogoNoGo': string
  readonly 'release.gonogoPending': string
  readonly 'release.gonogoConfirmed': string
  readonly 'release.gonogoDrift': string
  readonly 'release.rollbackPlanPrefix': string
  readonly 'release.rollbackConfirmedShort': string
  readonly 'release.rollbackMissingShort': string
  readonly 'release.confirmRollbackPlan': string
  readonly 'release.revokeRollbackPlan': string
  readonly 'release.rollbackPlanTitle': string
  readonly 'release.rollbackPlanDescription': string
  readonly 'release.rollbackRevokeTitle': string
  readonly 'release.rollbackRevokeDescription': string
  readonly 'release.group.sql': string
  readonly 'release.group.config': string
  readonly 'release.group.flag': string
  readonly 'release.group.mq': string
  readonly 'release.group.other': string
  readonly 'release.status.pending': string
  readonly 'release.status.confirmed': string
  readonly 'release.status.applied': string
  readonly 'release.status.verified': string
  readonly 'release.status.rolled-back': string
  readonly 'release.menuConfirm': string
  readonly 'release.menuApplied': string
  readonly 'release.menuVerified': string
  readonly 'release.menuRollback': string
  readonly 'release.removeTitle': string
  readonly 'release.removeDescription': string
  readonly 'release.rollbackTitle': string
  readonly 'release.rollbackDescription': string
  readonly 'release.driftNote': string
  readonly 'release.lockedHint': string
  readonly 'release.sourcePrefix': string
  readonly 'release.appliedAtPrefix': string
  readonly 'release.formTitleNew': string
  readonly 'release.formTitleEdit': string
  readonly 'release.typeLabel': string
  readonly 'release.titleLabel': string
  readonly 'release.contentLabel': string
  readonly 'release.envsLabel': string
  readonly 'release.envsInvalid': string
  readonly 'release.workPackageLabel': string
  readonly 'release.workPackageNone': string
  readonly 'release.noteLabel': string
  readonly 'release.titleRequired': string
  readonly 'release.contentRequired': string
  // sheet.* — 上线单导出 Modal（剪贴板形态，sow-modal 先例）
  readonly 'sheet.title': string
  readonly 'sheet.copy': string
  readonly 'sheet.copied': string
  readonly 'sheet.copyFailed': string
  // 挂账轮：下载（blob + a[download]，web 平台能力——webview 行为实机验收验证）
  readonly 'sheet.download': string
  readonly 'sheet.downloaded': string
  readonly 'sheet.downloadFailed': string
  // declare.* — 声明块导入（P3b：抓取 + 粘贴 + 逐条勾选两段式）
  readonly 'declare.importButton': string
  readonly 'declare.title': string
  readonly 'declare.sessionLabel': string
  readonly 'declare.sessionPlaceholder': string
  readonly 'declare.fetchButton': string
  readonly 'declare.fetchNoService': string
  readonly 'declare.fetchNotFound': string
  readonly 'declare.fetchUnreadable': string
  readonly 'declare.fetchNoBlock': string
  readonly 'declare.noSessions': string
  readonly 'declare.textLabel': string
  readonly 'declare.parseButton': string
  readonly 'declare.blockNoBlock': string
  readonly 'declare.blockYamlSyntax': string
  readonly 'declare.empty': string
  readonly 'declare.groupBuilt': string
  readonly 'declare.groupArtifacts': string
  readonly 'declare.groupKnowledge': string
  readonly 'declare.stageReadyProposal': string
  readonly 'declare.duplicateHint': string
  readonly 'declare.skippedTitle': string
  readonly 'declare.importSubmit': string
  readonly 'declare.doneTitle': string
  readonly 'declare.doneCounts': string
  readonly 'declare.staleHint': string
  readonly 'declare.textChangedHint': string
  // 0016 P2a: evidence advisory keys
  readonly 'declare.evidenceSummary': string
  readonly 'declare.evidenceFiles': string
  readonly 'declare.evidenceVerification': string
  readonly 'declare.noEvidenceHint': string
  readonly 'declare.completionNotEvidence': string
  readonly 'advance.unacceptedCount': string
  readonly 'declare.reparseButton': string
  readonly 'declare.miss.noService': string
  readonly 'declare.miss.notFound': string
  readonly 'declare.miss.unreadable': string
  readonly 'declare.miss.noDeclareBlock': string
  readonly 'declare.miss.noBinding': string
  readonly 'declare.miss.wpNotInDev': string
  readonly 'declare.miss.wpMismatch': string
  readonly 'declare.skip.bad-shape': string
  readonly 'declare.skip.bad-type': string
  readonly 'declare.skip.bad-severity': string
  readonly 'declare.skip.bad-title': string
  readonly 'declare.skip.bad-content': string
  readonly 'declare.skip.over-cap': string
  readonly 'declare.skip.bad-envs': string
  readonly 'declare.skip.wp-not-found': string
  readonly 'declare.skip.wp-not-in-dev': string
  // declareCard.* — 0016 P1a 声明收取卡（dev-declare 槽三态面）
  // execution.* — 0016 P1b 执行视图
  readonly 'execution.archiveTitle': string
  readonly 'execution.backToBoard': string
  readonly 'execution.filesChanged': string
  readonly 'execution.jumpToSession': string
  readonly 'execution.liveRunning': string
  readonly 'execution.liveTitle': string
  readonly 'execution.loadError': string
  readonly 'execution.minutes': string
  readonly 'execution.model': string
  readonly 'execution.noSession': string
  readonly 'execution.queued': string
  readonly 'execution.tokens': string
  readonly 'execution.turnN': string
  readonly 'execution.waitingForYou': string
  // inbox.* — 0016 P1c 收件箱瘦身段
  readonly 'inbox.groupPending': string
  readonly 'inbox.groupStuck': string
  readonly 'inbox.jumpToSession': string
  readonly 'inbox.openDetail': string
  readonly 'inbox.pendingSend': string
  readonly 'inbox.sectionTitle': string
  readonly 'inbox.stuckGone': string
  readonly 'inbox.stuckIdle': string
  readonly 'inbox.stuckNoBinding': string
  readonly 'declareCard.sectionTitle': string
  readonly 'declareCard.pendingTitle': string
  readonly 'declareCard.importButton': string
  readonly 'declareCard.dismissButton': string
  readonly 'declareCard.retryButton': string
  readonly 'declareCard.importedLine': string
  readonly 'declareCard.needInDevHint': string
  readonly 'declareCard.commitsTitle': string
  readonly 'declareCard.commitConfirmed': string
  readonly 'declareCard.commitUnverified': string
  readonly 'declareCard.commitConfirm': string
  readonly 'declareCard.dismissedLine': string
  // review.* — S4 评审视图（P4：报告导入 + 手动裁决行 + PRD 覆盖矩阵）
  readonly 'review.sectionTitle': string
  readonly 'review.importButton': string
  readonly 'review.empty': string
  readonly 'review.counts': string
  readonly 'review.verdictsTitle': string
  readonly 'review.verdictsEmpty': string
  readonly 'review.addVerdict': string
  readonly 'review.matrixTitle': string
  readonly 'review.matrixSummary': string
  /** 0026 排版轮: 置顶状态条的核验计数段（四段全列——诚实计数，未核验也是状态）。 */
  readonly 'review.stripChecks': string
  readonly 'review.matrixDone': string
  readonly 'review.matrixUndone': string
  readonly 'review.holeChip': string
  readonly 'review.importTitle': string
  readonly 'review.reportTitleLabel': string
  readonly 'review.bodyLabel': string
  readonly 'review.detailTitle': string
  readonly 'review.verdictAddTitle': string
  readonly 'review.verdictEditTitle': string
  readonly 'review.verdictTitleLabel': string
  readonly 'review.verdictLabel': string
  readonly 'review.verdictConfirmed': string
  readonly 'review.verdictRejected': string
  readonly 'review.verdictPending': string
  readonly 'review.dispositionLabel': string
  readonly 'review.disposition.to-fix': string
  readonly 'review.disposition.fixed': string
  readonly 'review.disposition.wont-fix': string
  readonly 'review.noteLabel': string
  readonly 'review.noteRequired': string
  readonly 'review.removeVerdictTitle': string
  readonly 'review.removeVerdictDescription': string
  readonly 'review.removeReportTitle': string
  readonly 'review.removeReportDescription': string
  readonly 'review.fileMissing': string
  // review.* fetch (P5b structured review convention — session抓取 + 种子披露)
  readonly 'review.sessionLabel': string
  readonly 'review.sessionPlaceholder': string
  readonly 'review.fetchButton': string
  readonly 'review.fetchNoService': string
  readonly 'review.fetchNotFound': string
  readonly 'review.fetchUnreadable': string
  readonly 'review.fetchNoBlock': string
  // 0024 修订#1: 抓取候选放开为工作区全体会话（绑定指针仅置顶）——空态语义随之改义
  readonly 'review.noSessions': string
  readonly 'review.seededCount': string
  readonly 'review.seededWithBlockError': string
  // 0023 评审方法论轮: criteriaChecks 核验面（D2-A 信息展示）与 findings 证据面（D4-A 只读）
  readonly 'review.checkSatisfied': string
  readonly 'review.checkUnmet': string
  readonly 'review.checkNotVerifiable': string
  // 0025 核验矩阵轮: 矩阵主列的诚实缺席——尚无任何报告核验过该标准（区别于 AI 判「无法核验」）
  readonly 'review.unchecked': string
  readonly 'review.checksCount': string
  readonly 'review.checkEvidence': string
  readonly 'review.seededChecks': string
  // sow.reviewButton — S4 评审任务书入口（P5b 第四种 purpose）
  readonly 'sow.reviewButton': string
  // knowledge.candidateAdd — S6 手动提炼（P4 §7.4 通道②）
  readonly 'knowledge.candidateAdd': string
  readonly 'knowledge.candidateAddTitle': string
}

export type WorkbenchT = (key: keyof WorkbenchDictionary) => string

/** 回传轮: seed zero-write reason → hint key (reuses the declare.fetch* copy —
 *  the S5 modal phrases fit verbatim). The {n} placeholder in blockYamlSyntax
 *  has no line number on this face; renderers replace it with '?'. */
export const SEED_MISS_KEY: Readonly<Record<'no-service' | 'not-found' | 'unreadable' | 'no-declare-block' | 'yaml-syntax' | 'report-file-missing' | 'report-file-too-large' | 'report-file-syntax' | 'split-file-missing' | 'split-file-too-large' | 'split-file-syntax' | 'wp-plan-file-missing' | 'wp-plan-file-too-large', keyof WorkbenchDictionary>> = {
  'no-service': 'declare.fetchNoService',
  'not-found': 'declare.fetchNotFound',
  'unreadable': 'declare.fetchUnreadable',
  'no-declare-block': 'declare.fetchNoBlock',
  'yaml-syntax': 'declare.blockYamlSyntax',
  'report-file-missing': 'proposal.seedMissReportFileMissing',
  'report-file-too-large': 'proposal.seedMissReportFileTooLarge',
  'report-file-syntax': 'proposal.seedMissReportFileSyntax',
  'split-file-missing': 'proposal.seedMissSplitFileMissing',
  'split-file-too-large': 'proposal.seedMissSplitFileTooLarge',
  'split-file-syntax': 'proposal.seedMissSplitFileSyntax',
  'wp-plan-file-missing': 'proposal.seedMissWpPlanFileMissing',
  'wp-plan-file-too-large': 'proposal.seedMissWpPlanFileTooLarge',
}

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
  'workbench.stageHint.plan': '工作包拆分与两道硬门（批准拆分 / 批准计划）将在此落地。',
  'workbench.stageHint.implement': '工作包看板（含验证）与 session 关联将在此呈现。',
  'workbench.stageHint.review': '评审报告裁决与 PRD 覆盖矩阵将在此收口。',
  'workbench.stageHint.deliver': '上线产物登记（SQL / 配置 / 开关 / MQ）与 go/no-go 结论将在此管理。',
  'workbench.stageHint.retro': '知识候选激活与复盘统计将在此沉淀。',
  'page.loading': '正在加载 AI 工作台…',
  'page.degraded': 'AI 工作台账本文件不可读（可能已损坏）。',
  'page.degradedBackupHint': '可从 $DSH_HOME/skyaxis/ 下同名 .bak 文件手动恢复；修复前拒绝写入以保护现场。',
  'proposal.adopt': '采纳',
  'proposal.answer': '回答',
  'proposal.answerCancel': '取消',
  'proposal.answered': '已答',
  'proposal.answerPlaceholder': '输入你的回答…',
  'proposal.answerPrefix': '已答：',
  'proposal.answerSave': '提交回答',
  'proposal.blocksPrefix': '阻塞：',
  'proposal.clarificationsTitle': '待澄清（分析会话）',
  'proposal.criteriaTitle': '待裁决标准提议（分析会话）',
  'proposal.dismiss': '不采',
  'proposal.findingsTitle': '待裁决发现提议（分析会话）',
  'proposal.ignore': '忽略',
  'proposal.lockedHint': '拆分已批准：标准提议的【采纳】待解锁（撤销批准/重新拆分后可采），【不采】不受影响。',
  'proposal.recommendationPrefix': '推荐：',
  'proposal.retry': '重新收取',
  'proposal.scanPrefix': '收取扫描：',
  'proposal.seedMissReportFileMissing': '报告文件未找到——任务书规定会话把报告写入工作区 .skyaxis/analysis/ 目录；会话可能尚未写完，或未按指定路径写入（此提示下方的扫描指纹来自会话兜底通道）。',
  'proposal.seedMissReportFileSyntax': '报告文件中无可解析的声明块——yaml 围栏缺失或未闭合，可让会话补写报告文件。',
  'proposal.seedMissReportFileTooLarge': '报告文件超过读取上限（2 MiB）——请让会话精简报告后重新收取。',
  'proposal.seedMissSplitFileMissing': '拆分结果文件未找到——任务书规定会话把拆分方案写入工作区 .skyaxis/split/ 目录；会话可能尚未写完，或未按指定路径写入。',
  'proposal.seedMissSplitFileSyntax': '拆分结果文件中无可解析的声明块——yaml 围栏缺失或未闭合，可让会话补写结果文件。',
  'proposal.seedMissSplitFileTooLarge': '拆分结果文件超过读取上限（2 MiB）——请让会话精简后重新收取。',
  'proposal.seedMissWpPlanFileMissing': '工作包计划文件未找到——规划任务书规定会话把计划写入工作区 .skyaxis/wps/<工作包>/plan.md；会话可能尚未写完，或未按指定路径写入。',
  'proposal.seedMissWpPlanFileTooLarge': '工作包计划文件超过读取上限（2 MiB）——请让会话精简计划后重新收取。',
  'proposal.sourcePrefix': '来源会话 {id}…',
  'proposal.waitingHint': '分析会话的报告尚未收取——会话收尾后自动收为待裁决行；若会话已被删除，可重新投递。',
  'report.title': '分析报告',
  'report.refresh': '刷新',
  'report.preview': '预览报告',
  'report.pathPrefix': '文件：',
  'report.missing': '分析报告文件尚未生成——会话按任务书把报告写入工作区 .skyaxis/analysis/ 后，此处出现报告文件卡片，点击即可预览正文。',
  'report.noWorkspace': '本需求未绑定工作区——分析报告在会话内交付，无报告文件可展示。',
  'report.loadError': '报告文件读取失败。',
  'report.tampered': '报告文件在收取后被外部修改（与收取时内容不一致）。',
  'report.mdCopyCode': '复制代码',
  'report.mdCopiedCode': '已复制',
  'report.mdFootnotes': '脚注',
  'page.loadError': 'AI 工作台数据加载失败。',
  'empty.firstUseHint': '本需求尚未启用 AI 工作台：登记第一条发现即建立工作台记录，之后可推进阶段。',
  'advance.stage': '完成本阶段 →',
  'advance.close': '关闭需求 →',
  'advance.closed': '该需求已关闭（阶段推进停止，记录与产物保留可查）。',
  'badge.findingsOpen': '待处置',
  'badge.workPackages': '工作包',
  'badge.progress': '已验收',
  'badge.reviewOpen': '待裁决',
  'badge.releaseItems': '上线项',
  'badge.candidates': '待审阅',
  'finding.sectionTitle': '发现',
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
  'error.lockedSplit': '拆分未批准或已撤销：清单与流程已锁定，请先批准拆分（硬门①）',
  'error.lockedVersion': '该计划版本已批准锁定，不可修改；修正请另存新草稿',
  'action.cancel': '取消',
  'action.save': '保存',
  'action.confirm': '确认',
  'menu.edit': '编辑',
  'menu.remove': '删除',
  'menu.moveUp': '上移',
  'menu.moveDown': '下移',
  'criteria.sectionTitle': '验收标准',
  'criteria.add': '＋ 添加标准',
  'criteria.addTitle': '新建验收标准',
  'criteria.editTitle': '编辑验收标准',
  'criteria.textLabel': '标准内容',
  'criteria.sourceLabel': '来源章节（可选）',
  'criteria.removeTitle': '删除验收标准',
  'criteria.removeDescription': '确定删除该验收标准？工作包对该标准的覆盖引用将被一并剥离。',
  'criteria.uncovered': '尚无工作包覆盖',
  'criteria.lockedHint': '拆分已批准：验收标准与工作包清单一并锁定，撤销批准后可编辑。',
  // triptych.* — S1 三栏待裁决区（布局重塑轮）
  'triptych.title': '待裁决',
  'triptych.noSessionHint': '尚未绑定分析会话——点击「生成分析任务书」开始本阶段分析。',
  'triptych.settledHint': '本列暂无待裁决项。',
  // understand.* — 0007 定稿软门
  'understand.stageReadyTag': '分析会话提议：本阶段就绪',
  'understand.exportButton': '导出理解摘要',
  'understand.exportTitle': '需求理解摘要',
  'understand.approveButton': '定稿需求理解',
  'understand.approveTitle': '定稿需求理解',
  'understand.statCriteria': '验收标准 {n} 条',
  'understand.statFindings': '发现：已处置 {d} · 未处置 {o}',
  'understand.statClarifications': '澄清：已答 {a} · 未答 {u}',
  'understand.statProposals': '待裁决提议 {n}',
  'understand.approveAck': '我已核对上述统计——未处置发现、未答澄清与待裁决提议不阻断定稿，带着已知风险进规划是我的裁决。',
  'understand.approveConfirm': '确定定稿',
  'understand.approvedTag': '已定稿',
  'understand.approvedAtPrefix': '需求理解已定稿',
  'understand.bannerChanged': '定稿后上游已变化（裁决/答案/标准有更新）——重新定稿可刷新基线。',
  'understand.revoke': '撤销定稿',
  'understand.revokeTitle': '撤销定稿',
  'understand.revokeDescription': '确定撤销需求理解定稿？定稿戳与基线快照将一并移除（活账本的裁决内容不受影响），S2 可能出现「理解已重新定稿」失效提示。',
  'understand.revokeAck': '我确定撤销定稿。',
  'understand.revokeConfirm': '确定撤销',
  // 0008 需求基线文档轮
  'understand.consolidateButton': '生成整理任务书',
  'understand.ackDocWillAnchor': '检测到需求基线文档——定稿将锚定其当前内容（哈希）。此后文档变更会以失效提示披露。',
  'understand.ackNoDoc': '尚无需求基线文档——可先生成整理任务书（不阻断定稿；无文档的定稿不锚定任何哈希）。',
  'baseline.title': '需求基线文档',
  'baseline.missing': '尚未生成——生成整理任务书投递后，AI 会把融合文档写入工作区。',
  'baseline.noWorkspace': '本需求未绑定工作区——无基线文档可展示。',
  'baseline.pathPrefix': '路径：',
  'baseline.tampered': '内容与定稿锚定的版本不一致（可能被外部修改）——以工作台裁决为准，重新整理可刷新。',
  'baseline.refresh': '刷新',
  'baseline.preview': '预览需求基线文档',
  'baseline.loadError': '读取失败，请重试。',
  'planning.title': '技术规划文档',
  'planning.missing': '规划文档未找到——规划会话尚未写入，或未按指定路径写入。',
  'planning.noWorkspace': '未绑定工作区——规划文档通道未武装，规划在会话内交付。',
  'planning.pathPrefix': '路径：',
  'planning.tampered': '文档与采纳锚不一致（磁盘文件在采纳后被改动）。',
  'planning.refresh': '刷新',
  'planning.preview': '预览规划文档',
  'planning.loadError': '规划文档读取失败。',
  'planning.adoptButton': '采纳规划',
  'planning.adoptTitle': '采纳技术规划',
  'planning.adoptAck': '我已审阅规划文档，采纳其为方案真源。',
  'planning.adoptConfirm': '采纳',
  'planning.ackDocWillAnchor': '规划文档在场——采纳即锚定其当前内容。',
  'planning.ackNoDoc': '规划文档不在场（未写入或无工作区）——采纳仍成立，但不锚定文档。',
  'planning.adoptedTag': '已采纳',
  'planning.adoptedAtPrefix': '采纳于',
  'planning.revokeButton': '撤销采纳',
  'planning.revokeTitle': '撤销规划采纳',
  'planning.revokeConfirm': '撤销',
  'planning.revokeAck': '撤销采纳将摘除锚定；拆分任务书回到「尚无已采纳规划」形态。',
  'planning.staleBadge': '上游基线已变更',
  'split.sectionTitle': '工作包拆分',
  'split.add': '＋ 工作包',
  'split.approve': '批准拆分',
  'split.approveTitle': '批准拆分（硬门①）',
  'split.statWorkPackages': '{n} 个工作包',
  'split.statCovered': '{n}/{m} 条标准已覆盖',
  'split.statHole': '{n} 条标准无覆盖',
  'split.approveAck': '批准后工作包清单与验收标准将锁定，执行看板与计划流程解锁；如需调整可撤销批准（清单保留）。',
  'split.approveConfirm': '批准拆分',
  'split.approvedTag': '已批准',
  'split.approvedAtPrefix': '拆分批准于',
  'split.revoke': '撤销批准',
  'split.revokeTitle': '撤销拆分批准',
  'split.revokeDescription': '撤销后工作包清单与全部流程动作将重新锁定，直至再次批准；清单本身保留。确定撤销？',
  'split.revokeConfirm': '撤销批准',
  'split.staleBadge': '上游已变更',
  'split.staleReason': '拆分批准后上游有变化：{reasons}',
  'split.stalePrd': 'PRD 文件',
  'split.staleFindings': '发现处置',
  'split.staleUnderstand': '理解已重新定稿',
  'split.staleClarifications': '澄清答案已变化',
  'split.staleRequirementDoc': '需求基线文档已变更',
  'split.stalePlanning': '已采纳的技术规划已变更（重新采纳/撤销）',
  'split.stillValid': '确认仍有效',
  'split.reSplit': '重新拆分',
  'split.reSplitBlocked': '有工作包已开工（开发中/待验收/已验收），无法重新拆分——请先处理其计划与会话。',
  'split.reSplitTitle': '重新拆分',
  'split.reSplitCount': '当前 {n} 个活动工作包将全部归档为「已放弃」，批准戳清除，清单重新可编辑。',
  'split.reSplitAck': '我确认要归档现有拆分并重新开始。',
  'split.reSplitConfirm': '归档并重新拆分',
  'split.droppedSectionTitle': '已放弃的工作包',
  'split.droppedTag': '已放弃',
  'split.restore': '恢复',
  'splitProposal.sectionTitle': '拆包提议（拆分会话）',
  'splitProposal.waiting': '拆分结果尚未收取——会话收尾后自动收为待登记提议。',
  'splitProposal.retry': '重新收取',
  'splitProposal.adoptSelected': '登记选中',
  'splitProposal.ignore': '忽略',
  'splitProposal.lockedHint': '拆分已批准：提议的【登记选中】待解锁（撤销批准/重新拆分后可登记），【忽略】不受影响。',
  'splitProposal.proposedTag': '提议',
  'splitResult.title': '拆分结果文档',
  'splitResult.missing': '拆分结果文件未找到——拆分会话尚未写入，或未按指定路径写入。',
  'splitResult.noWorkspace': '未绑定工作区——拆分结果文件通道未武装，拆分建议在会话内交付（无法自动收取）。',
  'splitResult.pathPrefix': '路径：',
  'splitResult.tampered': '文档与收取锚不一致（磁盘文件在收取后被改动）。',
  'splitResult.refresh': '刷新',
  'splitResult.preview': '预览拆分结果文档',
  'splitResult.loadError': '拆分结果文档读取失败。',
  'wp.addTitle': '新建工作包',
  'wp.editTitle': '编辑工作包',
  'wp.titleLabel': '标题',
  'wp.boundaryLabel': '边界（做什么 / 不做什么）',
  'wp.dependsLabel': '依赖的工作包',
  'wp.coversLabel': '覆盖的验收标准',
  'wp.parallelLabel': '可与其他工作包并行',
  'wp.parallelTag': 'P 并行',
  'wp.copyBody': '复制正文',
  'wp.noneMark': '—',
  'wp.removeTitle': '删除工作包',
  'wp.removeDescription': '确定删除该工作包？兄弟工作包对它的依赖引用将被一并剥离。',
  'board.colPlanned': '待计划',
  'board.colPlanApproved': '计划已批准',
  'board.colInDev': '开发中',
  'board.colBuilt': '待验收',
  'board.colAccepted': '已验收',
  'board.lockedHint': '批准拆分后此处呈现执行看板（硬门①未过）。',
  'board.notDrafted': '未起草',
  'board.drafting': '草拟中',
  'board.planTag': '计划 v{n}',
  'board.planMissing': '计划文件缺失',
  'board.declareReady': '可收取',
  'board.sessions': '{n} 会话',
  'board.viewExecution': '查看执行',
  'board.commits': 'commit {n}',
  'board.progressAccepted': '{n}/{m} 已验收',
  'board.progressBuilt': '{n} 待验收',
  'board.progressInDev': '{n} 开发中',
  'board.progressPlanApproved': '{n} 计划已批准',
  'board.progressPlanned': '{n} 待计划',
  'board.accept': '验收通过',
  'board.reject': '不通过',
  'board.rejectTitle': '验收不通过',
  'board.rejectReasonLabel': '返工原因（必填）',
  'board.rejectReasonRequired': '请填写返工原因',
  'board.rejectSubmit': '确认不通过',
  'detail.statusPlanned': '已登记',
  'detail.statusPlanDraft': '计划草拟中',
  'detail.statusPlanApproved': '计划已批准',
  'detail.statusInDev': '开发中',
  'detail.statusBuilt': '待验收（已完成声明）',
  'detail.statusAccepted': '已验收',
  'detail.statusDropped': '已放弃',
  'detail.contentSection': '工作包内容',
  'detail.planSection': '开发计划',
  'detail.versionCurrent': '当前',
  'detail.versionDraft': '草稿',
  'detail.versionArchived': '归档',
  'detail.versionApproved': '已批准',
  'detail.noPlans': '尚无计划：起草并批准后，开发流程解锁。',
  'detail.planMissing': '文件缺失（写入中断或被外部删除）',
  'detail.planRewrite': '重试写入',
  'detail.planLoadFailed': '计划正文加载失败',
  'detail.tampered': '内容校验不一致：文件可能被外部修改，以下正文仅供参考。',
  'detail.draftLabel': '草稿（保存即覆盖尾版本，版本号由系统分配）',
  'detail.draftPlaceholder': '以 markdown 撰写实施计划…',
  'detail.draftSave': '保存草稿',
  'detail.sessionsSection': '关联会话',
  'detail.commitsSection': 'commit 记录',
  'detail.acceptanceSection': '验收',
  'detail.acceptanceEmpty': '尚无验收记录',
  'detail.acceptancePass': '通过',
  'detail.acceptanceFail': '不通过',
  'rework.title': '返工话',
  'rework.send': '发送返工话',
  'rework.targetLabel': '发往会话',
  'rework.previewLabel': '返工话内容（发送前可修改）',
  'rework.sendFailed': '发送失败——可复制后跳会话粘贴',
  'detail.builtSourceManual': '完成声明可手动标记；绑定会话的声明块会自动收取（见上方「声明收取」），导入后此处标记 built。',
  'detail.returnForEdit': '退回修改',
  'detail.approvePlan': '批准计划',
  'detail.startWork': '开始开发',
  'detail.markBuilt': '标记完成待验收',
  'detail.reopen': '重开',
  'detail.drop': '放弃',
  'detail.dropTitle': '放弃工作包',
  'md.copyCode': '复制代码',
  'md.copiedCode': '已复制',
  'md.edit': '编辑',
  'md.footnotes': '脚注',
  'md.preview': '预览',
  'detail.dropDescription': '确定放弃该工作包？已放弃的工作包不再入板，历史保留。',
  'detail.devNoPlanAckTitle': '尚无已批准计划',
  'detail.devNoPlanAckBody': '本工作包尚无已批准计划——直接投递开发任务书时，AI 将仅依据工作包边界开发（任务书不含已批准计划）。建议先生成工作包规划任务书，批准后再投递开发。',
  'detail.devNoPlanAckConfirm': '仍要生成开发任务书',
  'detail.planSeedSource': '规划收取来源会话 {id}…',
  'detail.planReseed': '重新收取',
  'scan.button': '产物对账',
  'scan.empty': '无',
  'scan.failed': '对账失败（账本不可读或网络错误），可刷新重试。',
  'scan.kindPlan': '计划',
  'scan.kindReview': '报告',
  'scan.kindUnknown': '未识别',
  'scan.loading': '对账中…',
  'scan.missing': '缺失（账本有引用 · 盘上无文件）',
  'scan.orphans': '孤儿（盘上有文件 · 账本无引用）',
  'scan.refresh': '刷新',
  'scan.title': '产物对账（只读）',
  'scan.trash': '.trash（已删除需求）',
  'session.stateWaiting': '待输入',
  'session.stateRunning': '运行中',
  'session.stateIdle': '空闲',
  'session.stateBlank': '空壳会话（投递残留，未开始）',
  'session.stateGone': '会话已不在列表',
  'session.purposeAnalysis': '分析',
  'session.purposeDev': '开发',
  'session.purposeReview': '评审',
  'session.purposeWpPlan': '规划',
  'session.bindButton': '＋ 关联',
  'session.bindTitle': '关联 session',
  'session.pickerHint': '从会话列表选择要绑定的 session（已绑定本工作包的不可重复绑定）。',
  'session.pickerEmpty': '会话列表为空。',
  'session.pickerPurposeLabel': '用途',
  'session.pickerSubmit': '关联',
  'session.boundAtPrefix': '绑定于',
  'session.sectionTitle': '关联 session',
  'knowledge.candidatesTitle': '知识候选',
  'knowledge.candidateDraftPrefix': 'draft：',
  'knowledge.proposedSessionPrefix': '提议 session：',
  'knowledge.activate': '激活',
  'knowledge.edit': '编辑',
  'knowledge.drop': '丢弃',
  'knowledge.dropTitle': '丢弃知识候选',
  'knowledge.dropDescription': '确定丢弃该候选？丢弃后不再出现在审阅队列。',
  'knowledge.activateTitle': '激活知识条目',
  'knowledge.scopeLabel': '作用域',
  'knowledge.scopeGlobal': '全局（所有需求注入）',
  'knowledge.scopeRequirement': '仅本需求',
  'knowledge.scopeWorkspace': '工作区（绑定此工作区的需求注入）',
  'knowledge.metaWorkspace': 'scope 工作区 ·',
  'knowledge.pathLabel': '工作区路径（所有权键）',
  'knowledge.globLabel': '路径 glob（如 src/**）',
  'knowledge.triggerPath': 'path（路径命中注入）',
  'knowledge.exportButton': '导出',
  'knowledge.exportOne': '导出此条',
  'knowledge.exportTitle': '知识导出',
  'knowledge.typeLabel': '类型',
  'knowledge.typeBusiness': 'business（业务知识）',
  'knowledge.typeConvention': 'convention（开发约定）',
  'knowledge.triggerLabel': '触发',
  'knowledge.triggerAlways': 'always（总是注入）',
  'knowledge.triggerKeyword': 'keyword（标题/边界命中）',
  'knowledge.triggerManual': 'manual（仅显式勾选）',
  'knowledge.keywordLabel': '关键词（必填）',
  'knowledge.activeTitle': '已激活知识（本需求相关）',
  'knowledge.metaRequirement': 'scope 本需求',
  'knowledge.metaGlobal': 'scope 全局',
  'knowledge.activatedAtPrefix': '激活',
  'knowledge.archive': '归档',
  'knowledge.archiveTitle': '归档知识条目',
  'knowledge.archiveDescription': '确定归档？归档不可逆（P2 无恢复操作）。',
  'knowledge.add': '＋ 手动添加',
  'knowledge.formTitleNew': '新建知识条目',
  'knowledge.formTitleEdit': '编辑知识条目',
  'knowledge.titleLabel': '标题',
  'knowledge.contentLabel': '内容（markdown）',
  'knowledge.emptyCandidates': '暂无待审阅候选。',
  'knowledge.emptyActive': '暂无已激活知识。',
  'knowledge.loadError': '知识库加载失败。',
  'knowledge.statSessions': '关联 session',
  'knowledge.statFindings': '发现处置',
  'knowledge.statRework': '返工次数',
  'knowledge.statCycleDays': '周期（天）',
  'sow.analysisButton': '生成分析任务书',
  'sow.planButton': '生成规划任务书',
  'sow.splitButton': '生成拆分任务书',
  'sow.reviewButton': '生成评审任务书',
  'sow.workPackageButton': '生成工作包任务书',
  'sow.wpPlanButton': '生成工作包规划任务书',
  'sow.title': '生成任务书',
  'sow.knowledgeHit': '命中 {n} · {size} / 上限 {cap}',
  'sow.knowledgeEmpty': '没有命中的知识条目。',
  'sow.knowledgeOverLimit': '超出注入上限（{entries} 条 / {size}）：请取消部分勾选。',
  'sow.wpGroup': '工作包范围',
  'sow.wpBoundaryPlan': '边界 + 已批准计划',
  'sow.wpDeps': '依赖工作包摘要',
  'sow.wpNoApprovedPlan': '（尚无已批准计划，仅注入边界）',
  'sow.deliver': '投递并发送',
  'sow.deliverFailed': '投递失败：请复制后手动粘贴。',
  'sow.copy': '复制到剪贴板',
  'sow.copied': '已复制',
  'sow.copyFailed': '复制失败：请手动选中预览文本复制。',
  'sow.resetEdit': '恢复生成内容',
  // release.* — S5 上线清单（P3a）
  'release.sectionTitle': '上线清单',
  'release.add': '＋ 登记',
  'release.exportButton': '导出上线单',
  'release.empty': '尚未登记上线项。开发过程中产生的 SQL / 配置 / 开关 / MQ 变更，在此登记以防上线遗漏。',
  'release.gonogoGo': 'GO',
  'release.gonogoNoGo': '前置条件未满足',
  'release.gonogoPending': '待确认 {n}',
  'release.gonogoConfirmed': '已确认 {n}',
  'release.gonogoDrift': '漂移 {n}',
  'release.rollbackPlanPrefix': '回滚预案',
  'release.rollbackConfirmedShort': '已确认',
  'release.rollbackMissingShort': '未确认',
  'release.confirmRollbackPlan': '确认回滚预案',
  'release.revokeRollbackPlan': '撤销预案确认',
  'release.rollbackPlanTitle': '确认回滚预案',
  'release.rollbackPlanDescription': '确认本次上线全部变更的回滚预案已备妥（回滚脚本 / 回退参数 / 关窗方案）。这是 go/no-go 的第三条件。',
  'release.rollbackRevokeTitle': '撤销预案确认',
  'release.rollbackRevokeDescription': '撤销后 go/no-go 将回到「前置条件未满足」。',
  'release.group.sql': 'SQL',
  'release.group.config': '配置',
  'release.group.flag': '开关',
  'release.group.mq': 'MQ',
  'release.group.other': '其他',
  'release.status.pending': '待确认',
  'release.status.confirmed': '已确认',
  'release.status.applied': '已执行',
  'release.status.verified': '已验证',
  'release.status.rolled-back': '已回滚',
  'release.menuConfirm': '确认进清单',
  'release.menuApplied': '标记已执行',
  'release.menuVerified': '标记已验证',
  'release.menuRollback': '回滚',
  'release.removeTitle': '删除上线项',
  'release.removeDescription': '该条目尚未确认进清单，删除后不可恢复。',
  'release.rollbackTitle': '回滚上线项',
  'release.rollbackDescription': '回滚是终态：标记该变更不随本次上线（或已从环境移除），条目保留在清单中作审计轨迹。',
  'release.driftNote': '内容已被外部修改（与登记时哈希不一致）',
  'release.lockedHint': '内容已锁定只读 · 修正 = 新登记一条 + 旧条目回滚',
  'release.sourcePrefix': '来源',
  'release.appliedAtPrefix': '执行',
  'release.formTitleNew': '登记上线项',
  'release.formTitleEdit': '编辑上线项',
  'release.typeLabel': '类型',
  'release.titleLabel': '标题',
  'release.contentLabel': '内容（SQL / 配置值）',
  'release.envsLabel': '环境（逗号分隔，如 prod,pre）',
  'release.envsInvalid': '环境名须为 1-64 个字符',
  'release.workPackageLabel': '归属工作包',
  'release.workPackageNone': '（无）',
  'release.noteLabel': '备注',
  'release.titleRequired': '标题必填',
  'release.contentRequired': '内容必填',
  // sheet.* — 上线单导出 Modal
  'sheet.title': '上线单',
  'sheet.copy': '复制到剪贴板',
  'sheet.copied': '已复制',
  'sheet.copyFailed': '复制失败：请手动选中预览文本复制。',
  'sheet.download': '下载为文件',
  'sheet.downloaded': '已下载',
  'sheet.downloadFailed': '下载失败：请改用复制。',
  // declare.* — 声明块导入（P3b）
  'declare.importButton': '导入声明',
  'declare.title': '导入声明',
  'declare.sessionLabel': '从会话抓取',
  'declare.sessionPlaceholder': '选择会话…',
  'declare.fetchButton': '抓取',
  'declare.fetchNoService': '宿主未提供会话读取服务——请手动粘贴声明块文本。',
  'declare.fetchNotFound': '会话不存在或已被清理。',
  'declare.fetchUnreadable': '会话日志读取失败。',
  'declare.fetchNoBlock': '该会话的助手消息里没有 # skyaxis-declare 声明块。',
  'declare.noSessions': '当前工作区没有可抓取的会话（从未运行的空壳不算）；也可直接粘贴。',
  'declare.textLabel': '声明块文本（抓取或粘贴）',
  'declare.parseButton': '解析预览',
  'declare.blockNoBlock': '文本里没有 # skyaxis-declare 声明块。',
  'declare.blockYamlSyntax': '声明块 YAML 语法错误（第 {n} 行附近）——请修正后重试。',
  'declare.empty': '声明块里没有可导入的条目。',
  'declare.groupBuilt': 'built 声明',
  'declare.groupArtifacts': '上线项',
  'declare.groupKnowledge': '知识候选',
  'declare.stageReadyProposal': 'AI 提议本阶段就绪——推进权在你，工作台不会代为推进。',
  'declare.duplicateHint': '与已有条目重复——默认不勾选',
  'declare.skippedTitle': '未纳入导入的行',
  'declare.importSubmit': '导入',
  'declare.doneTitle': '导入完成',
  'declare.doneCounts': 'built {b} · 上线项 {a} · 知识候选 {k} · 跳过 {s}',
  'declare.staleHint': '预览已过期（账本在预览后发生了变化）——请重新解析。',
  'declare.textChangedHint': '会话文本已变化（与收取时锚定的内容不一致）——建议重新抓取；确认无误可继续导入。',
  // 0016 P2a: evidence advisory
  'declare.evidenceSummary': '📋 交付自述：',
  'declare.evidenceFiles': '📁 改动文件',
  'declare.evidenceVerification': '✅ 验证证据',
  'declare.noEvidenceHint': '⚠️ 本声明块未附验证证据——完成声明不是证据，建议先看证据再验收。',
  'declare.completionNotEvidence': '完成声明不是证据——验收前请先查看验证证据与工作区。',
  'advance.unacceptedCount': '{n} 项未验收',
  'declare.reparseButton': '重新解析',
  'declare.miss.noService': '宿主未提供会话读取服务——可手动到 S5 导入声明。',
  'declare.miss.notFound': '绑定会话不存在或已被清理——可重新关联或手动粘贴。',
  'declare.miss.unreadable': '会话日志读取失败——稍后重试或手动粘贴。',
  'declare.miss.noDeclareBlock': '会话尚未输出声明块（可能还没完成）——完成后重试。',
  'declare.miss.noBinding': '未找到该工作包的任务书会话——投递并发送任务书后重试，或手动关联真实会话。',
  'declare.miss.wpNotInDev': '工作包不在开发中（未开始或已完成）——开始开发后收取。',
  'declare.miss.wpMismatch': '声明块指向了别的工作包——未收取。',
  // declareCard.* — 0016 P1a 声明收取卡
  'declareCard.commitsTitle': 'commit 记录（AI 报告，未校验）',
  'declareCard.commitConfirmed': '已确认',
  'declareCard.commitUnverified': '未校验',
  'declareCard.commitConfirm': '确认入账',
  'declareCard.sectionTitle': '声明收取',
  'declareCard.pendingTitle': 'AI 完成声明待处理（来自会话 {s} · 收取于 {at}）',
  'declareCard.importButton': '导入声明',
  'declareCard.dismissButton': '忽略',
  'declareCard.retryButton': '重新收取',
  'declareCard.importedLine': '声明已导入 · 第 {n} 轮 · {at}',
  'declareCard.needInDevHint': '工作包尚未开始开发——开始开发后可导入声明（标记 built）。',
  'declareCard.dismissedLine': '声明已忽略 · {at}',
  'declare.skip.bad-shape': '行结构不合法',
  'declare.skip.bad-type': 'type 不在允许枚举内',
  'declare.skip.bad-severity': 'severity 不在 high|medium|low 枚举内',
  'declare.skip.bad-title': '标题缺失或超过 64 字',
  'declare.skip.bad-content': '内容缺失',
  'declare.skip.over-cap': '内容超过 32K 上限',
  'declare.skip.bad-envs': '环境列表不合法',
  'declare.skip.wp-not-found': '工作包不存在',
  'declare.skip.wp-not-in-dev': '不可标记 built（拆分未批准或工作包非开发中）',
  // execution.* — 0016 P1b 执行视图
  'execution.archiveTitle': '执行档案',
  'execution.backToBoard': '返回看板',
  'execution.filesChanged': '{n} 文件变更',
  'execution.jumpToSession': '跳宿主会话',
  'execution.liveRunning': '运行中',
  'execution.liveTitle': '执行直播',
  'execution.loadError': '会话日志读取失败。',
  'execution.minutes': '{n} 分钟',
  'execution.model': '{m}',
  'execution.noSession': '尚无 dev 会话绑定——投递任务书后可见。',
  'execution.queued': '{n} 条排队',
  'execution.tokens': '{n} tokens',
  'execution.turnN': '—— 第 {n} 轮 ——',
  'execution.waitingForYou': '等你应答',
  // inbox.* — 0016 P1c 收件箱瘦身段
  'inbox.groupPending': '待发送',
  'inbox.groupStuck': '卡哪·存疑',
  'inbox.jumpToSession': '跳会话',
  'inbox.openDetail': '查看详情',
  'inbox.pendingSend': '待发送',
  'inbox.sectionTitle': '需要你',
  'inbox.stuckGone': '会话已不在列表',
  'inbox.stuckIdle': '空闲且无收取记录',
  'inbox.stuckNoBinding': '无 dev 绑定',

  // review.* — S4 评审视图（P4）
  'review.sectionTitle': '评审报告',
  'review.importButton': '＋ 导入报告',
  'review.empty': '尚未导入评审报告。让 AI 完成评审后，把报告 markdown 粘贴导入。',
  'review.counts': '发现 {n} · 待裁决 {p} · confirmed {c} / rejected {r}',
  'review.verdictsTitle': '裁决',
  'review.verdictsEmpty': '暂无裁决行——导入报告后逐条添加发现并裁决。',
  'review.addVerdict': '＋ 添加发现',
  'review.matrixTitle': '验收核验矩阵',
  'review.stripChecks': '核验 {s} 满足 / {u} 不满足 / {v} 无法核验 / {w} 未核验',
  'review.matrixSummary': '已处置 {n}/{m} · 空洞 {k}',
  'review.matrixDone': '完成',
  'review.matrixUndone': '未完成',
  'review.holeChip': '← 空洞',
  'review.importTitle': '导入评审报告',
  'review.reportTitleLabel': '报告标题（可选）',
  'review.bodyLabel': '报告正文（markdown）',
  'review.detailTitle': '评审报告',
  'review.verdictAddTitle': '添加发现',
  'review.verdictEditTitle': '编辑裁决',
  'review.verdictTitleLabel': '标题',
  'review.verdictLabel': '裁决',
  'review.verdictConfirmed': 'confirmed（成立）',
  'review.verdictRejected': 'rejected（驳回）',
  'review.verdictPending': '待裁决（AI 提议）',
  'review.dispositionLabel': '处置（confirmed 时）',
  'review.disposition.to-fix': '待修复',
  'review.disposition.fixed': '已修复',
  'review.disposition.wont-fix': '不修复',
  'review.noteLabel': '备注（rejected 必填理由）',
  'review.noteRequired': 'rejected 需填理由',
  'review.removeVerdictTitle': '删除裁决行',
  'review.removeVerdictDescription': '该裁决行将从报告中移除。',
  'review.removeReportTitle': '删除评审报告',
  'review.removeReportDescription': '报告条目将从清单移除；正文文件保留在产物目录（孤儿，扫描端点可见）。',
  'review.fileMissing': '报告正文文件缺失（写入中断或被外部删除）。',
  'review.sessionLabel': '从会话抓取',
  'review.sessionPlaceholder': '选择会话…',
  'review.fetchButton': '抓取',
  'review.fetchNoService': '宿主未提供会话读取服务——请手动粘贴报告正文。',
  'review.fetchNotFound': '会话不存在或已被清理。',
  'review.fetchUnreadable': '会话日志读取失败。',
  'review.fetchNoBlock': '该会话的助手消息里没有 # skyaxis-review 约定块（可仍作纯报告导入）。',
  'review.noSessions': '当前工作区没有可抓取的会话（从未运行的空壳不算）；也可直接粘贴。',
  'review.seededCount': '已导入，种子裁决行 {n} 条（待你逐条裁决）。',
  'review.seededWithBlockError': '已导入报告，但未解析到 # skyaxis-review 约定块或块语法有误——种子裁决行 {n} 条。',
  'review.checkSatisfied': '满足',
  'review.checkUnmet': '不满足',
  'review.checkNotVerifiable': '无法核验',
  'review.unchecked': '未核验',
  'review.checksCount': '核验 {s} 满足 / {u} 不满足 / {v} 无法核验',
  'review.checkEvidence': '证据',
  'review.seededChecks': '核验行 {n} 条',
  'knowledge.candidateAdd': '＋ 提炼',
  'knowledge.candidateAddTitle': '提炼知识候选',
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
  'workbench.stageHint.understand': 'Analysis findings and acceptance criteria will be gathered here; generate an analysis statement of work to carry into a session.',
  'workbench.stageHint.plan': 'Work-package breakdown and the two hard gates (approve breakdown / approve plan) will land here.',
  'workbench.stageHint.implement': 'The workPackage board (verification included) and linked sessions will appear here.',
  'workbench.stageHint.review': 'Review report verdicts and the PRD coverage matrix will be closed out here.',
  'workbench.stageHint.deliver': 'Release artifact registration (SQL / config / flags / MQ) and the go/no-go verdict will be managed here.',
  'workbench.stageHint.retro': 'Knowledge candidate activation and retro statistics will be distilled here.',
  'page.loading': 'Loading the AI workbench…',
  'page.degraded': 'The AI workbench ledger file is unreadable (possibly corrupted).',
  'page.degradedBackupHint': 'Restore manually from the matching .bak file under $DSH_HOME/skyaxis/; writes stay refused until fixed to preserve the scene.',
  'proposal.adopt': 'Adopt',
  'proposal.answer': 'Answer',
  'proposal.answerCancel': 'Cancel',
  'proposal.answered': 'Answered',
  'proposal.answerPlaceholder': 'Type your answer…',
  'proposal.answerPrefix': 'Answer: ',
  'proposal.answerSave': 'Submit answer',
  'proposal.blocksPrefix': 'Blocks: ',
  'proposal.clarificationsTitle': 'Clarifications (analysis session)',
  'proposal.criteriaTitle': 'Pending criterion proposals (analysis session)',
  'proposal.dismiss': 'Reject',
  'proposal.findingsTitle': 'Pending finding proposals (analysis session)',
  'proposal.ignore': 'Ignore',
  'proposal.lockedHint': 'Split approved: adopting criterion proposals waits until the list unlocks (revoke/re-split); rejecting stays open.',
  'proposal.recommendationPrefix': 'Recommends: ',
  'proposal.retry': 'Retry collection',
  'proposal.scanPrefix': 'scan: ',
  'proposal.seedMissReportFileMissing': 'Report file not found — the task book tells the session to write the report under .skyaxis/analysis/ in the workspace; it may be unfinished or written elsewhere (the scan fingerprint below comes from the session fallback).',
  'proposal.seedMissReportFileSyntax': 'No parseable declare block in the report file — the yaml fence is missing or unclosed; ask the session to rewrite the file.',
  'proposal.seedMissReportFileTooLarge': 'The report file exceeds the read cap (2 MiB) — have the session trim it, then retry.',
  'proposal.seedMissSplitFileMissing': 'Split result file not found — the task book tells the session to write the split plan under .skyaxis/split/ in the workspace; it may be unfinished or written elsewhere.',
  'proposal.seedMissSplitFileSyntax': 'No parseable declare block in the split result file — the yaml fence is missing or unclosed; ask the session to rewrite the file.',
  'proposal.seedMissSplitFileTooLarge': 'The split result file exceeds the read cap (2 MiB) — have the session trim it, then retry.',
  'proposal.seedMissWpPlanFileMissing': 'WP plan file not found — the wp-plan task book tells the session to write the plan to .skyaxis/wps/<WP>/plan.md in the workspace; it may be unfinished or written elsewhere.',
  'proposal.seedMissWpPlanFileTooLarge': 'The WP plan file exceeds the read cap (2 MiB) — have the session trim the plan, then retry.',
  'proposal.sourcePrefix': 'from session {id}…',
  'proposal.waitingHint': 'The analysis session\'s report has not been collected yet — it lands here as pending rows once the session finishes; re-deliver if the session was deleted.',
  'report.title': 'Analysis report',
  'report.refresh': 'Refresh',
  'report.preview': 'Preview report',
  'report.pathPrefix': 'File: ',
  'report.missing': 'The report file has not been generated yet — once the session writes it to .skyaxis/analysis/ per the task book, the file card appears here; click it to preview the body.',
  'report.noWorkspace': 'No workspace bound to this requirement — the report is delivered in the conversation; there is no report file.',
  'report.loadError': 'Failed to read the report file.',
  'report.tampered': 'The report file was modified externally after collection (differs from what was collected).',
  'report.mdCopyCode': 'Copy code',
  'report.mdCopiedCode': 'Copied',
  'report.mdFootnotes': 'Footnotes',
  'page.loadError': 'Failed to load AI workbench data.',
  'empty.firstUseHint': 'The AI workbench is not enabled for this requirement yet: recording the first finding creates the workbench record; stages can be advanced afterwards.',
  'advance.stage': 'Complete stage →',
  'advance.close': 'Close requirement →',
  'advance.closed': 'This requirement is closed (stage advance stopped; the record and artifacts stay readable).',
  'badge.findingsOpen': 'open',
  'badge.workPackages': 'workPackages',
  'badge.progress': 'accepted',
  'badge.reviewOpen': 'unresolved',
  'badge.releaseItems': 'release items',
  'badge.candidates': 'pending',
  'finding.sectionTitle': 'Findings',
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
  'error.lockedSplit': 'The split is not approved (or was revoked): the list and the workflow are locked — approve the split first (hard gate ①)',
  'error.lockedVersion': 'That plan version is approved and locked; fix forward by saving a new draft',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.confirm': 'Confirm',
  'menu.edit': 'Edit',
  'menu.remove': 'Remove',
  'menu.moveUp': 'Move up',
  'menu.moveDown': 'Move down',
  'criteria.sectionTitle': 'Acceptance criteria',
  'criteria.add': '＋ Add criterion',
  'criteria.addTitle': 'New acceptance criterion',
  'criteria.editTitle': 'Edit acceptance criterion',
  'criteria.textLabel': 'Criterion text',
  'criteria.sourceLabel': 'Source section (optional)',
  'criteria.removeTitle': 'Remove criterion',
  'criteria.removeDescription': 'Remove this criterion? Coverage references from work packages will be stripped along with it.',
  'criteria.uncovered': 'No work package covers this',
  'criteria.lockedHint': 'The split is approved: criteria are locked with the list — revoke the approval to edit.',
  // triptych.* — S1 pending-adjudication triptych (layout reshape)
  'triptych.title': 'Pending adjudication',
  'triptych.noSessionHint': 'No analysis session bound yet — generate the analysis SOW to start this stage.',
  'triptych.settledHint': 'Nothing pending in this column.',
  // understand.* — 0007 understand finalize (soft gate)
  'understand.stageReadyTag': 'The analysis session proposes this stage is ready',
  'understand.exportButton': 'Export understanding summary',
  'understand.exportTitle': 'Understanding summary',
  'understand.approveButton': 'Finalize understanding',
  'understand.approveTitle': 'Finalize requirement understanding',
  'understand.statCriteria': 'Acceptance criteria: {n}',
  'understand.statFindings': 'Findings: disposed {d} · open {o}',
  'understand.statClarifications': 'Clarifications: answered {a} · unanswered {u}',
  'understand.statProposals': 'Pending AI proposals: {n}',
  'understand.approveAck': 'I have reviewed the stats — open findings, unanswered clarifications and pending proposals do NOT block finalizing; proceeding with known risks is my call.',
  'understand.approveConfirm': 'Finalize',
  'understand.approvedTag': 'Finalized',
  'understand.approvedAtPrefix': 'Understanding finalized',
  'understand.bannerChanged': 'Upstream changed after finalizing (rulings / answers / criteria) — re-finalize to refresh the baseline.',
  'understand.revoke': 'Revoke finalize',
  'understand.revokeTitle': 'Revoke finalize',
  'understand.revokeDescription': 'Revoke the understanding finalize? The stamp and baseline snapshot are removed together (live-ledger rulings stay); S2 may then show the understand stale hint.',
  'understand.revokeAck': 'I want to revoke the finalize.',
  'understand.revokeConfirm': 'Revoke',
  // 0008 requirement baseline doc round
  'understand.consolidateButton': 'Generate consolidation SOW',
  'understand.ackDocWillAnchor': 'Requirement baseline doc detected — finalizing will anchor its current content (hash); later changes surface as a stale hint.',
  'understand.ackNoDoc': 'No requirement baseline doc yet — you may generate the consolidation SOW first (not blocking: a doc-less finalize anchors no hash).',
  'baseline.title': 'Requirement baseline doc',
  'baseline.missing': 'Not generated yet — after you deliver the consolidation SOW, the AI writes the merged doc into the workspace.',
  'baseline.noWorkspace': 'This requirement has no bound workspace — no baseline doc to show.',
  'baseline.pathPrefix': 'Path: ',
  'baseline.tampered': 'Content differs from the finalized anchor (possibly edited externally) — the ledger rulings stay authoritative; re-consolidate to refresh.',
  'baseline.refresh': 'Refresh',
  'baseline.preview': 'Preview requirement baseline doc',
  'baseline.loadError': 'Read failed, please retry.',
  'planning.title': 'Technical planning doc',
  'planning.missing': 'Planning doc not found — the planning session has not written it yet, or wrote it elsewhere.',
  'planning.noWorkspace': 'No bound workspace — the planning-doc channel is off; planning is delivered in the conversation.',
  'planning.pathPrefix': 'Path: ',
  'planning.tampered': 'The doc disagrees with the adoption anchor (edited on disk after adoption).',
  'planning.refresh': 'Refresh',
  'planning.preview': 'Preview planning doc',
  'planning.loadError': 'Failed to load the planning doc.',
  'planning.adoptButton': 'Adopt planning',
  'planning.adoptTitle': 'Adopt technical planning',
  'planning.adoptAck': 'I have reviewed the planning doc and adopt it as the solution source.',
  'planning.adoptConfirm': 'Adopt',
  'planning.ackDocWillAnchor': 'The planning doc is present — adopting anchors its current content.',
  'planning.ackNoDoc': 'The planning doc is absent (unwritten or no workspace) — the adoption still stands, unanchored.',
  'planning.adoptedTag': 'Adopted',
  'planning.adoptedAtPrefix': 'Adopted at',
  'planning.revokeButton': 'Revoke adoption',
  'planning.revokeTitle': 'Revoke planning adoption',
  'planning.revokeConfirm': 'Revoke',
  'planning.revokeAck': 'Revoking strips the anchor; the split task book returns to the no-adopted-planning form.',
  'planning.staleBadge': 'Upstream baseline changed',
  'split.sectionTitle': 'Work-package breakdown',
  'split.add': '＋ Work package',
  'split.approve': 'Approve split',
  'split.approveTitle': 'Approve split (hard gate ①)',
  'split.statWorkPackages': '{n} work packages',
  'split.statCovered': '{n}/{m} criteria covered',
  'split.statHole': '{n} criteria uncovered',
  'split.approveAck': 'Approving locks the work-package list and criteria; the execution board and the plan workflow unlock. You can revoke to edit again (the list is preserved).',
  'split.approveConfirm': 'Approve split',
  'split.approvedTag': 'Approved',
  'split.approvedAtPrefix': 'Split approved at',
  'split.revoke': 'Revoke approval',
  'split.revokeTitle': 'Revoke split approval',
  'split.revokeDescription': 'Revoking re-locks the list and every workflow action until the next approval; the list itself is preserved. Revoke now?',
  'split.revokeConfirm': 'Revoke approval',
  'split.staleBadge': 'Upstream changed',
  'split.staleReason': 'Upstream changed after the split was approved: {reasons}',
  'split.stalePrd': 'PRD files',
  'split.staleFindings': 'finding dispositions',
  'split.staleUnderstand': 'understanding re-finalized',
  'split.staleClarifications': 'clarification answers changed',
  'split.staleRequirementDoc': 'requirement baseline doc changed',
  'split.stalePlanning': 'the adopted technical planning changed (re-adopted/revoked)',
  'split.stillValid': 'Confirm still valid',
  'split.reSplit': 'Re-split',
  'split.reSplitBlocked': 'A work package has started (in dev / built / accepted) and cannot be re-split — resolve its plans and sessions first.',
  'split.reSplitTitle': 'Re-split',
  'split.reSplitCount': 'The {n} active work packages will all be archived as dropped, the approval stamp cleared, and the list reopened for editing.',
  'split.reSplitAck': 'I confirm I want to archive the current split and start over.',
  'split.reSplitConfirm': 'Archive and re-split',
  'split.droppedSectionTitle': 'Dropped work packages',
  'split.droppedTag': 'Dropped',
  'split.restore': 'Restore',
  'splitProposal.sectionTitle': 'Split proposals (split session)',
  'splitProposal.waiting': 'The split result has not been collected — it lands as pending proposals once the session finishes.',
  'splitProposal.retry': 'Retry collection',
  'splitProposal.adoptSelected': 'Register selected',
  'splitProposal.ignore': 'Ignore',
  'splitProposal.lockedHint': 'The split is approved: registering stays locked until the approval is revoked/re-split; ignoring is unaffected.',
  'splitProposal.proposedTag': 'Proposed',
  'splitResult.title': 'Split result doc',
  'splitResult.missing': 'Split result file not found — the split session has not written it yet, or wrote it elsewhere.',
  'splitResult.noWorkspace': 'No bound workspace — the split-result channel is off; the split plan is delivered in the conversation (no auto-collection).',
  'splitResult.pathPrefix': 'Path: ',
  'splitResult.tampered': 'The doc disagrees with the collection anchor (edited on disk after collection).',
  'splitResult.refresh': 'Refresh',
  'splitResult.preview': 'Preview split result doc',
  'splitResult.loadError': 'Failed to load the split result doc.',
  'wp.addTitle': 'New work package',
  'wp.editTitle': 'Edit work package',
  'wp.titleLabel': 'Title',
  'wp.boundaryLabel': 'Boundary (what it does / does not do)',
  'wp.dependsLabel': 'Depends on',
  'wp.coversLabel': 'Covers criteria',
  'wp.parallelLabel': 'Can run in parallel',
  'wp.parallelTag': 'P parallel',
  'wp.copyBody': 'Copy body',
  'wp.noneMark': '—',
  'wp.removeTitle': 'Remove work package',
  'wp.removeDescription': 'Remove this work package? Dependent references from sibling packages will be stripped along with it.',
  'board.colPlanned': 'To plan',
  'board.colPlanApproved': 'Plan approved',
  'board.colInDev': 'In dev',
  'board.colBuilt': 'To accept',
  'board.colAccepted': 'Accepted',
  'board.lockedHint': 'The execution board appears here once the split is approved (hard gate ① pending).',
  'board.notDrafted': 'No draft',
  'board.drafting': 'Drafting',
  'board.planTag': 'Plan v{n}',
  'board.planMissing': 'Plan file missing',
  'board.declareReady': 'collectable',
  'board.sessions': '{n} sessions',
  'board.viewExecution': 'View execution',
  'board.commits': 'commit {n}',
  'board.progressAccepted': '{n}/{m} accepted',
  'board.progressBuilt': '{n} to accept',
  'board.progressInDev': '{n} in dev',
  'board.progressPlanApproved': '{n} plan approved',
  'board.progressPlanned': '{n} to plan',
  'board.accept': 'Accept',
  'board.reject': 'Reject',
  'board.rejectTitle': 'Acceptance failed',
  'board.rejectReasonLabel': 'Rework reason (required)',
  'board.rejectReasonRequired': 'Fill in the rework reason',
  'board.rejectSubmit': 'Confirm rejection',
  'detail.statusPlanned': 'Registered',
  'detail.statusPlanDraft': 'Drafting plan',
  'detail.statusPlanApproved': 'Plan approved',
  'detail.statusInDev': 'In dev',
  'detail.statusBuilt': 'To accept (completion declared)',
  'detail.statusAccepted': 'Accepted',
  'detail.statusDropped': 'Dropped',
  'detail.contentSection': 'Work package content',
  'detail.planSection': 'Implementation plan',
  'detail.versionCurrent': 'current',
  'detail.versionDraft': 'draft',
  'detail.versionArchived': 'archived',
  'detail.versionApproved': 'approved',
  'detail.noPlans': 'No plan yet: draft one and approve it to unlock the workflow.',
  'detail.planMissing': 'File missing (write interrupted or deleted externally)',
  'detail.planRewrite': 'Retry write',
  'detail.planLoadFailed': 'Failed to load the plan body',
  'detail.tampered': 'Content hash mismatch: the file may have been modified externally — treat the body below as reference only.',
  'detail.draftLabel': 'Draft (saving overwrites the tail version; the version number is assigned by the system)',
  'detail.draftPlaceholder': 'Write the implementation plan in markdown…',
  'detail.draftSave': 'Save draft',
  'detail.sessionsSection': 'Linked sessions',
  'detail.commitsSection': 'Commits',
  'detail.acceptanceSection': 'Acceptance',
  'detail.acceptanceEmpty': 'No acceptance record yet',
  'detail.acceptancePass': 'pass',
  'detail.acceptanceFail': 'fail',
  'rework.title': 'Rework note',
  'rework.send': 'Send rework note',
  'rework.targetLabel': 'Target session',
  'rework.previewLabel': 'Rework note (editable before sending)',
  'rework.sendFailed': 'Send failed — copy it and paste in the session',
  'detail.builtSourceManual': 'Completion can be marked manually; a bound session\'s declare block is auto-collected (see Declaration above) and marks built on import.',
  'detail.returnForEdit': 'Return for edits',
  'detail.approvePlan': 'Approve plan',
  'detail.startWork': 'Start work',
  'detail.markBuilt': 'Mark built (to accept)',
  'detail.reopen': 'Reopen',
  'detail.drop': 'Drop',
  'detail.dropTitle': 'Drop work package',
  'md.copyCode': 'Copy code',
  'md.copiedCode': 'Copied',
  'md.edit': 'Edit',
  'md.footnotes': 'Footnotes',
  'md.preview': 'Preview',
  'detail.dropDescription': 'Drop this work package? Dropped packages leave the board; history is preserved.',
  'detail.devNoPlanAckTitle': 'No approved plan yet',
  'detail.devNoPlanAckBody': 'This work package has no approved plan — delivering the dev SOW now means the session develops from the boundary alone (no approved plan embedded). Consider generating the WP planning SOW first and approving its plan before delivery.',
  'detail.devNoPlanAckConfirm': 'Generate dev SOW anyway',
  'detail.planSeedSource': 'Plan collected from session {id}…',
  'detail.planReseed': 'Re-collect',
  'scan.button': 'Artifact reconciliation',
  'scan.empty': 'none',
  'scan.failed': 'Scan failed (unreadable ledger or network error) — retry with refresh.',
  'scan.kindPlan': 'plan',
  'scan.kindReview': 'review',
  'scan.kindUnknown': 'unknown',
  'scan.loading': 'Scanning…',
  'scan.missing': 'Missing (referenced · file absent)',
  'scan.orphans': 'Orphans (file present · unreferenced)',
  'scan.refresh': 'Refresh',
  'scan.title': 'Artifact reconciliation (read-only)',
  'scan.trash': '.trash (deleted requirements)',
  'session.stateWaiting': 'waiting for input',
  'session.stateRunning': 'running',
  'session.stateIdle': 'idle',
  'session.stateBlank': 'shell session (delivery artifact, not started)',
  'session.stateGone': 'session gone',
  'session.purposeAnalysis': 'analysis',
  'session.purposeDev': 'dev',
  'session.purposeReview': 'review',
  'session.purposeWpPlan': 'wp-plan',
  'session.bindButton': '＋ Bind',
  'session.bindTitle': 'Bind a session',
  'session.pickerHint': 'Pick a session to bind (sessions already bound to this work package are disabled).',
  'session.pickerEmpty': 'The session list is empty.',
  'session.pickerPurposeLabel': 'Purpose',
  'session.pickerSubmit': 'Bind',
  'session.boundAtPrefix': 'bound at',
  'session.sectionTitle': 'Linked sessions',
  'knowledge.candidatesTitle': 'Knowledge candidates',
  'knowledge.candidateDraftPrefix': 'draft:',
  'knowledge.proposedSessionPrefix': 'proposed session:',
  'knowledge.activate': 'Activate',
  'knowledge.edit': 'Edit',
  'knowledge.drop': 'Drop',
  'knowledge.dropTitle': 'Drop knowledge candidate',
  'knowledge.dropDescription': 'Drop this candidate? It leaves the review queue for good.',
  'knowledge.activateTitle': 'Activate knowledge entry',
  'knowledge.scopeLabel': 'Scope',
  'knowledge.scopeGlobal': 'Global (injected everywhere)',
  'knowledge.scopeRequirement': 'This requirement only',
  'knowledge.scopeWorkspace': 'Workspace (injected for requirements bound to it)',
  'knowledge.metaWorkspace': 'scope workspace ·',
  'knowledge.pathLabel': 'Workspace path (ownership key)',
  'knowledge.globLabel': 'Path glob (e.g. src/**)',
  'knowledge.triggerPath': 'path (inject on path hit)',
  'knowledge.exportButton': 'Export',
  'knowledge.exportOne': 'Export this row',
  'knowledge.exportTitle': 'Knowledge export',
  'knowledge.typeLabel': 'Type',
  'knowledge.typeBusiness': 'business (domain knowledge)',
  'knowledge.typeConvention': 'convention (engineering convention)',
  'knowledge.triggerLabel': 'Trigger',
  'knowledge.triggerAlways': 'always (always injected)',
  'knowledge.triggerKeyword': 'keyword (title/boundary match)',
  'knowledge.triggerManual': 'manual (explicit pick only)',
  'knowledge.keywordLabel': 'Keyword (required)',
  'knowledge.activeTitle': 'Activated knowledge (relevant here)',
  'knowledge.metaRequirement': 'scope this requirement',
  'knowledge.metaGlobal': 'scope global',
  'knowledge.activatedAtPrefix': 'activated',
  'knowledge.archive': 'Archive',
  'knowledge.archiveTitle': 'Archive knowledge entry',
  'knowledge.archiveDescription': 'Archive? Archiving is irreversible (no restore in P2).',
  'knowledge.add': '＋ Add entry',
  'knowledge.formTitleNew': 'New knowledge entry',
  'knowledge.formTitleEdit': 'Edit knowledge entry',
  'knowledge.titleLabel': 'Title',
  'knowledge.contentLabel': 'Content (markdown)',
  'knowledge.emptyCandidates': 'No candidates awaiting review.',
  'knowledge.emptyActive': 'No activated knowledge yet.',
  'knowledge.loadError': 'Failed to load the knowledge base.',
  'knowledge.statSessions': 'linked sessions',
  'knowledge.statFindings': 'findings resolved',
  'knowledge.statRework': 'rework count',
  'knowledge.statCycleDays': 'cycle (days)',
  'sow.analysisButton': 'Generate analysis SOW',
  'sow.planButton': 'Generate planning SOW',
  'sow.splitButton': 'Generate split SOW',
  'sow.reviewButton': 'Generate review SOW',
  'sow.workPackageButton': 'Generate work-package SOW',
  'sow.wpPlanButton': 'Generate WP planning SOW',
  'sow.title': 'Generate statement of work',
  'sow.knowledgeHit': 'matched {n} · {size} / cap {cap}',
  'sow.knowledgeEmpty': 'No matching knowledge entries.',
  'sow.knowledgeOverLimit': 'Over the injection cap ({entries} entries / {size}): uncheck some rows.',
  'sow.wpGroup': 'Work-package scope',
  'sow.wpBoundaryPlan': 'Boundary + approved plan',
  'sow.wpDeps': 'Dependency summaries',
  'sow.wpNoApprovedPlan': '(no approved plan yet — boundary only)',
  'sow.deliver': 'Deliver & send',
  'sow.deliverFailed': 'Delivery failed: copy and paste manually.',
  'sow.copy': 'Copy to clipboard',
  'sow.copied': 'Copied',
  'sow.copyFailed': 'Copy refused: select the preview text and copy manually.',
  'sow.resetEdit': 'Restore generated text',
  // release.* — S5 delivery sheet (P3a)
  'release.sectionTitle': 'Release sheet',
  'release.add': '＋ Register',
  'release.exportButton': 'Export release sheet',
  'release.empty': 'No release items yet. Register the SQL / config / flag / MQ changes produced during development here so nothing is missed at release time.',
  'release.gonogoGo': 'GO',
  'release.gonogoNoGo': 'Preconditions unmet',
  'release.gonogoPending': 'Pending {n}',
  'release.gonogoConfirmed': 'Confirmed {n}',
  'release.gonogoDrift': 'Drifted {n}',
  'release.rollbackPlanPrefix': 'Rollback plan',
  'release.rollbackConfirmedShort': 'confirmed',
  'release.rollbackMissingShort': 'unconfirmed',
  'release.confirmRollbackPlan': 'Confirm rollback plan',
  'release.revokeRollbackPlan': 'Revoke',
  'release.rollbackPlanTitle': 'Confirm the rollback plan',
  'release.rollbackPlanDescription': 'Confirm that rollback plans are prepared for every change in this release (rollback scripts / revert parameters / window plans). This is the third go/no-go condition.',
  'release.rollbackRevokeTitle': 'Revoke the confirmation',
  'release.rollbackRevokeDescription': 'After revoking, go/no-go falls back to "preconditions unmet".',
  'release.group.sql': 'SQL',
  'release.group.config': 'Config',
  'release.group.flag': 'Feature flag',
  'release.group.mq': 'MQ',
  'release.group.other': 'Other',
  'release.status.pending': 'Pending',
  'release.status.confirmed': 'Confirmed',
  'release.status.applied': 'Applied',
  'release.status.verified': 'Verified',
  'release.status.rolled-back': 'Rolled back',
  'release.menuConfirm': 'Confirm onto the sheet',
  'release.menuApplied': 'Mark applied',
  'release.menuVerified': 'Mark verified',
  'release.menuRollback': 'Roll back',
  'release.removeTitle': 'Remove the release item',
  'release.removeDescription': 'This item has not been confirmed onto the sheet yet; removal is permanent.',
  'release.rollbackTitle': 'Roll back the release item',
  'release.rollbackDescription': 'Rollback is terminal: the change is marked as not shipping with this release (or already removed from the environment); the item stays on the sheet as an audit trail.',
  'release.driftNote': 'Content edited outside the workbench (hash mismatch)',
  'release.lockedHint': 'Content locked read-only · to amend: register a new item and roll this one back',
  'release.sourcePrefix': 'Source',
  'release.appliedAtPrefix': 'Applied',
  'release.formTitleNew': 'Register a release item',
  'release.formTitleEdit': 'Edit the release item',
  'release.typeLabel': 'Type',
  'release.titleLabel': 'Title',
  'release.contentLabel': 'Content (SQL / config value)',
  'release.envsLabel': 'Environments (comma-separated, e.g. prod,pre)',
  'release.envsInvalid': 'Environment names must be 1–64 characters',
  'release.workPackageLabel': 'Owning work package',
  'release.workPackageNone': '(none)',
  'release.noteLabel': 'Note',
  'release.titleRequired': 'Title is required',
  'release.contentRequired': 'Content is required',
  // sheet.* — release sheet export modal
  'sheet.title': 'Release sheet',
  'sheet.copy': 'Copy to clipboard',
  'sheet.copied': 'Copied',
  'sheet.copyFailed': 'Copy refused: select the preview text and copy manually.',
  'sheet.download': 'Download as file',
  'sheet.downloaded': 'Downloaded',
  'sheet.downloadFailed': 'Download failed: use copy instead.',
  // declare.* — declare-block import (P3b)
  'declare.importButton': 'Import declare',
  'declare.title': 'Import declare block',
  'declare.sessionLabel': 'Fetch from a session',
  'declare.sessionPlaceholder': 'Select a session…',
  'declare.fetchButton': 'Fetch',
  'declare.fetchNoService': 'The host does not mount the session-read service — paste the declare text manually.',
  'declare.fetchNotFound': 'The session does not exist or has been cleaned up.',
  'declare.fetchUnreadable': 'Failed to read the session log.',
  'declare.fetchNoBlock': 'No # skyaxis-declare block in this session\'s assistant messages.',
  'declare.noSessions': 'No fetchable sessions in this workspace (blank never-ran shells excluded); pasting always works.',
  'declare.textLabel': 'Declare text (fetched or pasted)',
  'declare.parseButton': 'Parse preview',
  'declare.blockNoBlock': 'No # skyaxis-declare block in the text.',
  'declare.blockYamlSyntax': 'Declare-block YAML syntax error (near line {n}) — fix it and retry.',
  'declare.empty': 'The declare block carries no importable rows.',
  'declare.groupBuilt': 'built claims',
  'declare.groupArtifacts': 'Release items',
  'declare.groupKnowledge': 'Knowledge candidates',
  'declare.stageReadyProposal': 'The AI proposes this stage is ready — advancing stays with you; the workbench never advances it.',
  'declare.duplicateHint': 'Duplicates an existing row — unchecked by default',
  'declare.skippedTitle': 'Rows not imported',
  'declare.importSubmit': 'Import',
  'declare.doneTitle': 'Import complete',
  'declare.doneCounts': 'built {b} · release items {a} · knowledge {k} · skipped {s}',
  'declare.staleHint': 'The preview is stale (the ledger changed after it) — re-parse.',
  'declare.textChangedHint': 'The session text changed since collection (it disagrees with the anchored content) — re-fetch is advised; import only after verifying.',
  // 0016 P2a: evidence advisory
  'declare.evidenceSummary': '📋 Summary: ',
  'declare.evidenceFiles': '📁 Files changed',
  'declare.evidenceVerification': '✅ Verification evidence',
  'declare.noEvidenceHint': '⚠️ No verification evidence attached — a completion claim is not evidence; review evidence before accepting.',
  'declare.completionNotEvidence': 'A completion claim is not evidence — check verification and the workspace before accepting.',
  'advance.unacceptedCount': '{n} unaccepted',
  'declare.reparseButton': 'Re-parse',
  'declare.miss.noService': 'The host does not mount the session-read service — import manually from S5.',
  'declare.miss.notFound': 'The bound session is gone — rebind or paste manually.',
  'declare.miss.unreadable': 'Failed to read the session log — retry later or paste.',
  'declare.miss.noDeclareBlock': 'The session has not emitted a declare block yet (likely unfinished) — retry once done.',
  'declare.miss.noBinding': 'No task-book session found for this package — deliver and send the SOW first, or bind the real session manually.',
  'declare.miss.wpNotInDev': 'The package is not in dev (not started or already done) — collect after starting it.',
  'declare.miss.wpMismatch': 'The declare block names a different package — not collected.',
  // declareCard.* — 0016 P1a declaration collection card
  'declareCard.commitsTitle': 'Commits (AI-reported, unverified)',
  'declareCard.commitConfirmed': 'Confirmed',
  'declareCard.commitUnverified': 'Unverified',
  'declareCard.commitConfirm': 'Confirm',
  'declareCard.sectionTitle': 'Declaration',
  'declareCard.pendingTitle': 'AI completion declaration awaiting review (from session {s} · collected {at})',
  'declareCard.importButton': 'Import declaration',
  'declareCard.dismissButton': 'Dismiss',
  'declareCard.retryButton': 'Re-collect',
  'declareCard.importedLine': 'Declaration imported · round {n} · {at}',
  'declareCard.needInDevHint': 'The package has not started development yet — start it first to import (marks built).',
  'declareCard.dismissedLine': 'Declaration dismissed · {at}',
  'declare.skip.bad-shape': 'malformed row',
  'declare.skip.bad-type': 'type outside the allowed enum',
  'declare.skip.bad-severity': 'severity outside high|medium|low',
  'declare.skip.bad-title': 'title missing or over 64 chars',
  'declare.skip.bad-content': 'content missing',
  'declare.skip.over-cap': 'content over the 32K cap',
  'declare.skip.bad-envs': 'invalid environment list',
  'declare.skip.wp-not-found': 'work package not found',
  'declare.skip.wp-not-in-dev': 'not markable as built (split unapproved or package not in dev)',
  // execution.* — 0016 P1b execution view
  'execution.archiveTitle': 'Execution archive',
  'execution.backToBoard': 'Back to board',
  'execution.filesChanged': '{n} files changed',
  'execution.jumpToSession': 'Jump to session',
  'execution.liveRunning': 'Running',
  'execution.liveTitle': 'Live view',
  'execution.loadError': 'Failed to read the session log.',
  'execution.minutes': '{n} min',
  'execution.model': '{m}',
  'execution.noSession': 'No dev session bound yet — visible after delivering a SOW.',
  'execution.queued': '{n} queued',
  'execution.tokens': '{n} tokens',
  'execution.turnN': '—— Turn {n} ——',
  'execution.waitingForYou': 'Waiting for you',
  // inbox.* — 0016 P1c inbox section
  'inbox.groupPending': 'Pending send',
  'inbox.groupStuck': 'Stuck',
  'inbox.jumpToSession': 'Jump',
  'inbox.openDetail': 'Detail',
  'inbox.pendingSend': 'Pending send',
  'inbox.sectionTitle': 'Needs you',
  'inbox.stuckGone': 'Session gone',
  'inbox.stuckIdle': 'Idle, nothing collected',
  'inbox.stuckNoBinding': 'No dev binding',
  // review.* — S4 review view (P4)
  'review.sectionTitle': 'Review reports',
  'review.importButton': '＋ Import report',
  'review.empty': 'No review reports yet. Have the AI finish its review, then paste the report markdown here.',
  'review.counts': 'Findings {n} · confirmed {c} / rejected {r}',
  'review.verdictsTitle': 'Adjudication',
  'review.verdictsEmpty': 'No verdict rows yet — import a report, then add findings one by one and adjudicate.',
  'review.addVerdict': '＋ Add finding',
  'review.matrixTitle': 'Acceptance verification matrix',
  'review.stripChecks': 'Checks {s} satisfied / {u} unmet / {v} not verifiable / {w} not checked',
  'review.matrixSummary': 'Disposed {n}/{m} · holes {k}',
  'review.matrixDone': 'Complete',
  'review.matrixUndone': 'Incomplete',
  'review.holeChip': '← hole',
  'review.importTitle': 'Import a review report',
  'review.reportTitleLabel': 'Report title (optional)',
  'review.bodyLabel': 'Report body (markdown)',
  'review.detailTitle': 'Review report',
  'review.verdictAddTitle': 'Add a finding',
  'review.verdictEditTitle': 'Edit the verdict',
  'review.verdictTitleLabel': 'Title',
  'review.verdictLabel': 'Verdict',
  'review.verdictConfirmed': 'confirmed',
  'review.verdictRejected': 'rejected',
  'review.verdictPending': 'Pending (AI proposed)',
  'review.dispositionLabel': 'Disposition (confirmed only)',
  'review.disposition.to-fix': 'To fix',
  'review.disposition.fixed': 'Fixed',
  'review.disposition.wont-fix': "Won't fix",
  'review.noteLabel': 'Note (required when rejected)',
  'review.noteRequired': 'A rejection requires its reason',
  'review.removeVerdictTitle': 'Remove the verdict row',
  'review.removeVerdictDescription': 'The row is removed from its report.',
  'review.removeReportTitle': 'Remove the review report',
  'review.removeReportDescription': 'The entry leaves the list; the body file stays in the artifacts directory (a scan-visible orphan).',
  'review.fileMissing': 'Report body file missing (interrupted write or externally deleted).',
  'review.sessionLabel': 'Fetch from a session',
  'review.sessionPlaceholder': 'Select a session…',
  'review.fetchButton': 'Fetch',
  'review.fetchNoService': 'The host does not mount the session-read service — paste the report body manually.',
  'review.fetchNotFound': 'The session does not exist or has been cleaned up.',
  'review.fetchUnreadable': 'Failed to read the session log.',
  'review.fetchNoBlock': 'No # skyaxis-review block in this session\'s assistant messages (it can still import as a plain report).',
  'review.noSessions': 'No fetchable sessions in this workspace (blank never-ran shells excluded); pasting always works.',
  'review.seededCount': 'Imported — {n} verdict row(s) seeded as proposed (adjudicate each one).',
  'review.seededWithBlockError': 'Report imported, but no # skyaxis-review block parsed (missing or malformed) — {n} verdict row(s) seeded.',
  'review.checkSatisfied': 'satisfied',
  'review.checkUnmet': 'unmet',
  'review.checkNotVerifiable': 'not verifiable',
  'review.unchecked': 'not checked',
  'review.checksCount': 'Checks {s} satisfied / {u} unmet / {v} not verifiable',
  'review.checkEvidence': 'Evidence',
  'review.seededChecks': '{n} criteria check(s) seeded',
  'knowledge.candidateAdd': '＋ Distill',
  'knowledge.candidateAddTitle': 'Distill a knowledge candidate',
}

export function registerWorkbenchDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(WORKBENCH_LOCALE_NS, { zh, en }),
    'skyaxis.workbench: dictionaries',
  )
}

export const workbenchZh = zh
export const workbenchEn = en
