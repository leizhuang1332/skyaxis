// @vitest-environment jsdom
/**
 * Repos-pool P1 view rendering — the real components against jsdom, with the
 * real ui-primitives icon (its render is also the PoC-4 runtime-import
 * evidence). Style assertions check the CSS Modules class wiring only; token
 * correctness (alias-only values) is enforced by review of view.module.css.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReposPoolIcon, ReposPoolPage } from '../../src/client/repos-pool/view.js'
import { REPOS_POOL_LOCALE_NS, type ReposPoolT } from '../../src/client/repos-pool/dictionary.js'

const DICT = {
  zh: { 'panel.title': '仓库池', 'page.empty': '尚未添加任何仓库。仓库清单管理将在下一阶段就绪。' },
  en: { 'panel.title': 'Repos Pool', 'page.empty': 'No repositories yet. Repository management arrives in the next phase.' },
} as const

function bindTo(locale: 'zh' | 'en'): ReposPoolT {
  return (key) => DICT[locale][key]
}

describe('ReposPoolPage', () => {
  it('renders heading and empty-state copy in zh', () => {
    const { container, unmount } = render(<ReposPoolPage t={bindTo('zh')} />)
    expect(screen.getByRole('heading', { name: '仓库池' })).toBeTruthy()
    expect(screen.getByText(DICT.zh['page.empty'])).toBeTruthy()
    // CSS Modules wiring: the skeleton carries a non-empty hashed class.
    const section = container.querySelector('section')
    expect(section?.className.trim().length ?? 0).toBeGreaterThan(0)
    unmount()
  })

  it('renders en copy from the same components (no re-registration concept at view level)', () => {
    const { unmount } = render(<ReposPoolPage t={bindTo('en')} />)
    expect(screen.getByRole('heading', { name: 'Repos Pool' })).toBeTruthy()
    expect(screen.getByText(DICT.en['page.empty'])).toBeTruthy()
    unmount()
  })
})

describe('ReposPoolIcon', () => {
  it('draws the real ui-primitives glyph at the wide-mode size (16)', () => {
    const { container, unmount } = render(<ReposPoolIcon size={16} active={false} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('width')).toBe('16')
    unmount()
  })

  it('draws at the rail size (18) when the host shell requests it', () => {
    const { container, unmount } = render(<ReposPoolIcon size={18} active />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('18')
    unmount()
  })
})
