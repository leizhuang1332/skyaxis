// @vitest-environment jsdom
/**
 * Open-in-app controller (0014): the once-per-life availability read (wire
 * guards, failure-as-empty), the choice persistence through the dsh-shared
 * localStorage key, and the launch POST contract. The fetcher seam is the
 * deterministic test surface — no real network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenInAppController } from '../../src/client/requirements/open-in-app-controller.js'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  localStorage.clear()
})

describe('open-in-app controller (0014)', () => {
  it('publishes the host app ids once loaded, filtering non-string entries', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ apps: ['explorer', 'vscode', 7, null] }))
    const controller = createOpenInAppController(fetcher)

    expect(controller.apps.getSnapshot()).toBe(null)
    await controller.load()
    expect(controller.apps.getSnapshot()).toEqual(['explorer', 'vscode'])
    expect(fetcher).toHaveBeenCalledWith('/open-in-app/apps', { headers: { accept: 'application/json' } })
  })

  it('answers an empty list — never a pending state — on any failure shape', async () => {
    const cases: readonly unknown[] = [
      jsonResponse({ apps: ['explorer'] }, 503), // non-2xx
      jsonResponse({ nope: true }), // missing apps field
      jsonResponse('explorer'), // apps not an array
      new Response('not json', { status: 200 }), // unparseable body
    ]
    for (const answer of cases) {
      const controller = createOpenInAppController(async () => answer as Response)
      await controller.load()
      expect(controller.apps.getSnapshot()).toEqual([])
    }
    const thrown = createOpenInAppController(async () => { throw new TypeError('network down') })
    await thrown.load()
    expect(thrown.apps.getSnapshot()).toEqual([])
  })

  it('shares one read across concurrent and repeated load() calls', async () => {
    let release: (() => void) | undefined
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve(jsonResponse({ apps: ['vscode'] }))
    }))
    const controller = createOpenInAppController(fetcher)

    const first = controller.load()
    const second = controller.load()
    release!()
    await Promise.all([first, second])
    await controller.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(controller.apps.getSnapshot()).toEqual(['vscode'])
  })

  it('persists the choice under the dsh-shared key and reads it back in a new controller', () => {
    const first = createOpenInAppController(async () => jsonResponse({}))
    first.choose('vscode')
    expect(localStorage.getItem('dsh.open-in-app.choice')).toBe('"vscode"')

    const second = createOpenInAppController(async () => jsonResponse({}))
    expect(second.choice.getSnapshot()).toBe('vscode')
    second.choose('')
    expect(localStorage.getItem('dsh.open-in-app.choice')).toBe('""')
  })

  it('launch posts the app/path wire body and rejects on non-2xx', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }))
    const controller = createOpenInAppController(fetcher)

    await controller.launch('vscode', '/w/需求')
    expect(fetcher).toHaveBeenCalledWith('/open-in-app/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'vscode', path: '/w/需求' }),
    })

    const failing = createOpenInAppController(async () => jsonResponse({ code: 'not-found' }, 404))
    await expect(failing.launch('gone-app', '/w')).rejects.toThrow('HTTP 404')
  })
})
