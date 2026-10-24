import { expect, test } from 'claude-code/testing'
import { APP, DEFAULT_TOOLS, PANE, givenEngine, paneAt, wheelTick } from './fixtures'

test('the MCP section folds and unfolds when it lists three or more servers', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

    expect(await text(/context7/)).toBe('context7')

    await ui.press({ key: 'mcp-toggle' })
    expect(await text(/context7/)).toBeUndefined()
    expect(await text(/active/)).toBe(' (3 active)')

    await ui.press({ key: 'mcp-toggle' })
    expect(await text(/context7/)).toBe('context7')
    await ui.unmount()
  }
})

const numberedMcpTools = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `mcp__server-${String(index + 1).padStart(2, '0')}__run`,
    description: 'Runs',
    mcp: true,
  }))

test('the MCP filter matches names, survives folding and Enter clears it', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  expect(await ui.find({ key: 'mcp-filter' })).toBeDefined()
  await ui.input({ key: 'mcp-filter', text: 'ENGRAM', kind: 'change' })
  expect(await text(/^engram$/)).toBe('engram')
  expect(await text(/^context7$/)).toBeUndefined()

  await ui.input({ key: 'mcp-filter', text: 'zzz', kind: 'change' })
  expect(await text(/^No servers match$/)).toBe('No servers match')

  await ui.input({ key: 'mcp-filter', text: 'zzz' })
  expect(await text(/^No servers match$/)).toBeUndefined()
  expect(await text(/^context7$/)).toBe('context7')

  await ui.input({ key: 'mcp-filter', text: 'engram', kind: 'change' })
  await ui.press({ key: 'mcp-toggle' })
  expect(await text(/^engram$/)).toBeUndefined()
  await ui.press({ key: 'mcp-toggle' })
  expect(await text(/^engram$/)).toBe('engram')
  expect(await text(/^context7$/)).toBeUndefined()
  await ui.unmount()
})

test('with fewer than three servers the MCP list has no filter box', async ($, on) => {
  const { world } = givenEngine(on)
  world.tools = DEFAULT_TOOLS.slice(0, 3)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'mcp-filter' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^context7$/ }))?.text).toBe('context7')
  await ui.unmount()
})

test('the MCP list scrolls through a window of eight by its arrows and the wheel, counting matches', async ($, on) => {
  const { world } = givenEngine(on)
  world.tools = numberedMcpTools(10)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const range = async () => (await ui.find({ type: 'Text', text: /of \d+/ }))?.text
  const names = async () => (await ui.findAll({ type: 'Text', text: /^server-/ })).map(found => found.text)

  expect(await range()).toBe('1–8 of 10')
  expect(await names()).toHaveLength(8)

  await ui.press({ key: 'mcp-down' })
  expect(await range()).toBe('3–10 of 10')
  await ui.press({ key: 'mcp-up' })
  expect(await range()).toBe('1–8 of 10')

  expect(await $.ui.scroll(wheelTick(1))).toEqual({})
  expect(await range()).toBe('2–9 of 10')

  await ui.input({ key: 'mcp-filter', text: 'server-0', kind: 'change' })
  expect(await range()).toBe('1–8 of 9')
  expect(await names()).toHaveLength(8)

  await ui.input({ key: 'mcp-filter', text: 'server-1', kind: 'change' })
  expect(await range()).toBeUndefined()
  expect(await names()).toEqual(['server-10'])
  await ui.unmount()
})

test('a folded MCP list does not take the wheel', async ($, on) => {
  const reached: number[] = []
  on('ui.scroll', (_, e) => {
    reached.push(e.by)

    return {}
  })
  const { world } = givenEngine(on)
  world.tools = numberedMcpTools(10)
  world.store.mcpOpen = false
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(paneAt(0))
  await $.ui.scroll(wheelTick(1))

  expect(reached).toEqual([1])
  await ui.unmount()
})
