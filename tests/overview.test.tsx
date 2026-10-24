import { expect, test } from 'claude-code/testing'
import { PANE, givenEngine } from './fixtures'

test('the sidebar shows the session, model, git, context, usage, MCP and todos', async ($, on) => {
  givenEngine(on)

  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'Add OAuth login\nwith details', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write the tests', status: 'completed', activeForm: 'Writing the tests' },
      { content: 'Wire the provider', status: 'in_progress', activeForm: 'Wiring the provider' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/Sidebar for/)).toBe('Sidebar for Claude Code')
    expect(await text(/Opus/)).toBe('Opus 5.5')
    expect(await text(/^· /)).toBeUndefined()
    expect(await text(/^app$/)).toBe('app')
    expect(await text(/testing/)).toBe('testing*')
    expect(await text(/↑/)).toBe('↑1')
    expect(await text(/^23%$/)).toBe('23%')
    expect(await text(/tokens/)).toBe('45,210 / 200,000 tokens')
    expect(await text(/spent/)).toBe('$1.50 spent')
    expect(await text(/^5h$/)).toBe('5h')
    expect(await text(/^41%$/)).toBe('41%')
    expect(await text(/2h 13m/)).toBe('2h 13m')
    expect(await text(/^90%$/)).toBe('90%')
    expect(await text(/4d 3h/)).toBe('4d 3h')
    expect((await ui.find({ type: 'Text', text: /^━{9}$/ }))?.props.color).toBe('claude')
    const sevenDayBar = (await ui.findAll({ type: 'Text', text: /^━+$/ })).find(found => found.props.color === 'permission')
    expect(sevenDayBar?.text).toBe('━'.repeat(13))
    expect(await text(/context7/)).toBe('context7')
    expect(await text(/remaining/)).toBe('(1 remaining)')
    expect(await text(/provider/)).toBe('Wire the provider')
    expect(await text(/Modified Files/)).toBeUndefined()
    expect(await text(/^~/)).toBe('~/app')
    await ui.unmount()
  }
})
