import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DEFAULT_COMMANDS, DEFAULT_TOOLS, NOW, PANE, givenEngine } from './fixtures'

test('switching conversations reloads the sidebar and starts the new one without the old todos', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Old conversation task', status: 'pending', activeForm: 'Working on it' }],
  })

  world.model = 'claude-sonnet-5-5'
  world.tokens = 120000
  world.percent = 60
  await $.classic.SessionStart({ source: 'resume', session_title: 'Resumed work' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  expect(await text(/Sonnet/)).toBe('Sonnet 5.5')
  expect(await text(/tokens/)).toBe('120,000 / 200,000 tokens')
  expect(await text(/^60%$/)).toBe('60%')
  expect(await text(/context7/)).toBe('context7')
  expect(await text(/^testing\*$/)).toBe('testing*')
  expect(await text(/Old conversation task/)).toBeUndefined()
  await ui.unmount()
})

test('a compaction reloads the sidebar but keeps the conversation todos', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Still relevant task', status: 'pending', activeForm: 'Working on it' }],
  })

  await $.classic.SessionStart({ source: 'compact' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /Still relevant/ }))?.text).toBe('Still relevant task')
  await ui.unmount()
})

test('a resumed conversation shows its context at once, before its first response', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  world.tokens = undefined
  world.percent = undefined
  await $.classic.SessionStart({ source: 'resume', context_tokens: 150000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  expect(await text(/tokens/)).toBe('150,000 / 200,000 tokens')
  expect(await text(/^75%$/)).toBe('75%')

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Keep going', status: 'pending', activeForm: 'Going' }],
  })
  expect(await text(/tokens/)).toBe('150,000 / 200,000 tokens')
  await ui.unmount()
})

test('the session watch reloads the sidebar when the session changes without a SessionStart event', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Old conversation task', status: 'pending', activeForm: 'Working on it' }],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/Old conversation task/)).toBe('Old conversation task')

  world.sessionId = 'other'
  world.model = 'claude-sonnet-5-5'
  await clock.advance(1_000)

  expect(await text(/Sonnet/)).toBe('Sonnet 5.5')
  expect(await text(/Old conversation task/)).toBeUndefined()
  await ui.unmount()
})

test('the session watch retries skills and MCP servers that loaded empty', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  world.commands = []
  world.tools = DEFAULT_TOOLS.filter(tool => !tool.mcp)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^Skills$/)).toBe('Skills')
  expect(await text(/\(3\)/)).toBeUndefined()
  expect(await text(/^MCP$/)).toBeUndefined()

  world.commands = DEFAULT_COMMANDS
  world.tools = DEFAULT_TOOLS
  await clock.advance(1_000)

  expect(await text(/\(3\)/)).toBe(' (3)')
  expect(await text(/context7/)).toBe('context7')
  await ui.unmount()
})

test('a conversation the watch finds already started shows the context of its last response', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  world.sessionId = 'other'
  world.tokens = undefined
  world.percent = undefined
  await clock.advance(1_000)

  expect(await text(/tokens/)).toBe('166,441 / 200,000 tokens')
  expect(await text(/^83%$/)).toBe('83%')
  await ui.unmount()
})

test('a fresh conversation with no response yet shows no usage', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  world.sessionId = 'cleared'
  world.tokens = undefined
  world.percent = undefined
  await clock.advance(1_000)

  expect((await ui.find({ type: 'Text', text: /No usage yet/ }))?.text).toBe('No usage yet')
  await ui.unmount()
})

const givenHostThatForgetsOnSwitch = (on: On) => {
  const written = new Set<string>()
  const host = { isForgetting: false }

  on('state.set', (_, e, next) => {
    written.add(`${e.key}:${e.id ?? ''}`)

    return next(e)
  })
  on('state.get', async (_, e, next) => {
    const stored = await next(e)
    if (!host.isForgetting || written.has(`${e.key}:${e.id ?? ''}`) || stored.deny !== undefined) return stored

    return { value: { value: undefined, version: stored.value.version } }
  })

  return {
    switchConversation: () => {
      host.isForgetting = true
      written.clear()
    },
  }
}

test('a conversation switch that forgets the sidebar state keeps the last sidebar until the new one loads', async ($, on) => {
  givenEngine(on)
  const host = givenHostThatForgetsOnSwitch(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await before.press({ key: 'settings-toggle' })
  await before.press({ key: 'skills-toggle' })
  await before.press({ key: 'conversations-toggle' })
  await before.press({ key: 'mcp-toggle' })
  await before.unmount()

  host.switchConversation()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^Logo$/)).toBe('Logo')
  expect(await text(/review-checklist/)).toBe('/frontend-review-checklist')
  expect(await text(/Renamed/)).toBe('Renamed "quoted" title')
  expect(await text(/active/)).toBe(' (3 active)')
  expect(await text(/Opus/)).toBe('Opus 5.5')
  expect(await text(/^23%$/)).toBe('23%')
  expect(await text(/^41%$/)).toBe('41%')
  expect(await text(/2\.1\.306/)).toBe('2.1.306')
  await ui.unmount()
})
