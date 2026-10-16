/**
 * Open-in-app client controller (0014): the browser half of reusing the dsh
 * host's open-in-app capability from skyaxis's workspace tab.
 *
 * Reuse boundary (decisions/0014 D1): dsh's own split button component is not
 * importable (the browser package exports only its plugin entry) and its CSS
 * class is a build hash, but the HOST half — three webServer routes mounted by
 * dsh-web-app, a bundle of the same web profile composition skyaxis rides —
 * is a plain same-origin HTTP contract behind the connection trust fence
 * (the login cookie rides automatically, the fetcher.ts precedent). This
 * module mirrors dsh's OpenInAppController shape: one once-per-life
 * availability read, the persisted last choice, and the launch POST.
 *
 * Route constants are string literals copied from
 * @deepseek-ai/dsh-host-open-in-app lib/types/shared.ts (dsh 0.1.5-rc.2):
 * that package publishes them as a ./shared subpath but is not in the page
 * module graph, and the browser package has no ./shared export — so typed
 * import is unreachable by construction. A mismatch cannot misfire: a
 * changed route answers non-2xx/404, the read publishes an empty list, and
 * the button degrades to the plain-open fallback (decisions/0014 D3).
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** GET route serving the probed application ids (host-cached resolutions). */
const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps'
/** POST route launching one application on one directory. */
const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open'
/** GET prefix serving one PNG icon per application id (img src use). */
export const OPEN_IN_APP_ICON_PREFIX = '/open-in-app/icon'
/**
 * localStorage key of the remembered application, shared VERBATIM with dsh's
 * own session-header split button (its controller persists through the same
 * snapshot-store mechanism, whose persist name is the bare localStorage key).
 * One remembered app across both surfaces; if a dsh upgrade renames the key,
 * each side silently keeps its own history — a degradation, never an error.
 */
const OPEN_IN_APP_CHOICE_KEY = 'dsh.open-in-app.choice'

/** The uSES-facing read face of a snapshot store (structural, test-fakeable). */
export interface SnapshotFace<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/**
 * Browser controller face: availability (`null` until the host answered),
 * the remembered choice, and the launch carrier. `load()` is idempotent per
 * controller life — concurrent callers share one read.
 */
export interface OpenInAppFace {
  /** Installed app ids in host menu order; null before the first answer. */
  readonly apps: SnapshotFace<readonly string[] | null>
  /** Last chosen app id, or '' before the first choice. */
  readonly choice: SnapshotFace<string>
  /** Ensure availability is published; concurrent calls share the read. */
  load(): Promise<void>
  /** Remember one picked app id. */
  choose(appId: string): void
  /** Launch one app on a directory; rejects on any non-2xx answer. */
  launch(appId: string, path: string): Promise<void>
}

/**
 * Build the controller. The fetcher seam exists for deterministic tests
 * (dsh's controller takes the same injection); production rides global fetch.
 */
export function createOpenInAppController(
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
): OpenInAppFace {
  const apps = createSnapshotStore<readonly string[] | null>(null)
  const choice = createSnapshotStore('', { persist: { name: OPEN_IN_APP_CHOICE_KEY } })
  let loading: Promise<void> | undefined

  const run = async (): Promise<void> => {
    let ids: readonly string[] = []
    try {
      const response = await fetcher(OPEN_IN_APP_APPS_ROUTE, { headers: { accept: 'application/json' } })
      if (response.ok) {
        const payload: unknown = await response.json()
        // Wire guard mirrors dsh: the body is `{ apps: [...] }`, non-string
        // entries are dropped, and any other shape (including a thrown
        // parse) publishes the empty list.
        if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { readonly apps?: unknown }).apps)) {
          ids = (payload as { readonly apps: readonly unknown[] }).apps.filter((id): id is string => typeof id === 'string')
        }
      }
    } catch {
      // Network/unavailable composition — an answered "no capability", not a
      // pending state; the button falls back to plain open.
    }
    apps.set(ids)
  }

  return {
    apps,
    choice,
    load: (): Promise<void> => {
      loading ??= run()
      return loading
    },
    choose: (appId: string): void => {
      choice.set(appId)
    },
    launch: async (appId: string, path: string): Promise<void> => {
      const response = await fetcher(OPEN_IN_APP_OPEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: appId, path }),
      })
      if (!response.ok) throw new Error(`open-in-app: HTTP ${String(response.status)}`)
    },
  }
}
