/**
 * Hand-declared wire shapes for the four `tool-workflow/*` session events (P2d).
 *
 * The events are declared by `@deepseek-ai/dsh-tool-workflow` (merged into the
 * wire SessionEventMap there) and are in the core persistence catalog
 * (KNOWN_SESSION_EVENT_TYPES) plus the controller's wire codec — but that
 * package is NOT a dependency of this repo, and the typert host table carries
 * no workflow-named types (155 named types, zero workflow). Shapes below were
 * extracted from the registry tarball `@deepseek-ai/dsh-tool-workflow@0.1.5-rc.2`
 * (lib/types/types.d.ts), same method as research/0003 §四.
 *
 * `runId` is a WorkflowRunId brand on the wire; locally a plain string (the
 * brand adds nothing to folding and would need the uninstalled package).
 *
 * If dsh-tool-workflow ever becomes a real dependency, drop this file and
 * depend on its types.
 */
export {}

declare module '@deepseek-ai/dsh-session/types' {
  /** Stable run identity (WorkflowRunId on the wire). */
  type ToolWorkflowRunId = string

  interface ToolWorkflowRunStartData {
    readonly runId: ToolWorkflowRunId
    readonly name: string
  }

  interface ToolWorkflowAgentStartData {
    readonly runId: ToolWorkflowRunId
    readonly seq: number
    readonly label: string
    readonly phase?: string
    readonly childId: import('@deepseek-ai/dsh-session/types').SessionId
  }

  interface ToolWorkflowAgentEndData {
    readonly runId: ToolWorkflowRunId
    readonly seq: number
    /** 'completed' | 'failed' | 'cancelled' (WorkflowAgentOutcome on the wire). */
    readonly outcome: 'completed' | 'failed' | 'cancelled'
  }

  interface ToolWorkflowRunEndData {
    readonly runId: ToolWorkflowRunId
    /** 'completed' | 'cancelled' | 'error' (WorkflowStopReason on the wire). */
    readonly stopReason: 'completed' | 'cancelled' | 'error'
  }

  interface SessionEventMap {
    /** Opens one durable top-level workflow run record. */
    'tool-workflow/run-start': ToolWorkflowRunStartData
    /** Records one published workflow member (child session). */
    'tool-workflow/agent-start': ToolWorkflowAgentStartData
    /** Settles one previously started workflow member. */
    'tool-workflow/agent-end': ToolWorkflowAgentEndData
    /** Closes one workflow run after cleanup. */
    'tool-workflow/run-end': ToolWorkflowRunEndData
  }
}
