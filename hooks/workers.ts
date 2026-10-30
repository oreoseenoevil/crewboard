// Session workers that run outside this chat: local `claude -p` processes and cloud
// sessions, listed in a status file the orchestrator keeps. Pure logic; register.tsx reads
// the files and feeds them in.
import type { AgentRun } from '../types'

/** `dir` is the folder the worker runs in: its `cd`, else the folder of the session that started it. */
export type WorkerEntry = { id: string; label?: string; model?: string; effort?: string; worktree?: string; dir?: string; startedAt?: number; role?: string; session?: string; result?: string }
/** A long CLI run (a test suite, a build): progress is lines matching `count` in `log`, out of `expected`. */
export type TaskEntry = {
  id: string; label?: string; role?: string; startedAt?: number
  log: string; count: string; expected?: number; failed?: string
  output?: string; done?: string
}
export type WorkerList = { local: WorkerEntry[]; cloud: WorkerEntry[]; tasks: TaskEntry[] }

export const ROLES = ['frontend', 'backend', 'design', 'qa'] as const

/** A role named in the status file, else one read from the task's words. */
export function roleOf(named: string | undefined, words: string): string {
  if (named && (ROLES as readonly string[]).includes(named)) return named
  if (/design|mockup|figma|wireframe/i.test(words)) return 'design'
  if (/\b(qa|tests?|unit|integration|e2e|suite|typecheck|browser pass)\b/i.test(words)) return 'qa'
  if (/\b(ui|screen|screens|frontend|front-end|layout|copy|wording|phone|css|page)\b/i.test(words)) return 'frontend'
  return 'backend'
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const when = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || undefined : undefined)
const ID = /^[A-Za-z0-9._-]{1,64}$/
const SESSION = /^cse_[A-Za-z0-9_-]{1,100}$/

const tasks = (value: unknown): TaskEntry[] =>
  Array.isArray(value)
    ? value
        .filter((one): one is Record<string, unknown> => typeof one?.id === 'string' && ID.test(one.id) && typeof one.log === 'string' && typeof one.count === 'string')
        .map(one => ({
          id: one.id as string,
          label: str(one.label),
          role: str(one.role),
          startedAt: when(one.startedAt),
          log: one.log as string,
          count: one.count as string,
          expected: typeof one.expected === 'number' && one.expected > 0 ? one.expected : undefined,
          failed: str(one.failed),
          output: str(one.output),
          done: str(one.done),
        }))
    : []

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export type CostFn = (model: string, u: Usage, isRequest: boolean) => number

const entries = (value: unknown): WorkerEntry[] =>
  Array.isArray(value)
    ? value
        .filter((one): one is Record<string, unknown> => typeof one?.id === 'string' && ID.test(one.id))
        .map(one => ({
          id: one.id as string,
          label: str(one.label),
          model: str(one.model),
          effort: str(one.effort),
          worktree: str(one.worktree),
          dir: str(one.dir),
          startedAt: when(one.startedAt),
          role: str(one.role),
          session: typeof one.session === 'string' && SESSION.test(one.session) ? one.session : undefined,
          result: str(one.result),
        }))
    : []

/** The orchestrator's status file; a missing or broken file lists nobody. */
export function parseWorkerList(text: string): WorkerList {
  try {
    const raw = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown> | null
    return { local: entries(raw?.local), cloud: entries(raw?.cloud), tasks: tasks(raw?.tasks) }
  } catch {
    return { local: [], cloud: [], tasks: [] }
  }
}

// `cloud/<ID>` not followed by more of a name or a `:` path, so `origin/cloud/plans:docs/a.md` is no branch.
const BRANCH = /\bcloud\/([A-Za-z0-9._-]+)(?![A-Za-z0-9._:-])/g

/** The `cloud/<ID>` a cloud worker's prompt pushes: the first named after "push" on its line. A branch it only fetches or reads is not one. */
export function pushedBranchOf(prompt: string): string | undefined {
  const named = [...prompt.matchAll(BRANCH)]
    .map(m => ({ id: (m[1] ?? '').replace(/\.+$/, ''), at: m.index ?? 0 }))
    .filter(b => ID.test(b.id))
  return named.find(b => /\bpush\b[^\n]*$/i.test(prompt.slice(0, b.at)))?.id
}

// A brief the prompt names (`.../cloud-prompts/FIX-AMENITIES.md`), and a task id in a routine's name ("Atrium FIX-AMENITIES").
const BRIEF = /\bcloud-prompts\/([A-Za-z0-9._-]{1,64})\.md\b/
const NAME_ID = /^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+$/

/** A cloud worker's id: the branch its prompt pushes, else the brief its prompt names, else the task id in its routine's name. */
export function cloudIdOf(prompt: string, name?: string): string | undefined {
  const brief = BRIEF.exec(prompt)?.[1]
  const fromName = name?.split(/\s+/).find(word => NAME_ID.test(word))
  return [pushedBranchOf(prompt), brief, fromName].find((id): id is string => !!id && ID.test(id))
}

type TriggerRun = {
  session_id?: unknown
  trigger?: {
    name?: unknown
    derived_state?: { model?: unknown; prompt?: unknown }
    job_config?: { ccr?: { session_context?: { model?: unknown }; events?: Array<{ data?: { message?: { content?: unknown } } }> } }
  }
}

/** The cloud worker a RemoteTrigger `run` started, from the API's answer; none when no id can be told from its prompt or name. */
export function triggerRunEntry(json: string, at: number): WorkerEntry | undefined {
  let run: TriggerRun | null
  try {
    run = JSON.parse(json) as TriggerRun | null
  } catch {
    return undefined
  }
  const t = run?.trigger
  const prompt = str(t?.derived_state?.prompt) ?? str(t?.job_config?.ccr?.events?.[0]?.data?.message?.content)
  const id = prompt ? cloudIdOf(prompt, str(t?.name)) : undefined
  const session = run?.session_id
  if (!id || typeof session !== 'string' || !SESSION.test(session)) return undefined
  return { id, label: str(t?.name), model: str(t?.derived_state?.model) ?? str(t?.job_config?.ccr?.session_context?.model), session, startedAt: at }
}

/** The status file with one more cloud worker; none when that run is listed already or the file is not a status file. A new run of a listed id replaces its row. */
export function withCloudEntry(text: string, entry: WorkerEntry): string | undefined {
  let raw: unknown
  try {
    raw = text.trim() ? JSON.parse(text.replace(/^﻿/, '')) : { local: [], cloud: [], tasks: [] }
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const list = raw as Record<string, unknown>
  const cloud: unknown[] = Array.isArray(list.cloud) ? list.cloud : []
  const listed = cloud.find(one => (one as { id?: unknown } | null)?.id === entry.id) as { session?: unknown } | undefined
  if (listed && (!entry.session || listed.session === entry.session)) return undefined
  return JSON.stringify({ ...list, cloud: [...cloud.filter(one => one !== listed), entry] }, null, 2)
}

const unquote = (s: string): string => s.replace(/^(["'])(.*)\1$/, '$2')
const isAbsolute = (path: string): boolean => /^([A-Za-z]:[\\/]|[\\/])/.test(path)

/**
 * The local worker a shell command starts: a `claude -p` run whose output goes to `<ID>.result.json`.
 * Its folder is a leading `cd` or `Set-Location`, which a relative result path is read from.
 * None when the command is no such run, or names its paths through variables the shell would expand.
 * `sessionDir`, the starting session's folder, is where the run works when the command has no `cd`.
 */
export function cliLaunchEntry(command: string, at: number, sessionDir?: string): WorkerEntry | undefined {
  if (!/(^|[\s;&|(])claude(\.exe)?\s+(-p|--print)\b/.test(command)) return undefined
  const out = /(?:^|[^0-9&])>\s*("[^"]+\.result\.json"|'[^']+\.result\.json'|[^\s;&|"']+\.result\.json)/.exec(command)?.[1]
  if (!out) return undefined
  const cd = /^\s*(?:cd|Set-Location)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/i.exec(command)?.[1]
  const resultPath = unquote(out)
  const worktree = cd ? unquote(cd) : undefined
  if (/[$%]/.test(resultPath) || (worktree && /[$%]/.test(worktree))) return undefined
  const id = (resultPath.split(/[\\/]/).pop() ?? '').replace(/\.result\.json$/, '')
  if (!ID.test(id)) return undefined
  const result = isAbsolute(resultPath) ? resultPath : worktree ? `${worktree.replace(/[\\/]+$/, '')}/${resultPath}` : undefined
  if (!result) return undefined
  const flag = (name: string) => /^[A-Za-z0-9._-]+$/.exec(new RegExp(`--${name}[ =](\\S+)`).exec(command)?.[1] ?? '')?.[0]
  return { id, model: flag('model'), effort: flag('effort'), worktree, dir: worktree ?? (sessionDir || undefined), result, startedAt: at }
}

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/**
 * Where a worker runs, the way a person names it: the folder ("atrium-mobile"), or for a git
 * worktree its repository and the worktree ("budgeting-hub › mob-p3-srv-2"). `gitFile` is the text
 * of the folder's `.git` file, which only a worktree has; a repository's `.git` is a folder.
 */
export function placeOf(dir: string | undefined, gitFile: string): string | undefined {
  if (!dir) return undefined
  const name = baseName(dir)
  const repo = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(gitFile)?.[1]
  const repoName = repo ? baseName(repo) : ''
  return repoName && repoName !== name ? `${repoName} › ${name}` : name || undefined
}

/** The status file with this local worker, replacing an earlier row of the same id; none when the file is not a status file. */
export function withLocalEntry(text: string, entry: WorkerEntry): string | undefined {
  let raw: unknown
  try {
    raw = text.trim() ? JSON.parse(text.replace(/^﻿/, '')) : { local: [], cloud: [], tasks: [] }
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const list = raw as Record<string, unknown>
  const local: unknown[] = Array.isArray(list.local) ? list.local : []
  const kept = local.filter(one => (one as { id?: unknown } | null)?.id !== entry.id)
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))
  return JSON.stringify({ ...list, local: [...kept, clean] }, null, 2)
}

const base = (path: unknown): string => (typeof path === 'string' ? path.split(/[\\/]/).pop() || path : '')

/** A shell command as a person would name it: "Tests: dues.itest.ts", "Typecheck ui", "git log". */
export function commandText(command: string): string {
  // Drop a leading change of folder and environment settings.
  const cmd = command
    .replace(/^\s*(Set-Location|cd)\s+("[^"]*"|\S+)\s*(;|&&)\s*/i, '')
    .replace(/^\s*(\$env:\w+\s*=\s*('[^']*'|"[^"]*"|\S+)\s*;\s*)+/i, '')
    .trim()
  const config = /tsc(?:\.js)?\b.*?-p\s+"?([^\s"]+)/.exec(cmd)
  if (config) return `Typecheck ${base(config[1]).replace(/^tsconfig\.(typecheck\.)?|\.json$/g, '') || ''}`.trim()
  if (/\btypecheck\b/.test(cmd)) return 'Typecheck'
  if (/run-sharded-tests/.test(cmd)) return /itest/.test(cmd) ? 'Integration suite' : 'Unit suite'
  if (/--test\b/.test(cmd)) {
    const files = [...cmd.matchAll(/[^\s"']+\.(?:i?test|spec)\.tsx?/g)].map(m => base(m[0]))
    return files.length ? `Tests: ${files.join(', ')}` : 'Tests'
  }
  if (/\beslint\b/.test(cmd)) return 'Lint'
  if (/\bnext(?:\.js)?\b[^;]*\bbuild\b|\bpnpm\s+build\b/.test(cmd)) return 'Production build'
  if (/\bplaywright\b/.test(cmd)) return 'Browser tests'
  const git = /^git\s+(?:-C\s+\S+\s+)?([a-z-]+)/.exec(cmd)
  if (git) return `git ${git[1]}`
  const pnpm = /^pnpm\s+(?:run\s+)?(\S+)/.exec(cmd)
  if (pnpm) return `pnpm ${pnpm[1]}`
  const first = cmd.split(/\r?\n/)[0] ?? ''
  return first.length > 60 ? `${first.slice(0, 59)}…` : first
}

/** What one tool call is doing, in a few words. */
export function toolText(name: string, input: Record<string, unknown>): string {
  if ((name === 'Bash' || name === 'PowerShell') && typeof input.command === 'string') return commandText(input.command)
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return `Editing ${base(input.file_path ?? input.notebook_path)}`
  if (name === 'Read') return `Reading ${base(input.file_path)}`
  if (name === 'Grep' || name === 'Glob') return 'Searching the code'
  if (name === 'Agent' || name === 'Task') return 'Briefing a helper'
  if (name === 'WebFetch' || name === 'WebSearch') return 'Reading the web'
  return name.replace(/^mcp__[^_]+__/, '')
}

/** Claude Code's folder name for a project path under ~/.claude/projects. */
export const projectDirName = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '-')

export type TranscriptStats = {
  model: string; steps: number; tokens: number; contextTokens: number; costUsd: number; firstAt?: number; lastAt?: number
  /** The tool call still waiting for its result, as words, and when it started. */
  activity?: string; activityAt?: number
}

type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string }

/** A worker's session transcript (JSONL): one model request per assistant message id. */
export function transcriptStats(text: string, cost: CostFn): TranscriptStats {
  const byId = new Map<string, { model: string; usage: Usage }>()
  const open = new Map<string, { text: string; at?: number }>()
  let firstAt: number | undefined
  let lastAt: number | undefined
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let row: { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Partial<Usage>; content?: unknown } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const at = row.timestamp ? Date.parse(row.timestamp) : NaN
    if (Number.isFinite(at)) {
      firstAt ??= at
      lastAt = at
    }
    const m = row.message
    const blocks: Block[] = Array.isArray(m?.content) ? (m.content as Block[]) : []
    for (const b of blocks) {
      if (b?.type === 'tool_use' && b.id && b.name) open.set(b.id, { text: toolText(b.name, b.input ?? {}), at: Number.isFinite(at) ? at : undefined })
      else if (b?.type === 'tool_result' && b.tool_use_id) open.delete(b.tool_use_id)
    }
    if (row.type !== 'assistant' || !m?.id || !m.usage) continue
    const u = m.usage
    // A message is written once per content block with the same usage: the last copy wins.
    byId.set(m.id, {
      model: m.model ?? '',
      usage: {
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      },
    })
  }
  const requests = [...byId.values()].filter(r => r.model !== '<synthetic>')
  const sum = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const last = requests.at(-1)
  const pending = [...open.values()].at(-1)
  return {
    model: last?.model ?? '',
    steps: requests.length,
    tokens: requests.reduce((s, r) => s + sum(r.usage), 0),
    contextTokens: last ? sum(last.usage) : 0,
    costUsd: requests.reduce((s, r) => s + cost(r.model, r.usage, true), 0),
    firstAt,
    lastAt,
    activity: pending?.text,
    activityAt: pending?.at,
  }
}

export type ResultStats = { isError: boolean; costUsd?: number; steps?: number; tokens?: number; model?: string }

/** The `--output-format json` result a finished `claude -p` writes; null while it is not there yet. */
export function resultStats(text: string): ResultStats | null {
  if (!text.trim()) return null
  try {
    const r = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
    const u = (r.usage ?? {}) as Partial<Usage>
    const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    const models = r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage) : []
    return {
      isError: r.is_error === true || (typeof r.subtype === 'string' && r.subtype !== 'success'),
      costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : undefined,
      steps: typeof r.num_turns === 'number' ? r.num_turns : undefined,
      tokens: tokens || undefined,
      model: models[0],
    }
  } catch {
    // A result file that is not JSON still means the process ended.
    return { isError: true }
  }
}

/** The ids whose `cloud/<ID>` branch `git ls-remote --heads origin` lists. */
export function pushedCloudIds(lsRemote: string): Set<string> {
  const ids = new Set<string>()
  for (const line of lsRemote.split(/\r?\n/)) {
    const match = /refs\/heads\/cloud\/(\S+)\s*$/.exec(line)
    if (match) ids.add(match[1]!)
  }
  return ids
}

export type LocalFacts = { entry: WorkerEntry; result: ResultStats | null; endedAt?: number; transcript: TranscriptStats | null; promptAt?: number; place?: string }

const ROW_PREFIX = /^(local|cloud|task):/

/** True for a row this module owns, so a sync replaces exactly these. */
export const isWorkerRow = (a: AgentRun): boolean => ROW_PREFIX.test(a.id)

export function localRow(f: LocalFacts, windowOf: (model: string) => number, at: number): AgentRun {
  const t = f.transcript
  const model = t?.model || f.result?.model || f.entry.model || ''
  const status = !f.result ? 'running' : f.result.isError ? 'failed' : 'done'
  const startedAt = f.entry.startedAt ?? t?.firstAt ?? f.promptAt ?? at
  return {
    id: `local:${f.entry.id}`,
    type: 'local',
    description: f.entry.label ?? f.entry.id,
    model,
    effort: f.entry.effort,
    status,
    startedAt,
    endedAt: status === 'running' ? undefined : (f.endedAt ?? t?.lastAt ?? at),
    contextTokens: t?.contextTokens ?? 0,
    contextMax: windowOf(model),
    tokens: f.result?.tokens ?? t?.tokens ?? 0,
    costUsd: f.result?.costUsd ?? t?.costUsd ?? 0,
    steps: f.result?.steps ?? t?.steps ?? 0,
    round: 1,
    role: roleOf(f.entry.role, f.entry.label ?? f.entry.id),
    activity: status === 'running' ? t?.activity : undefined,
    activityAt: status === 'running' ? t?.activityAt : undefined,
    place: f.place,
  }
}

const countOf = (text: string, pattern: string | undefined): number => {
  if (!pattern || !text) return 0
  try {
    return text.match(new RegExp(pattern, 'gm'))?.length ?? 0
  } catch {
    return 0
  }
}

/** A long CLI run: done once its output says so; progress when its total is known. */
export function taskRow(entry: TaskEntry, logText: string, outputText: string, logAt: number | undefined, at: number): AgentRun {
  const seen = countOf(logText, entry.count)
  const failed = countOf(logText, entry.failed)
  const isDone = countOf(outputText, entry.done) > 0
  const total = entry.expected
  return {
    id: `task:${entry.id}`,
    type: 'task',
    description: entry.label ?? entry.id,
    model: '',
    status: isDone ? 'done' : 'running',
    startedAt: entry.startedAt ?? at,
    endedAt: isDone ? (logAt ?? at) : undefined,
    contextTokens: 0,
    contextMax: 0,
    tokens: 0,
    costUsd: 0,
    steps: 0,
    round: 1,
    role: roleOf(entry.role, entry.label ?? entry.id),
    // A suite can run a few more tests than the last full run: the bar stops at full.
    stepDone: total ? Math.min(seen, total) : undefined,
    stepTotal: total,
    stepNote: failed ? `${failed} failed` : undefined,
    activity: total ? undefined : `${seen} done${failed ? `, ${failed} failed` : ''}`,
  }
}

export function cloudRow(entry: WorkerEntry, isPushed: boolean, pushedAt: number | undefined, windowOf: (model: string) => number, at: number): AgentRun {
  const model = entry.model ?? ''
  return {
    id: `cloud:${entry.id}`,
    type: 'cloud',
    description: entry.label ?? entry.id,
    model,
    effort: entry.effort,
    status: isPushed ? 'done' : 'running',
    startedAt: entry.startedAt ?? at,
    endedAt: isPushed ? (pushedAt ?? at) : undefined,
    contextTokens: 0,
    contextMax: windowOf(model),
    tokens: 0,
    costUsd: 0,
    steps: 0,
    round: 1,
    role: roleOf(entry.role, entry.label ?? entry.id),
    session: entry.session,
  }
}
