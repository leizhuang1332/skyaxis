/**
 * AI 工作台 tab seat（0006 骨架轮）：六阶段导轨 + 各阶段空态提示。
 *
 * 本轮只有「观看」没有「账本」——research 0006 §6.4 的 src/client/workbench/
 * 落点（fetcher/store/controller/两账本/host endpoint）属 P1 数据面；数据面
 * 未立前 seat 沿用 requirements 模块内的 detail-tabs 工厂体系（workspace-tab
 * 同构），P1 落地时再迁出并由 workbench 自己的 register.tsx 注入。
 *
 * 诚实口径（research 0006 §4.4 + docs/dist/06 指标诚实纪律）：无账本 ⇒
 * ① 阶段徽章计数一律不渲染（「数据缺失时隐藏不占位」），绝不填演示数字；
 * ② `[完成本阶段 →]` 推进按钮不渲染——stage/stageHistory 无处落盘，渲染一个
 * 点了没反应的按钮就是假交互；③ 各阶段内容 = guideSection 提示块（说明该阶段
 * 将承载什么），不用 setupCard 虚线动作卡——动作卡整卡即按钮，本轮无可执行动作。
 *
 * 保留下来的是零副作用的部分：点击 chip 切换观看（§4.1「观看与推进分离」的
 * 观看侧），纯组件内 state，与 requirement-form / workspace-tab 的
 * tab-internal state 同口径（短生命周期、无外部读者）。
 */
import { Fragment, useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementRecord } from '../../requirements-shared/protocol.js'
import type { RequirementsT } from './dictionary.js'
import styles from './view.module.css'

/**
 * 六阶段（验证并入执行实施，§4 形态裁决 ②）。顺序即导轨顺序，也是默认观看
 * 起点（§4.4「首用当前阶段 = ①」）。
 */
export const WORKBENCH_STAGES = [
  'understand',
  'plan',
  'implement',
  'review',
  'deliver',
  'retro',
] as const

export type WorkbenchStage = (typeof WORKBENCH_STAGES)[number]

/** 阶段名与空态提示的词典键（两处 map 同形，便于逐阶段填充内容时对齐）。 */
const STAGE_LABEL_KEY: Record<WorkbenchStage, Parameters<RequirementsT>[0]> = {
  understand: 'workbench.stage.understand',
  plan: 'workbench.stage.plan',
  implement: 'workbench.stage.implement',
  review: 'workbench.stage.review',
  deliver: 'workbench.stage.deliver',
  retro: 'workbench.stage.retro',
}

const STAGE_HINT_KEY: Record<WorkbenchStage, Parameters<RequirementsT>[0]> = {
  understand: 'workbench.stageHint.understand',
  plan: 'workbench.stageHint.plan',
  implement: 'workbench.stageHint.implement',
  review: 'workbench.stageHint.review',
  deliver: 'workbench.stageHint.deliver',
  retro: 'workbench.stageHint.retro',
}

export function AiWorkbenchTabBody(props: {
  t: RequirementsT
  requirement: RequirementRecord
}): ReactNode {
  const { t } = props
  const [viewing, setViewing] = useState<WorkbenchStage>('understand')

  return (
    <div className={styles.workbenchTab}>
      {/* 导轨与详情页 header 的 tab 行同为 role=tablist，故用 aria-label 区分
          两层（外层是功能位切换，内层是阶段观看切换）。sticky 的负 margin 抵消
          .body 的 16px padding（mockup .stageRail 同法）。 */}
      <div className={styles.stageRail} role="tablist" aria-label={t('workbench.railLabel')}>
        {WORKBENCH_STAGES.map((stage, index) => (
          <Fragment key={stage}>
            {/* 连接线也是 rail 的直接子元素（mockup .stageConnector 同构），
                这样 6px gap 在 chip 与线之间保持一致。 */}
            {index > 0 ? <span className={styles.stageConnector} aria-hidden="true" /> : null}
            <button
              type="button"
              role="tab"
              aria-selected={stage === viewing}
              className={stage === viewing
                ? `${styles.stageChip} ${styles.stageChipCurrent}`
                : styles.stageChip}
              onClick={() => { setViewing(stage) }}
            >
              {t(STAGE_LABEL_KEY[stage])}
            </button>
          </Fragment>
        ))}
      </div>

      {/* 当前观看阶段的内容位。空态给「下一步动作」文案（§4.4），不留死白。 */}
      <div className={styles.stageView} role="tabpanel" aria-label={t(STAGE_LABEL_KEY[viewing])}>
        <div className={styles.guideSection}>
          <div className={styles.guideTitle}>{t(STAGE_LABEL_KEY[viewing])}</div>
          <div className={styles.guideHint}>{t(STAGE_HINT_KEY[viewing])}</div>
        </div>
      </div>
    </div>
  )
}

/** Seat wiring for detail-tabs.tsx (owner prop = live record; t via closure). */
export function createAiWorkbenchTabSeat(options: {
  t: RequirementsT
}): (props: PropsRuntime<'requirements.detail.view'>) => ReactNode {
  return (props) => <AiWorkbenchTabBody t={options.t} requirement={props.requirement} />
}
