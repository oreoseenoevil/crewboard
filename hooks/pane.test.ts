import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'crewboard'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const IDS = Array.from({ length: 60 }, (_, i) => `JOB-${i + 1}`)
const STATUS = JSON.stringify({ cloud: IDS.map(id => ({ id, label: `Job ${id}`, model: 'sonnet', session: `cse_${id.replace('-', '')}` })) })

// A status file with 60 cloud workers whose branches are all pushed; `refs` collects what git was asked.
async function world($: Engine, on: On, refs: string[][]) {
  mock.clock(on, { now: Date.parse('2026-10-20T12:00:00Z') })
  mock.env(on, { USERPROFILE: 'C:\\home', LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: 'C:\\repo' }) as never)
  on('session.cwd', () => ({ value: 'C:\\repo' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.read', (_$, e) => (String((e as { path?: string }).path).endsWith('C:\\home\\.claude\\crewboard\\workers.json') ? { value: STATUS } : { error: new Error('missing') }))
  on('fs.stat', () => ({ error: new Error('missing') }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    refs.push(argv)
    return { value: { exitCode: 0, stdout: argv.filter(a => a.startsWith('refs/')).map(r => `abc\t${r}`).join('\n'), stderr: '' } }
  })
  await $.session.start({ source: 'startup', cwd: 'C:\\repo', surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'workers', args: 'open' } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: 60 finished cloud rows draw at most 15, then Show All draws them all`, async ($, on) => {
    const asked: string[][] = []
    await world($, on, asked)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'crewboard', props: pane })
    const rows = async () =>
      surface === 'desktop' ? (await ui.findAll({ type: 'Svg' })).filter(el => /, finished$/.test(String(el.props.alt))).length : (await ui.findAll({ type: 'Text', text: /^✓$/ })).length

    expect(await rows()).toBe(15)
    expect((await ui.find({ key: 'show-all' }))?.props.label).toBe('Show All (60)')

    await ui.press({ key: 'show-all' })
    expect(await rows()).toBe(60)
    expect((await ui.find({ key: 'show-all' }))?.props.label).toBe('Show Fewer')
    await ui.press({ key: 'show-all' })
    expect(await rows()).toBe(15)
    await ui.unmount()

    // One git call, for the pending refs only; every branch is seen pushed, so later syncs do not ask again.
    expect(asked.length).toBe(1)
    expect(asked[0]!.slice(0, 4)).toEqual(['git', 'ls-remote', '--heads', 'origin'])
    expect(asked[0]!.length).toBe(4 + 60)
    await $.command.run({ command: 'workers', args: 'open' } as never)
    expect(asked.length).toBe(1)
  })
}
