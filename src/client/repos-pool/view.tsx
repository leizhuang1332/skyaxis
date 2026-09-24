/**
 * Repos-pool P1 view: the empty-page skeleton and the sidebar icon glyph.
 *
 * The page is pure presentation — `t` arrives as a prop (no ctx in the view
 * layer), the stylesheet rides the ported CSS Modules pipeline, and every
 * color goes through --dsw-alias-* tokens so theme plugins re-skin it.
 */
import type { ReactNode } from 'react'
import { IconDatabaseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReposPoolT } from './dictionary.js'
import styles from './view.module.css'

export function ReposPoolPage({ t }: { t: ReposPoolT }): ReactNode {
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('panel.title')}</h1>
      </header>
      <div className={styles.body}>
        <div className={styles.empty}>{t('page.empty')}</div>
      </div>
    </section>
  )
}

/**
 * Sidebar.panellist glyph: the host shell owns the button chrome (tooltip,
 * aria, active styling, click wiring); this component only draws the icon at
 * the requested size (16 wide / 18 rail). `active` stays unconsumed in P1 —
 * activation feedback belongs to the shell.
 */
export function ReposPoolIcon(props: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconDatabaseOutline16 size={props.size} />
}
