export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** A cloud worker's session id (cse_...), kept as given. */
  session?: string
  /** The kind of work, for a session worker: frontend, backend, design or qa; picks the costume. */
  role?: string
  /** What a session worker is doing right now ("Tests: dues.itest.ts"), and since when. */
  activity?: string
  activityAt?: number
  /** Where a local worker runs: its folder, or "repository › worktree". */
  place?: string
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  /** Finished rows past the newest few are listed only when this is on. */
  isShowAll: boolean
  autoOpenedFor: string
}

declare module 'claude-code' {
  interface PluginState {
    'crewboard': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
