/**
 * Open-in-app split button (0014): dsh's session-header CAgGvG_split brought
 * to skyaxis's workspace tab over the SAME host routes — the main button
 * opens the workspace directory in the remembered application, the chevron
 * opens a menu of every application the host probed as installed. The visual
 * and interaction language (split pill, hover fill, 250ms-delayed busy dress,
 * 2s error dress, icon-404 generic glyph) mirrors dsh's OpenInAppAction
 * (dsh 0.1.5-rc.2) on skyaxis's own class names; the component itself is not
 * importable from dsh (decisions/0014 D1), so this is a re-expression, not a
 * reference.
 *
 * Degradation is the fallback prop (decisions/0014 D3): while availability is
 * unanswered the button renders nothing (dsh-isomorphic brief absence); an
 * answered empty list — SSH composition, older dsh, renamed routes — renders
 * the caller's plain-open fallback instead, which is exactly the pre-0014
 * button and its 0011 regression lock.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RequirementsT } from './dictionary.js'
import { OPEN_IN_APP_ICON_PREFIX, type OpenInAppFace } from './open-in-app-controller.js'
import styles from './open-in-app.module.css'

/**
 * Label keys per catalog id (decisions/0014 D4: self-held, the closed-key
 * discipline — dsh's own namespace is not bound). The browser renders only
 * ids it can name, so a host catalog extension without a matching dictionary
 * entry stays invisible instead of showing a raw id (the dsh filter).
 */
const APP_LABEL_KEY = {
  finder: 'openIn.app.finder',
  explorer: 'openIn.app.explorer',
  filemanager: 'openIn.app.filemanager',
  cursor: 'openIn.app.cursor',
  vscode: 'openIn.app.vscode',
  vscodeinsiders: 'openIn.app.vscodeinsiders',
  windsurf: 'openIn.app.windsurf',
  zed: 'openIn.app.zed',
  sublimetext: 'openIn.app.sublimetext',
  xcode: 'openIn.app.xcode',
  androidstudio: 'openIn.app.androidstudio',
  intellij: 'openIn.app.intellij',
  pycharm: 'openIn.app.pycharm',
  webstorm: 'openIn.app.webstorm',
  phpstorm: 'openIn.app.phpstorm',
  goland: 'openIn.app.goland',
  rider: 'openIn.app.rider',
  rustrover: 'openIn.app.rustrover',
  fork: 'openIn.app.fork',
  sourcetree: 'openIn.app.sourcetree',
  github: 'openIn.app.github',
  tower: 'openIn.app.tower',
  gitkraken: 'openIn.app.gitkraken',
  smartgit: 'openIn.app.smartgit',
  sublimemerge: 'openIn.app.sublimemerge',
  ghostty: 'openIn.app.ghostty',
  warp: 'openIn.app.warp',
  iterm: 'openIn.app.iterm',
  kitty: 'openIn.app.kitty',
  terminal: 'openIn.app.terminal',
  windowsterminal: 'openIn.app.windowsterminal',
  gitbash: 'openIn.app.gitbash',
  gnometerminal: 'openIn.app.gnometerminal',
  konsole: 'openIn.app.konsole',
} as const

type AppLabelKey = (typeof APP_LABEL_KEY)[keyof typeof APP_LABEL_KEY]

/** Label key of one catalog id, or undefined when this build cannot name it. */
function labelKeyOf(id: string): AppLabelKey | undefined {
  return (APP_LABEL_KEY as Record<string, AppLabelKey | undefined>)[id]
}

/** App ids whose icon image already failed this page (dsh-isomorphic cache). */
const failedIcons = new Set<string>()

/**
 * One application's real bundle icon (host-served PNG) with an inline generic
 * app-square fallback once the host served none — a 404 icon is remembered
 * per page, not retried per menu open.
 */
function AppIcon(props: { id: string; size: number }): ReactNode {
  const [failed, setFailed] = useState(failedIcons.has(props.id))
  if (failed) {
    return (
      <svg
        width={props.size}
        height={props.size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className={styles.icon}
        aria-hidden
      >
        <rect x={3} y={3} width={18} height={18} rx={5} />
      </svg>
    )
  }
  return (
    <img
      src={`${OPEN_IN_APP_ICON_PREFIX}/${props.id}`}
      width={props.size}
      height={props.size}
      className={styles.icon}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => {
        failedIcons.add(props.id)
        setFailed(true)
      }}
    />
  )
}

/**
 * Quick launches settle well under this delay, so the busy dress never paints
 * — the visible dim-and-wait treatment is reserved for launches that are
 * actually taking a while (dsh's constant, mirrored).
 */
const BUSY_DRESS_DELAY_MS = 250
/** How long the error dress stays before settling back to idle. */
const ERROR_DRESS_MS = 2000

/**
 * The split button, or its fallback. Renders nothing while availability is
 * unanswered; renders `fallback` when the host answered with nothing
 * nameable or the caller has no path; renders the split otherwise.
 */
export function OpenInAppButton(props: {
  t: RequirementsT
  controller: OpenInAppFace
  path: string
  fallback: ReactNode
}): ReactNode {
  const { t, controller } = props
  useEffect(() => {
    // Lazy probe: the controller dedupes per life, so mounts after the first
    // are free; users who never open the workspace tab never pay the read
    // (decisions/0014 D3 — dsh probes at page load because its button rides
    // every session header; skyaxis's button lives in one tab).
    void controller.load()
  }, [controller])

  const apps = useSyncExternalStore(controller.apps.subscribe, controller.apps.getSnapshot)
  const choice = useSyncExternalStore(controller.choice.subscribe, controller.choice.getSnapshot)

  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  const inFlight = useRef(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    clearTimeout(busyTimer.current)
    clearTimeout(errorTimer.current)
  }, [])

  const nameable = (apps ?? []).flatMap((id) => {
    const key = labelKeyOf(id)
    return key === undefined ? [] : [{ id, key }]
  })
  // Unanswered availability renders nothing (dsh-isomorphic brief absence);
  // an answered empty capability falls back to the caller's plain button.
  if (apps === null) return null
  if (nameable.length === 0 || props.path === '') return props.fallback

  const currentEntry = nameable.find((entry) => entry.id === choice) ?? nameable[0]
  const current = currentEntry.id
  const currentLabel = t(currentEntry.key)
  const title = phase === 'error'
    ? t('workspace.openInAppFailed')
    : t('workspace.openInApp').replaceAll('{app}', currentLabel)

  const launch = (appId: string): void => {
    if (inFlight.current) return
    inFlight.current = true
    clearTimeout(errorTimer.current)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => {
      setPhase('busy')
    }, BUSY_DRESS_DELAY_MS)
    controller.launch(appId, props.path).then(() => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('idle')
    }, () => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('error')
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => {
        setPhase('idle')
      }, ERROR_DRESS_MS)
    })
  }

  const entries: readonly MenuEntry[] = nameable.map((entry) => ({
    id: entry.id,
    label: t(entry.key),
    icon: <AppIcon id={entry.id} size={18} />,
  }))

  return (
    <Menu
      open={open}
      align="end"
      dense
      selection="fill"
      items={entries}
      selectedId={current}
      onSelect={(id) => {
        setOpen(false)
        if (inFlight.current) return
        controller.choose(id)
        launch(id)
      }}
      onClose={() => {
        setOpen(false)
      }}
      anchor={(
        <div className={styles.split}>
          <button
            type="button"
            className={styles.main}
            data-state={phase}
            disabled={phase === 'busy'}
            aria-label={title}
            title={title}
            onClick={() => {
              launch(current)
            }}
          >
            <AppIcon id={current} size={15} />
          </button>
          <button
            type="button"
            className={styles.chevron}
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('workspace.openInAppMenu')}
            aria-label={t('workspace.openInAppMenu')}
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            <IconChevronDownOutline14 size={11} />
          </button>
        </div>
      )}
    />
  )
}
