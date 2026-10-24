import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, givenEngine } from './fixtures'

const category = (name: string, tokens: number, kind = 'used') => ({
  name,
  tokens,
  color: 'inactive',
  isDeferred: kind === 'deferred',
  kind,
})

const mcpTool = (serverName: string, tokens: number, isLoaded = true) => ({
  name: `mcp__${serverName}__tool`,
  serverName,
  tokens,
  isLoaded,
})

const memoryFile = (path: string, tokens: number) => ({ path, type: 'Project', tokens })

const BREAKDOWN = {
  categories: [
    category('System prompt', 3000),
    category('Messages', 40000),
    category('Free space', 150000, 'free'),
    category('Autocompact buffer', 33000, 'buffer'),
    category('Deferred tools', 900, 'deferred'),
    category('Agents', 1200),
  ],
  memoryFiles: [
    memoryFile('/home/dev/app/CLAUDE.md', 1500),
    memoryFile('/home/dev/.claude/CLAUDE.md', 3400),
    ...['a', 'b', 'c', 'd', 'e'].map((name, index) => memoryFile(`/home/dev/app/rules/${name}.md`, 100 + index)),
  ],
  mcpTools: [
    mcpTool('alpha', 800),
    mcpTool('alpha', 700),
    mcpTool('beta', 900),
    mcpTool('gamma', 300),
    mcpTool('gamma', 4000, false),
    ...['s1', 's2', 's3', 's4'].map((name, index) => mcpTool(name, 10 + index)),
  ],
}

const givenBreakdown = async ($: Parameters<TestBody>[0], on: On) => {
  const { world } = givenEngine(on)
  world.breakdownRows = BREAKDOWN
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  return world
}

const rowTexts = async (ui: { findAll: (query: { key: string }) => Promise<{ text?: string }[]> }, key: string) =>
  (await ui.findAll({ key })).map(found => found.text)

test('the details are folded by default and a press unfolds them with a summary breakdown, largest first', async ($, on) => {
  const world = await givenBreakdown($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^details$/)).toBe('details')
  expect(await text(/^Messages$/)).toBeUndefined()
  expect(world.breakdownCalls).not.toContain('full')

  await ui.press({ key: 'context-details-toggle' })

  expect(world.store.contextDetailsOpen).toBe(true)
  expect(world.breakdownCalls.at(-1)).toBe('summary')
  expect(await text(/^Messages$/)).toBe('Messages')
  expect(await text(/^20%$/)).toBe('20%')
  expect(await text(/^40,000$/)).toBe('40,000')
  const names = (await ui.findAll({ type: 'Text', text: /^(Messages|System prompt|Agents|Free space|Autocompact buffer|Deferred tools)$/ })).map(found => found.text)
  expect(names).toEqual(['Messages', 'System prompt', 'Agents'])
  expect(await text(/^Memory files$/)).toBeUndefined()
  await ui.unmount()
})

test('the open flag is remembered by a later session', async ($, on) => {
  const { world } = givenEngine(on)
  world.breakdownRows = BREAKDOWN
  world.store.contextDetailsOpen = true
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Messages$/ }))?.text).toBe('Messages')
  expect(world.breakdownCalls).not.toContain('full')
  await ui.unmount()
})

test('the summary is refreshed at each main turn end and not at a subagent turn end', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  const world = await givenBreakdown($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context-details-toggle' })
  const calls = world.breakdownCalls.length

  await $.turn.complete({ answer: '', agentId: 'sub' } as never)
  expect(world.breakdownCalls.length).toBe(calls)

  world.breakdownRows = { ...BREAKDOWN, categories: [category('Messages', 60000)] }
  await $.turn.complete({ answer: '' } as never)
  expect(world.breakdownCalls.length).toBeGreaterThan(calls)
  expect((await ui.find({ type: 'Text', text: /^60,000$/ }))?.text).toBe('60,000')
  expect((await ui.find({ type: 'Text', text: /^System prompt$/ }))?.text).toBeUndefined()
  await ui.unmount()
})

test('measure calls the full breakdown once and lists the top five memory files and MCP servers', async ($, on) => {
  const world = await givenBreakdown($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context-details-toggle' })
  expect(world.breakdownCalls).not.toContain('full')
  expect((await ui.find({ type: 'Text', text: /^measure$/ }))?.text).toBe('measure')

  await ui.press({ key: 'context-measure' })

  expect(world.breakdownCalls.filter(call => call === 'full')).toHaveLength(1)
  const files = (await ui.findAll({ key: 'context-file:CLAUDE.md' })).length
  expect(files).toBe(2)
  const filePaths = (await ui.findAll({ type: 'Text', text: /\.md$/ })).map(found => found.text)
  expect(filePaths).toEqual(['CLAUDE.md', 'CLAUDE.md', 'e.md', 'd.md', 'c.md'])
  const servers = (await ui.findAll({ type: 'Text', text: /^(alpha|beta|gamma|s\d)$/ })).map(found => found.text)
  expect(servers).toEqual(['alpha', 'beta', 'gamma', 's4', 's3'])
  expect((await ui.find({ type: 'Text', text: /^1,500$/ }))?.text).toBe('1,500')
  expect((await ui.find({ type: 'Text', text: /^3,400$/ }))?.text).toBe('3,400')
  expect((await ui.find({ type: 'Text', text: /^re-measure$/ }))?.text).toBe('re-measure')
  await ui.unmount()
})

test('a summary refresh keeps the measurement and a new conversation drops it', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  const world = await givenBreakdown($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context-details-toggle' })
  await ui.press({ key: 'context-measure' })

  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ type: 'Text', text: /^Memory files$/ }))?.text).toBe('Memory files')
  expect(world.breakdownCalls.filter(call => call === 'full')).toHaveLength(1)

  world.sessionId = 'resumed'
  await $.classic.SessionStart({ source: 'resume' })
  expect(await ui.find({ type: 'Text', text: /^Memory files$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^measure$/ }))?.text).toBe('measure')
  expect((await ui.find({ type: 'Text', text: /^Messages$/ }))?.text).toBe('Messages')
  await ui.unmount()
})

test('a breakdown that fails leaves the details empty and measure usable again', async ($, on) => {
  const world = await givenBreakdown($, on)
  world.breakdownTokens = 'throws'
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'context-details-toggle' })
  expect((await ui.find({ type: 'Text', text: /^No breakdown yet$/ }))?.text).toBe('No breakdown yet')

  await ui.press({ key: 'context-measure' })
  expect((await ui.find({ type: 'Text', text: /^measure$/ }))?.text).toBe('measure')
  await ui.unmount()
})
