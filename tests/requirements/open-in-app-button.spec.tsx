// @vitest-environment jsdom
/**
 * Open-in-app split button (0014): the degradation ladder (unanswered →
 * nothing, answered-empty → caller fallback, nameable → split), the menu's
 * nameability filter, the remembered-choice main click, and the launch error
 * dress. The controller face is a store-backed fake — the wire contract has
 * its own suite in open-in-app-controller.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { OpenInAppButton } from '../../src/client/requirements/open-in-app-button.js'
import type { OpenInAppFace } from '../../src/client/requirements/open-in-app-controller.js'

const DICT = {
  'workspace.openInApp': '在 {app} 中打开',
  'workspace.openInAppMenu': '选择打开方式',
  'workspace.openInAppFailed': '打开失败',
  'openIn.app.explorer': '文件资源管理器',
  'openIn.app.vscode': 'VS Code',
  'openIn.app.kitty': 'kitty',
} as const

const bindT = (): RequirementsT => (key) => (DICT as Record<string, string>)[key] ?? key

const FALLBACK_TEXT = 'plain-fallback'

/** Store-backed face: pre-set apps, real choose, spied load/launch. */
function fakeFace(apps: readonly string[] | null, overrides?: { launch?: OpenInAppFace['launch'] }): OpenInAppFace {
  const appStore = createSnapshotStore<readonly string[] | null>(apps)
  const choiceStore = createSnapshotStore('')
  return {
    apps: appStore,
    choice: choiceStore,
    load: vi.fn(async () => {}),
    choose: (appId: string) => { choiceStore.set(appId) },
    launch: overrides?.launch ?? vi.fn(async () => {}),
  }
}

function mount(face: OpenInAppFace): ReturnType<typeof render> {
  return render(
    <OpenInAppButton
      t={bindT()}
      controller={face}
      path="/w/需求"
      fallback={<button type="button">{FALLBACK_TEXT}</button>}
    />,
  )
}

describe('open-in-app split button (0014)', () => {
  it('renders nothing while availability is unanswered, then the fallback on an empty answer', async () => {
    const unanswered = fakeFace(null)
    const first = mount(unanswered)
    expect(first.container.firstChild).toBeNull()
    expect(screen.queryByText(FALLBACK_TEXT)).toBeNull()
    expect(unanswered.load).toHaveBeenCalledTimes(1)
    first.unmount()

    const empty = fakeFace([])
    const second = mount(empty)
    expect(screen.getByText(FALLBACK_TEXT)).toBeTruthy()
    second.unmount()
  })

  it('renders the split over the fallback and hides ids it cannot name', async () => {
    const face = fakeFace(['explorer', 'mystery-app'])
    const { unmount } = mount(face)

    expect(screen.queryByText(FALLBACK_TEXT)).toBeNull()
    const main = screen.getByRole('button', { name: `在 ${DICT['openIn.app.explorer']} 中打开` })
    const icon = main.querySelector('img')
    expect(icon?.getAttribute('src')).toBe('/open-in-app/icon/explorer')

    fireEvent.click(screen.getByRole('button', { name: DICT['workspace.openInAppMenu'] }))
    expect(await waitFor(() => screen.getByRole('menuitem', { name: DICT['openIn.app.explorer'] }))).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'mystery-app' })).toBeNull()
    unmount()
  })

  it('main click launches the remembered choice (menu-order head before the first choice)', async () => {
    const face = fakeFace(['explorer', 'vscode'])
    const { unmount } = mount(face)

    fireEvent.click(screen.getByRole('button', { name: `在 ${DICT['openIn.app.explorer']} 中打开` }))
    await waitFor(() => expect(face.launch).toHaveBeenCalledWith('explorer', '/w/需求'))

    face.choose('vscode')
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: `在 ${DICT['openIn.app.vscode']} 中打开` })))
    await waitFor(() => expect(face.launch).toHaveBeenCalledWith('vscode', '/w/需求'))
    unmount()
  })

  it('menu selection remembers the choice and launches it on the same path', async () => {
    const face = fakeFace(['explorer', 'vscode'])
    const { unmount } = mount(face)

    fireEvent.click(screen.getByRole('button', { name: DICT['workspace.openInAppMenu'] }))
    fireEvent.click(await waitFor(() => screen.getByRole('menuitem', { name: DICT['openIn.app.vscode'] })))
    await waitFor(() => expect(face.launch).toHaveBeenCalledWith('vscode', '/w/需求'))
    expect(face.choice.getSnapshot()).toBe('vscode')
    unmount()
  })

  it('a failed launch dresses the main button as error', async () => {
    const face = fakeFace(['explorer'], {
      launch: () => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('boom')), 0) }),
    })
    const { unmount } = mount(face)

    fireEvent.click(screen.getByRole('button', { name: `在 ${DICT['openIn.app.explorer']} 中打开` }))
    const failed = await waitFor(() => screen.getByRole('button', { name: DICT['workspace.openInAppFailed'] }))
    expect(failed.getAttribute('data-state')).toBe('error')
    unmount()
  })

  it('an icon 404 falls back to the generic glyph (remembered per page)', async () => {
    const face = fakeFace(['kitty'])
    const { unmount } = mount(face)

    const main = screen.getByRole('button', { name: `在 ${DICT['openIn.app.kitty']} 中打开` })
    expect(main.querySelector('img')).toBeTruthy()
    fireEvent.error(main.querySelector('img')!)
    expect(await waitFor(() => main.querySelector('svg'))).toBeTruthy()
    expect(main.querySelector('img')).toBeNull()
    unmount()
  })
})
