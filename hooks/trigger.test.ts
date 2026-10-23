import { expect, mock, test } from 'claude-code/testing'

const AT = Date.parse('2026-10-23T14:16:00Z')
const RUN = JSON.stringify({
  session_id: 'cse_01Run',
  trigger: { name: 'Re-score part A', derived_state: { model: 'claude-opus-5-5', prompt: 'Read origin/cloud/plans:docs/a.md, then push to cloud/RS-A.' } },
})

test('a RemoteTrigger run writes its cloud worker into the status file once; other actions write nothing', async ($, on) => {
  mock.clock(on, { now: AT })
  mock.env(on, { USERPROFILE: 'C:\\home', LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: 'C:\\repo' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  let file = JSON.stringify({ local: [], cloud: [], tasks: [], remaining: ['x'] })
  const written: string[] = []
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.read', (_$, e) => (String((e as { path?: string }).path).endsWith('workers.json') ? { value: file } : { error: new Error('missing') }) as never)
  on('fs.write', (_$, e) => {
    const w = e as { path: string; text: string }
    written.push(w.path)
    file = w.text
    return { value: undefined } as never
  })
  on('fs.stat', () => ({ error: new Error('missing') }) as never)
  on('fs.list', () => ({ value: [] }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('tool.call', { tool: 'RemoteTrigger' }, async (_$, e) => ({ result: { status: 200, json: (e as { action?: string }).action === 'run' ? RUN : '{}' } }) as never)

  expect(await $.tool.call({ tool: 'RemoteTrigger', action: 'run', trigger_id: 'trig_01A' } as never)).toMatchObject({ result: { status: 200, json: RUN } })
  expect(written).toEqual(['C:\\home\\.claude\\crewboard\\workers.json'])
  expect(JSON.parse(file)).toMatchObject({
    remaining: ['x'],
    cloud: [{ id: 'RS-A', label: 'Re-score part A', model: 'claude-opus-5-5', session: 'cse_01Run', startedAt: AT }],
  })

  await $.tool.call({ tool: 'RemoteTrigger', action: 'run', trigger_id: 'trig_01A' } as never)
  await $.tool.call({ tool: 'RemoteTrigger', action: 'get', trigger_id: 'trig_01A' } as never)
  expect(written.length).toBe(1)
})
