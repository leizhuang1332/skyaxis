/**
 * CopyTextButton (P5a 导出增强): a micro three-state copy button for
 * already-fetched document bodies (plan versions / review reports) — the
 * sow-modal copy machine in one button, no modal of its own. Clipboard is
 * the user-ratified export form; `copy` stays injectable (the jsdom seam).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchT } from './dictionary.js'
import styles from './view.module.css'

export function CopyTextButton(props: {
  t: WorkbenchT
  /** Empty string disables (nothing to copy yet — honest disable, not hide). */
  text: string
  copy?: (text: string) => Promise<boolean>
}): ReactNode {
  const { t } = props
  const [state, setState] = useState<'idle' | 'busy' | 'copied'>('idle')
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const onCopy = (): void => {
    if (state !== 'idle' || props.text.length === 0) return
    setState('busy')
    void (props.copy ?? writeClipboard)(props.text).then((ok) => {
      if (ok) {
        setState('copied')
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => { setState('idle') }, 1000)
      } else {
        setState('idle')
      }
    })
  }

  return (
    <button
      type="button"
      className={styles.ghostButton}
      disabled={props.text.length === 0 || state === 'busy'}
      onClick={onCopy}
    >
      {state === 'copied' ? t('sow.copied') : t('wp.copyBody')}
    </button>
  )
}
