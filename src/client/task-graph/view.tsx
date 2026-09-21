import type { JSX } from 'react'

/**
 * Placeholder body for the "任务图 / Task Graph" conversation-view entry.
 *
 * Receives the runtime props the conversation.view owner contract supplies
 * (Session snapshot, conversationViews snapshot, etc.). Render the
 * substantive board in later iterations — the goal of this stub is only to
 * prove the slot integration end-to-end.
 */
export function TaskGraphView(): JSX.Element {
  return (
    <div
      role="region"
      aria-label="任务图"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--skyaxis-fg-muted, #888)',
        fontSize: 14,
      }}
    >
      <span>任务图 / Task Graph — 待实现</span>
    </div>
  )
}
