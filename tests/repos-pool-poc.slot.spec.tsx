// @vitest-environment jsdom
/**
 * PoC-5：双槽成对注册（main keyed + sidebar.panellist）最小闭环（发布包可达面）
 *
 * 调研落地的实测边界（如实记录，影响 P1 测试策略）：
 *  - 宿主官方 SlotTestRuntime（dsh-client-test-runtime）发布版深度 import renderer 的
 *    src/*.ts 与多个浏览器工厂入口，在 DSH monorepo 之外无法解析——它是 monorepo 内部工具。
 *  - 浏览器工厂 bundle（ui-renderer/client、ui-sidebar/client、locale/client）是无 export
 *    语句的 window.__ModuleLoader__ 闭包，jsdom 无法静态导入——完整宿主外壳（PanelRow
 *    chrome、syncPanels）只能实机验证（已列入 P1 验收清单）。
 *  - 发布包可达面：ui-slots '.' 含真 SlotCore（注册表核心）+ resolveSlotLabel（生产
 *    label 解析器）；ui-primitives '.' 为标准 ESM React 组件（vite/jsdom 可渲染）。
 *
 * 本测试在可达面上验证：
 *  A. 真 SlotCore：root children 声明 → 仓库池双槽注册（与生产 register.tsx 同形）→
 *     {id, order, label} 投影、resolveSlotLabel 双语解析、keyed cell 共存、dispose 撤下。
 *  B. RTL 渲染仓库池页面组件（真 ui-primitives Button/图标）——兼作 PoC-4 的运行时导入证明。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SlotCore, resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconDatabaseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'main': { kind: 'keyed'; scope: 'root' }
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: { size: number; active: boolean } }
  }
  interface LocaleNamespaceMap {
    'skyaxis.repos-pool': 'panelTitle'
  }
}

const REPOS_POOL = 'repos-pool'
const DICT = { zh: { panelTitle: '仓库池' }, en: { panelTitle: 'repos pool' } }

function bindLocale() {
  let current: 'zh' | 'en' = 'en'
  return {
    setLocale(id: 'zh' | 'en') { current = id },
    t(key: 'panelTitle') { return DICT[current][key] },
  }
}

/** 被测：仓库池页面组件（P1 view.tsx 雏形；真 ui-primitives 组件）。 */
function ReposPoolPage({ t }: { t: (key: 'panelTitle') => string }) {
  return (
    <section>
      <h1>{t('panelTitle')}</h1>
      <Button variant="primary" onClick={() => {}}>{`${t('panelTitle')}: add`}</Button>
    </section>
  )
}

/** 被测：panellist 图标组件（owner props 契约经 PropsRuntime；真 ui-primitives 图标）。 */
function ReposPoolIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <span data-testid="repos-pool-icon" data-active={String(active)}>
      <IconDatabaseOutline16 size={size} />
    </span>
  )
}

describe('PoC-5A: 真 SlotCore 注册表契约（双槽成对注册）', () => {
  it('root 声明后双槽注册成功，投影/双语解析/keyed 共存正确', () => {
    const locale = bindLocale()
    const core = new SlotCore()

    // 宿主基座：root frame 声明 main(keyed) 与 sidebar.panellist(list)。
    // RendersCheck 契约：声明 children 的组件必须在类型上消费对应 renderSlot。
    const frame = (_props: PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>): ReactNode => null
    core.register({ name: 'root', children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root', owner: { size: 'number', active: 'boolean' } },
    } }, frame)
    const disposeConversation = core.register(
      { name: 'main', key: 'conversation' },
      () => <p>Conversation content</p> as ReactNode,
    )

    // 被测：仓库池双槽注册（id === key 硬约束的两侧）
    const disposePage = core.register(
      { name: 'main', key: REPOS_POOL },
      () => <ReposPoolPage t={locale.t} /> as ReactNode,
    )
    const disposePanel = core.register(
      { name: 'sidebar.panellist', id: REPOS_POOL, order: 40, label: () => locale.t('panelTitle') },
      (props: PropsRuntime<'sidebar.panellist'>) => ReposPoolIcon(props) as ReactNode,
    )

    // panellist 投影：{id, order, label}
    const panelEntries = core.entriesOfSlot('sidebar.panellist')
    expect(panelEntries).toHaveLength(1)
    expect(panelEntries[0].options.id).toBe(REPOS_POOL)
    expect(panelEntries[0].options.order).toBe(40)
    // 生产解析器 resolveSlotLabel：thunk 即时求值（thunk 内部读当前 locale，免重注册切换）
    expect(resolveSlotLabel(panelEntries[0].options.label)).toBe('repos pool')
    locale.setLocale('zh')
    expect(resolveSlotLabel(panelEntries[0].options.label)).toBe('仓库池')
    locale.setLocale('en')

    // main keyed：conversation 与 repos-pool 共存（不同 key 各占一 cell）
    const mainKeys = core.entriesOfSlot('main').map((e) => e.options.key)
    expect(mainKeys.filter((k) => k === 'conversation')).toHaveLength(1)
    expect(mainKeys.filter((k) => k === REPOS_POOL)).toHaveLength(1)

    // dispose：页面注册撤下后 main 只剩 conversation；panellist 撤下后为空
    disposePage()
    expect(core.entriesOfSlot('main').map((e) => e.options.key)).toEqual(['conversation'])
    disposePanel()
    expect(core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
    disposeConversation()
    expect(core.entriesOfSlot('main')).toHaveLength(0)
  })

  it('未声明槽位注册直接失败（fail-loud 契约）', () => {
    const core = new SlotCore()
    expect(() => core.register({ name: 'sidebar.panellist', id: 'x' }, () => null as ReactNode))
      .toThrow(/not declared/)
  })
})

describe('PoC-5B: 仓库池页面组件渲染（真 ui-primitives）', () => {
  it('页面与图标按 locale 渲染，Button 来自宿主组件库', () => {
    const locale = bindLocale()
    const { container, unmount } = render(<ReposPoolPage t={locale.t} />)
    expect(screen.getByRole('heading', { name: 'repos pool' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'repos pool: add' })).toBeTruthy()
    // ui-primitives 组件真实渲染（非 stub）：Button 输出 button 元素
    expect(container.querySelectorAll('button')).toHaveLength(1)

    locale.setLocale('zh')
    unmount()
    render(<ReposPoolIcon size={16} active />)
    const icon = screen.getByTestId('repos-pool-icon')
    expect(icon.getAttribute('data-active')).toBe('true')
    expect(icon.querySelector('svg')).toBeTruthy() // 16px glyph 真实存在
  })
})
