// @vitest-environment jsdom
/**
 * AI 工作台 tab seat（0006 骨架轮）：六阶段导轨的顺序与默认观看起点、点击
 * chip 切换观看（内容位随之换），以及本轮的诚实口径守卫——无账本 ⇒ 徽章计数
 * 与「完成本阶段 →」推进按钮一律不渲染。后两条是防回归的钉子：P1 数据面未立
 * 前，任何演示数字或点了没反应的推进按钮都是假交互（docs/dist/06 指标诚实
 * 纪律 + research 0006 §4.4）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import {
  AiWorkbenchTabBody,
  WORKBENCH_STAGES,
  createAiWorkbenchTabSeat,
} from '../../src/client/requirements/ai-workbench-tab.js'

const DICT = {
  zh: {
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
  },
} as const

const bindZh = (): RequirementsT => (key) => (DICT.zh as Record<string, string>)[key] ?? key

const record: RequirementRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '报价管理：导入导出与数据校验',
  description: '既有说明',
  workspacePath: '/ws',
  linkedRepos: [],
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效；screen 查的是全局 document，
// 不显式清理会让后一个用例看见前一个用例的 DOM（0003 P2 记录过的同类坑）。
afterEach(() => {
  cleanup()
})

describe('AiWorkbenchTabBody（0006 六阶段导轨骨架）', () => {
  it('renders the six stages in pipeline order; the first stage is the viewing start', () => {
    render(<AiWorkbenchTabBody t={bindZh()} requirement={record} />)

    // 导轨与详情页 header 的 tab 行同为 role=tablist，靠 aria-label 区分两层。
    const rail = screen.getByRole('tablist', { name: '工作流阶段' })
    expect(rail).toBeTruthy()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(WORKBENCH_STAGES.length)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '① 需求理解', '② 探索规划', '③ 执行实施', '④ 评审', '⑤ 交付', '⑥ 沉淀',
    ])
    // 默认观看起点 = ①（§4.4 首用）。
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs.slice(1).every((tab) => tab.getAttribute('aria-selected') === 'false')).toBe(true)
  })

  it('clicking a chip switches the viewing stage and swaps the content pane', () => {
    render(<AiWorkbenchTabBody t={bindZh()} requirement={record} />)

    const panel = () => screen.getByRole('tabpanel')
    expect(panel().textContent).toContain(DICT.zh['workbench.stageHint.understand'])

    fireEvent.click(screen.getByRole('tab', { name: '③ 执行实施' }))
    expect(screen.getByRole('tab', { name: '③ 执行实施' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '① 需求理解' }).getAttribute('aria-selected')).toBe('false')
    expect(panel().textContent).toContain(DICT.zh['workbench.stageHint.implement'])
    expect(panel().textContent).not.toContain(DICT.zh['workbench.stageHint.understand'])

    // 观看是自由的（§4.1）：可回退、可跳到任意阶段。
    fireEvent.click(screen.getByRole('tab', { name: '⑥ 沉淀' }))
    expect(panel().textContent).toContain(DICT.zh['workbench.stageHint.retro'])
    fireEvent.click(screen.getByRole('tab', { name: '② 探索规划' }))
    expect(panel().textContent).toContain(DICT.zh['workbench.stageHint.plan'])
  })

  // 诚实口径守卫：本轮无账本 ⇒ 无计数、无推进。P1 数据面落地后这两条应随
  // 真实数据源一起改写（而不是先塞演示数字让测试变绿）。
  it('renders no badge counts and no stage-advance control while there is no ledger', () => {
    render(<AiWorkbenchTabBody t={bindZh()} requirement={record} />)

    const rail = screen.getByRole('tablist', { name: '工作流阶段' })
    // 导轨内只有六个 chip：连接线是 aria-hidden 的 span，不产生可交互节点。
    expect(rail.querySelectorAll('button')).toHaveLength(WORKBENCH_STAGES.length)
    expect(rail.querySelectorAll('[aria-hidden="true"]')).toHaveLength(WORKBENCH_STAGES.length - 1)

    // 徽章计数无处可算 ⇒ 不渲染（§4.4「数据缺失时隐藏不占位」）。
    expect(screen.queryByText(/\d+\s*待处置/)).toBeNull()
    expect(screen.queryByText(/待验收|待确认|候选/)).toBeNull()
    // 推进无处落盘 ⇒ 不渲染（点了没反应的按钮就是假交互）。
    expect(screen.queryByText(/完成本阶段/)).toBeNull()
    // 全 seat 内唯一的可交互节点就是六个阶段 chip（chip 的 role 被显式设为
    // tab，故 button 角色下为空）——推进/登记/导出等动作入口一个都没有。
    expect(screen.getAllByRole('tab')).toHaveLength(WORKBENCH_STAGES.length)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('the seat factory carries the live record as the owner prop', () => {
    // detail-tabs.tsx 的工厂契约：t 走注册闭包，owner 只携带运行时 requirement
    // （PropsRuntime<'requirements.detail.view'> = { requirement }，无 renderSlot）。
    const Seat = createAiWorkbenchTabSeat({ t: bindZh() })
    render(<Seat requirement={record} />)
    expect(screen.getAllByRole('tab')).toHaveLength(WORKBENCH_STAGES.length)
    expect(screen.getByRole('tab', { name: '① 需求理解' }).getAttribute('aria-selected')).toBe('true')
  })
})
