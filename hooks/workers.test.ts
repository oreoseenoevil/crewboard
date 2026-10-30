import { expect, test } from 'claude-code/testing'

import {
  cloudRow, commandText, localRow, parseWorkerList, projectDirName, pushedBranchOf, pushedCloudIds, resultStats, roleOf, taskRow, transcriptStats,
  cliLaunchEntry, cloudIdOf, placeOf, triggerRunEntry, withCloudEntry, withLocalEntry,
} from './workers'

test('a worker shows what it is running now, named the way a person would say it', async () => {
  const use = (id: string, name: string, input: object, at: string) => JSON.stringify({ type: 'assistant', timestamp: at, message: { id: `m-${id}`, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
  const result = (id: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } })
  const text = [
    use('t1', 'Read', { file_path: 'C:\\repo\\src\\a.ts' }, '2026-10-19T12:00:00Z'),
    result('t1'),
    use('t2', 'PowerShell', { command: 'Set-Location C:\\repo; node node_modules/tsx/dist/cli.mjs --test --conditions=react-server src/server/booking-channels/jobs.itest.ts' }, '2026-10-19T12:01:00Z'),
  ].join('\n')
  const t = transcriptStats(text, cost)
  expect([t.activity, t.activityAt]).toEqual(['Tests: jobs.itest.ts', Date.parse('2026-10-19T12:01:00Z')])
  expect(transcriptStats([text, result('t2')].join('\n'), cost).activity).toBe(undefined)
  expect(commandText('node --max-old-space-size=12288 node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.typecheck.ui.json')).toBe('Typecheck ui')
  expect(commandText('node node_modules/tsx/dist/cli.mjs scripts/run-sharded-tests.ts 6 -- --test src/**/*.itest.ts')).toBe('Integration suite')
  expect(commandText('git -C C:\\repo log --oneline -3')).toBe('git log')
  expect(commandText('node node_modules/eslint/bin/eslint.js --max-warnings=0 src/a.ts')).toBe('Lint')
})

test('a role named in the status file wins; otherwise the words of the task decide', async () => {
  expect(roleOf('design', 'Unit fixes')).toBe('design')
  expect(roleOf('chef', 'Fix the 8 integration failures')).toBe('qa')
  expect(roleOf(undefined, 'Phone layout and wording on the lot page')).toBe('frontend')
  expect(roleOf(undefined, 'New rate correction service')).toBe('backend')
  expect(roleOf(undefined, 'Mockups of the budget editor')).toBe('design')
})

test('a long CLI run counts its finished tests against the last full run, and ends when its output says so', async () => {
  const entry = { id: 'INT', label: 'Integration tests', log: 'x', count: '^\\[shard \\d+/\\d+\\] (✔|✖) ', failed: '^\\[shard \\d+/\\d+\\] ✖ ', expected: 4, output: 'y', done: '^integration: exit' }
  const log = '[shard 1/6] ✔ a (1ms)\r\n[shard 2/6] ✖ b (2ms)\r\nnoise ✔\r\n[shard 1/6] ✔ c (1ms)\r\n'
  const running = taskRow(entry, log, '', 5, 9)
  expect([running.id, running.status, running.stepDone, running.stepTotal, running.stepNote, running.role]).toEqual(['task:INT', 'running', 3, 4, '1 failed', 'qa'])
  const done = taskRow(entry, log, 'commit x\nintegration: exit 0 in 180 min\n', 5, 9)
  expect([done.status, done.endedAt]).toEqual(['done', 5])
  expect(taskRow({ ...entry, expected: undefined }, log, '', 5, 9).activity).toBe('3 done, 1 failed')
  // The status file spells the marks as escapes, which survive any file encoding.
  expect(taskRow({ ...entry, count: '^\\[shard \\d+/\\d+\\] (\\u2714|\\u2716) ' }, log, '', 5, 9).stepDone).toBe(3)
})

const cost = () => 0.5
const windowOf = () => 1_000_000

test('a running local worker reads its transcript: one step per request, the last request as its context', async () => {
  const line = (id: string, input: number, read: number, at: string) =>
    JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: 0 } } })
  const text = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-19T12:00:00Z', message: { content: 'go' } }),
    line('m1', 100, 0, '2026-10-19T12:00:05Z'),
    line('m1', 100, 0, '2026-10-19T12:00:05Z'),
    line('m2', 5, 2000, '2026-10-19T12:01:00Z'),
    'not json',
  ].join('\n')
  const t = transcriptStats(text, cost)
  expect([t.steps, t.contextTokens, t.tokens, t.costUsd, t.model]).toEqual([2, 2015, 2125, 1, 'claude-opus-5-5'])
  const row = localRow({ entry: { id: 'FIX-HOOK', label: 'Setup race', effort: 'high' }, result: null, transcript: t }, windowOf, 0)
  expect([row.id, row.type, row.status, row.startedAt, row.endedAt, row.description]).toEqual(['local:FIX-HOOK', 'local', 'running', Date.parse('2026-10-19T12:00:00Z'), undefined, 'Setup race'])
})

test('a finished local worker takes its cost and turns from the result file; an error result fails the row', async () => {
  const done = resultStats(JSON.stringify({ subtype: 'success', is_error: false, total_cost_usd: 3.79, num_turns: 90, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, modelUsage: { 'claude-opus-5-5': {} } }))
  expect(done).toEqual({ isError: false, costUsd: 3.79, steps: 90, tokens: 10, model: 'claude-opus-5-5' })
  expect(resultStats('')).toBe(null)
  expect(resultStats('{"is_error":true}')?.isError).toBe(true)
  const row = localRow({ entry: { id: 'FIX-UNIT' }, result: done, endedAt: 50, transcript: null, promptAt: 10 }, windowOf, 99)
  expect([row.status, row.costUsd, row.steps, row.startedAt, row.endedAt, row.description]).toEqual(['done', 3.79, 90, 10, 50, 'FIX-UNIT'])
})

test('the status file, folder names and cloud branches', async () => {
  const list = parseWorkerList(JSON.stringify({ local: [{ id: 'FIX-QA', label: 'Browser fixes', startedAt: '2026-10-19T09:00:00Z' }, { id: '../bad' }], cloud: [{ id: 'UC2-20', model: 'opus' }], remaining: [] }))
  expect(list.local.map(e => [e.id, e.startedAt])).toEqual([['FIX-QA', Date.parse('2026-10-19T09:00:00Z')]])
  expect(parseWorkerList('nope')).toEqual({ local: [], cloud: [], tasks: [] })
  expect(projectDirName('C:\\Users\\me\\repo\\.claude\\worktrees\\fix-hook')).toBe('C--Users-me-repo--claude-worktrees-fix-hook')
  const pushed = pushedCloudIds('abc\trefs/heads/cloud/UC2-20\ndef\trefs/heads/dev\n')
  expect([...pushed]).toEqual(['UC2-20'])
  expect(cloudRow(list.cloud[0]!, true, 7, windowOf, 9).status).toBe('done')
  expect(cloudRow(list.cloud[0]!, false, undefined, windowOf, 9).status).toBe('running')
})

test('a RemoteTrigger run lists its cloud worker under the branch its prompt pushes', async () => {
  const prompt = 'Run: git fetch origin cloud/plans dev && git show origin/cloud/plans:docs/cloud-prompts/RS-A.md\nRead it, then commit only that file, push to cloud/RS-A, and give its final answer.'
  expect(pushedBranchOf(prompt)).toBe('RS-A')
  expect(pushedBranchOf('Finish with git push -u origin HEAD:cloud/UC2-20.')).toBe('UC2-20')
  expect(pushedBranchOf('Read origin/cloud/plans:docs/a.md and report back.')).toBe(undefined)

  const run = { session_id: 'cse_01Abc', trigger: { name: 'Re-score part A', derived_state: { model: 'claude-opus-5-5', prompt } } }
  const entry = triggerRunEntry(JSON.stringify(run), 5)
  expect(entry).toEqual({ id: 'RS-A', label: 'Re-score part A', model: 'claude-opus-5-5', session: 'cse_01Abc', startedAt: 5 })
  expect(triggerRunEntry(JSON.stringify({ ...run, session_id: 'nope' }), 5)).toBe(undefined)
  expect(triggerRunEntry('HTTP 500', 5)).toBe(undefined)

  const file = JSON.stringify({ local: [], cloud: [{ id: 'UC2-20' }], remaining: ['x'] })
  const added = parseWorkerList(withCloudEntry(file, entry!) ?? '')
  expect(added.cloud.map(e => [e.id, e.session])).toEqual([['UC2-20', undefined], ['RS-A', 'cse_01Abc']])
  expect(JSON.parse(withCloudEntry(file, entry!) ?? '{}').remaining).toEqual(['x'])
  expect(withCloudEntry(withCloudEntry(file, entry!) ?? '', entry!)).toBe(undefined)
  expect(parseWorkerList(withCloudEntry('', entry!) ?? '').cloud.length).toBe(1)
  expect(withCloudEntry('{ broken', entry!)).toBe(undefined)
})

test('a fetched branch is never a cloud id: the brief, then the routine name, name the worker', () => {
  const prompt = 'Run: git fetch origin cloud/plans cloud/nov1-rc cloud/nov1-base && git show origin/cloud/plans:docs/superpowers/cloud-prompts/FIX-AMENITIES.md\nRead it fully, then do exactly what it says.'
  expect(pushedBranchOf(prompt)).toBe(undefined)
  expect(cloudIdOf(prompt, 'Atrium FIX-AMENITIES')).toBe('FIX-AMENITIES')
  expect(cloudIdOf('Fix the dues screen, then report back.', 'Atrium MIGRATE-1 budgets tables and dates')).toBe('MIGRATE-1')
  expect(cloudIdOf('Fix the dues screen, then report back.', 'Nightly check')).toBe(undefined)
  expect(cloudIdOf('Read cloud-prompts/A.md, then git push origin HEAD:cloud/B-2.', 'X-1')).toBe('B-2')

  const run = { session_id: 'cse_02New', trigger: { name: 'Atrium FIX-AMENITIES', derived_state: { model: 'claude-opus-5-5', prompt } } }
  const entry = triggerRunEntry(JSON.stringify(run), 7)
  expect(entry?.id).toBe('FIX-AMENITIES')
  // A new run of a listed id replaces its row; the same run is not listed twice.
  const file = JSON.stringify({ cloud: [{ id: 'FIX-AMENITIES', session: 'cse_01Old' }, { id: 'nov1-base' }] })
  const replaced = parseWorkerList(withCloudEntry(file, entry!) ?? '')
  expect(replaced.cloud.map(e => [e.id, e.session])).toEqual([['nov1-base', undefined], ['FIX-AMENITIES', 'cse_02New']])
  expect(withCloudEntry(withCloudEntry(file, entry!) ?? '', entry!)).toBe(undefined)
})

test('a claude -p launch from the shell lists its local worker with its own result file', () => {
  const bash = 'cd C:/work/wt/fix-sr && claude -p --model sonnet --effort high --output-format json < C:/work/briefs/FIX-SR.txt > C:/work/out/FIX-SR.result.json 2> C:/work/out/FIX-SR.err.txt'
  expect(cliLaunchEntry(bash, 9)).toEqual({ id: 'FIX-SR', model: 'sonnet', effort: 'high', worktree: 'C:/work/wt/fix-sr', dir: 'C:/work/wt/fix-sr', result: 'C:/work/out/FIX-SR.result.json', startedAt: 9 })
  const relative = 'Set-Location "C:\\work\\wt\\mig"; claude -p --model=opus < p.txt > "MIG-1.result.json"'
  expect(cliLaunchEntry(relative, 1)).toEqual({ id: 'MIG-1', model: 'opus', effort: undefined, worktree: 'C:\\work\\wt\\mig', dir: 'C:\\work\\wt\\mig', result: 'C:\\work\\wt\\mig/MIG-1.result.json', startedAt: 1 })
  // No launch, a result path the shell would expand, no folder for a relative path, or stderr alone: no row.
  expect(cliLaunchEntry('git status > out.result.json', 1)).toBe(undefined)
  expect(cliLaunchEntry('claude -p < p.txt > "$S/FIX.result.json"', 1)).toBe(undefined)
  expect(cliLaunchEntry('claude -p < p.txt > FIX.result.json', 1)).toBe(undefined)
  expect(cliLaunchEntry('claude -p < p.txt 2> C:/o/FIX.result.json', 1)).toBe(undefined)

  const entry = cliLaunchEntry(bash, 9)!
  const file = JSON.stringify({ local: [{ id: 'FIX-SR', model: 'opus' }, { id: 'OTHER' }], cloud: [], suites: null })
  const listed = withLocalEntry(file, entry) ?? ''
  expect(parseWorkerList(listed).local.map(e => [e.id, e.model, e.result])).toEqual([['OTHER', undefined, undefined], ['FIX-SR', 'sonnet', 'C:/work/out/FIX-SR.result.json']])
  expect(JSON.parse(listed).suites).toBe(null)
  expect(withLocalEntry('{ broken', entry)).toBe(undefined)
})

test('a worker row says where it runs: the folder, or a worktree with its repository', async () => {
  expect(placeOf('C:/Users/PC/OneDrive/Desktop/project-101/atrium-mobile', '')).toBe('atrium-mobile')
  expect(placeOf('C:/Users/PC/bh-wt/mob-p3-srv-2', 'gitdir: C:/Users/PC/OneDrive/Desktop/project-101/budgeting-hub/.git/worktrees/mob-p3-srv-2\n')).toBe('budgeting-hub › mob-p3-srv-2')
  expect(placeOf('C:\\Users\\PC\\am-wt\\p2-app-a\\', 'gitdir: C:\\Users\\PC\\OneDrive\\Desktop\\project-101\\atrium-mobile\\.git\\worktrees\\p2-app-a')).toBe('atrium-mobile › p2-app-a')
  expect(placeOf(undefined, '')).toBe(undefined)
  const launch = 'claude -p --model sonnet --effort high --output-format json < C:/x/A-1.prompt.txt > C:/Users/PC/.claude/crewboard/A-1.result.json'
  expect(cliLaunchEntry(launch, 1, 'C:/repo/atrium-mobile')?.dir).toBe('C:/repo/atrium-mobile')
  expect(cliLaunchEntry(`cd C:/Users/PC/bh-wt/x && ${launch}`, 1, 'C:/repo/atrium-mobile')?.dir).toBe('C:/Users/PC/bh-wt/x')
  expect(parseWorkerList(JSON.stringify({ local: [{ id: 'A-1', dir: 'C:/repo/atrium-mobile' }] })).local[0]?.dir).toBe('C:/repo/atrium-mobile')
})
