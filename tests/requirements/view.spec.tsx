// @vitest-environment jsdom
/**
 * Requirements P1 view rendering — the real components against jsdom, with
 * the real ui-primitives icon. Style assertions check the CSS Modules class
 * wiring only; token correctness (alias-only values) is enforced by review
 * of view.module.css.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RequirementsIcon, RequirementsPage } from '../../src/client/requirements/view.js'
import { REQUIREMENTS_LOCALE_NS, type RequirementsT } from '../../src/client/requirements/dictionary.js'

const DICT = {
  zh: { 'panel.title': '需求管理', 'page.empty': '暂无需求。需求管理将在下一阶段就绪。' },
  en: { 'panel.title': 'Requirements', 'page.empty': 'No requirements yet. Requirement management arrives in the next phase.' },
} as const

function bindTo(locale: 'zh' | 'en'): RequirementsT {
  return (key) => DICT[locale][key]
}

describe('RequirementsPage', () => {
  it('renders heading and empty-state copy in zh', () => {
    const { container, unmount } = render(<RequirementsPage t={bindTo('zh')} />)
    expect(screen.getByRole('heading', { name: '需求管理' })).toBeTruthy()
    expect(screen.getByText(DICT.zh['page.empty'])).toBeTruthy()
    // CSS Modules wiring: the skeleton carries a non-empty hashed class.
    const section = container.querySelector('section')
    expect(section?.className.trim().length ?? 0).toBeGreaterThan(0)
    unmount()
  })

  it('renders en copy from the same components (no re-registration concept at view level)', () => {
    const { unmount } = render(<RequirementsPage t={bindTo('en')} />)
    expect(screen.getByRole('heading', { name: 'Requirements' })).toBeTruthy()
    expect(screen.getByText(DICT.en['page.empty'])).toBeTruthy()
    unmount()
  })
})

describe('RequirementsIcon', () => {
  it('draws the real ui-primitives glyph at the wide-mode size (16)', () => {
    const { container, unmount } = render(<RequirementsIcon size={16} active={false} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('width')).toBe('16')
    unmount()
  })

  it('draws at the rail size (18) when the host shell requests it', () => {
    const { container, unmount } = render(<RequirementsIcon size={18} active />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('18')
    unmount()
  })
})
