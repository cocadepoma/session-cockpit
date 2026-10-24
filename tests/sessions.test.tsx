import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { AGENTS_ROOT, APP, NOW, PANE, givenEngine, hourlyTranscripts, registerSession, wheelTick } from './fixtures'

test('the sessions section lists the open sessions, this one first, working in orange and done in green', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: '/home/dev/app', name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: '/home/dev/app', name: 'app-2', status: 'idle' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: '/home/dev/lib', name: 'lib-1', status: 'busy' })
  registerSession(world.files, { pid: 444, sessionId: 'crashed', cwd: '/home/dev/app', name: 'ghost', status: 'busy' })
  world.deadPids = [444]
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => ui.find({ type: 'Text', text: pattern })

  expect((await text(/^ \(3\) $/))?.text).toBe(' (3) ')
  expect((await text(/^2 working$/))?.props.color).toBe('claude')

  const [heading, ...rows] = await ui.findAll({ type: 'Text', text: /^(Sidebar for Claude Code|lib · lib-1|app-2|ghost)$/ })
  expect(heading?.text).toBe('Sidebar for Claude Code')
  expect(rows.map(found => found.text)).toEqual(['Sidebar for Claude Code', 'lib · lib-1', 'app-2'])
  expect(rows.map(found => found.props.bold)).toEqual([true, false, false])

  const labels = await ui.findAll({ type: 'Text', text: /^(working|done)$/ })
  expect(labels.map(found => [found.text, found.props.color])).toEqual([
    ['working', 'claude'],
    ['working', 'claude'],
    ['done', 'success'],
  ])
  await ui.unmount()
})

test('the session watch turns a session from working to done as soon as the registry says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: '/home/dev/app', name: 'app-1', status: 'busy' })
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^1 working$/ }))?.props.color).toBe('claude')

  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: '/home/dev/app', name: 'app-1', status: 'idle' })
  await clock.advance(1_000)

  expect((await ui.find({ type: 'Text', text: /^all done$/ }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

const givenElevenSessions = (world: { files: Record<string, string> }) => {
  registerSession(world.files, { pid: 100, sessionId: 'current', cwd: APP, name: 'app-00', status: 'busy' })
  for (let number = 1; number <= 9; number++) {
    registerSession(world.files, {
      pid: 100 + number,
      sessionId: `other-${number}`,
      cwd: APP,
      name: `app-0${number}`,
      status: 'idle',
    })
  }
  registerSession(world.files, { pid: 200, sessionId: 'lib', cwd: '/home/dev/lib', name: 'tool-1', status: 'idle' })
}

test('the sessions filter matches project and title, scrolls through matches and Enter clears it', async ($, on) => {
  const { world } = givenEngine(on)
  givenElevenSessions(world)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const range = () => text(/of \d+/)

  expect(await range()).toBe('1–8 of 11')
  expect((await ui.find({ type: 'Text', text: /^ \(11\) $/ }))?.text).toBe(' (11) ')

  await ui.press({ key: 'sessions-down' })
  expect(await range()).toBe('4–11 of 11')

  await ui.input({ key: 'sessions-filter', text: 'LIB', kind: 'change' })
  expect(await text(/^lib · tool-1$/)).toBe('lib · tool-1')
  expect(await text(/^app-0/)).toBeUndefined()
  expect(await range()).toBeUndefined()

  await ui.input({ key: 'sessions-filter', text: 'app-0', kind: 'change' })
  expect(await range()).toBe('1–8 of 9')

  await ui.input({ key: 'sessions-filter', text: 'zzz', kind: 'change' })
  expect(await text(/^No sessions match$/)).toBe('No sessions match')

  await ui.input({ key: 'sessions-filter', text: 'zzz' })
  expect(await text(/^No sessions match$/)).toBeUndefined()
  expect(await range()).toBe('1–8 of 11')
  await ui.unmount()
})

test('the wheel moves the sessions window before the lists below it, and keeps the offset valid when sessions end', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { transcripts: hourlyTranscripts, usesMockClock: true })
  givenElevenSessions(world)
  world.store.conversationsOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const ranges = async () => (await ui.findAll({ type: 'Text', text: /of \d+/ })).map(found => found.text)

  expect(await ranges()).toEqual(['1–8 of 11', '1–8 of 13'])
  expect(await $.ui.scroll(wheelTick(1))).toEqual({})
  expect(await ranges()).toEqual(['2–9 of 11', '1–8 of 13'])

  await $.ui.scroll(wheelTick(10))
  expect(await ranges()).toEqual(['4–11 of 11', '1–8 of 13'])

  await $.ui.scroll(wheelTick(1))
  expect(await ranges()).toEqual(['4–11 of 11', '2–9 of 13'])

  world.deadPids = [100, 101, 102, 103, 104, 105]
  await clock.advance(5_000)
  expect(await ranges()).toEqual(['2–9 of 13'])
  await ui.unmount()
})

test('a waiting session shows what it waits for, or waiting, in the warning color', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'waiting', waitingFor: 'input needed' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: APP, name: 'app-3', status: 'waiting' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^input needed$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^waiting$/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('a waiting field that is not text falls back to waiting', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'waiting', waitingFor: 42 })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^waiting$/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('waiting sessions come after this one and before working and done ones', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'a-done', status: 'idle' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: APP, name: 'b-working', status: 'busy' })
  registerSession(world.files, { pid: 444, sessionId: 'other-c', cwd: APP, name: 'c-waiting', status: 'waiting' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const [, ...rows] = await ui.findAll({ type: 'Text', text: /^(Sidebar for Claude Code|a-done|b-working|c-waiting)$/ })

  expect(rows.map(found => found.text)).toEqual(['Sidebar for Claude Code', 'c-waiting', 'b-working', 'a-done'])
  await ui.unmount()
})

test('the sessions header counts waiting and working sessions and never says all done while one waits', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'waiting' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: APP, name: 'app-3', status: 'busy' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => ui.find({ type: 'Text', text: pattern })

  expect((await text(/^1 waiting$/))?.props.color).toBe('warning')
  expect((await text(/^ · $/))?.props.color).toBe('inactive')
  expect((await text(/^1 working$/))?.props.color).toBe('claude')
  await ui.unmount()
})

test('the sessions header shows only waiting when nothing else is working', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'waiting' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => ui.find({ type: 'Text', text: pattern })

  expect((await text(/^1 waiting$/))?.props.color).toBe('warning')
  expect(await text(/^all done$/)).toBeUndefined()
  expect(await text(/^ · $/)).toBeUndefined()
  await ui.unmount()
})

const publishAgents = (
  files: Record<string, string>,
  sessionId: string,
  agents: { id: string; type: string; description: string; status: string; parentId: string | null }[],
  fileName = sessionId,
) => {
  files[`${AGENTS_ROOT}/${fileName}.json`] = JSON.stringify({ sessionId, updatedAt: NOW, agents })
}

const agent = (id: string, type: string, description: string, status: string, parentId: string | null = null) => ({
  id,
  type,
  description,
  status,
  parentId,
})

test('a session shows how many agents work for it and lists them indented by depth under its row', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'waiting' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: APP, name: 'app-3', status: 'idle' })
  world.agents = [
    { id: 'a1', type: 'Explore', description: 'Map the code', status: 'running' },
    { id: 'a2', type: 'Plan', description: 'Plan the change', status: 'waiting' },
    { id: 'a3', type: 'general-purpose', description: 'Nested helper', status: 'pending', parentId: 'a1' },
    { id: 'a4', type: 'Explore', description: 'Orphan helper', status: 'running', parentId: 'gone' },
    { id: 'a5', type: 'general-purpose', description: 'Grandchild', status: 'running', parentId: 'a3' },
  ]
  publishAgents(world.files, 'other-a', [agent('b1', 'Explore', 'Search', 'running')])
  publishAgents(world.files, 'other-b', [])
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await ui.findAll({ type: 'Text', text: /^(.* · \d+ agents?|└ .*)$/ })

  expect(rows.map(found => found.text)).toEqual([
    'working · 5 agents',
    '└ Explore · Map the code',
    '└ general-purpose · Nested helper',
    '└ general-purpose · Grandchild',
    '└ Plan · Plan the change',
    '└ Explore · Orphan helper',
    'waiting · 1 agent',
    '└ Explore · Search',
  ])
  const statuses = await ui.findAll({ type: 'Text', text: /^(running|pending|waiting)$/ })
  expect(statuses.map(found => [found.text, found.props.color])).toEqual([
    ['running', 'claude'],
    ['pending', 'inactive'],
    ['running', 'claude'],
    ['waiting', 'warning'],
    ['running', 'claude'],
    ['running', 'claude'],
  ])
  expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('agents are indented two columns per depth level', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  world.agents = [
    { id: 'a1', type: 'Explore', description: 'Parent', status: 'running' },
    { id: 'a2', type: 'Plan', description: 'Child', status: 'running', parentId: 'a1' },
    { id: 'a3', type: 'Plan', description: 'Grandchild', status: 'running', parentId: 'a2' },
  ]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const indentOf = async (id: string) => (await ui.find({ key: `agent:current:${id}` }))?.props.paddingLeft

  expect([await indentOf('a1'), await indentOf('a2'), await indentOf('a3')]).toEqual([2, 4, 6])
  await ui.unmount()
})

test('agents published by a session that is not running are ignored', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  registerSession(world.files, { pid: 444, sessionId: 'crashed', cwd: APP, name: 'ghost', status: 'busy' })
  world.deadPids = [444]
  world.agents = [{ id: 'a0', type: 'Explore', description: 'Alive helper', status: 'running' }]
  publishAgents(world.files, 'crashed', [agent('c1', 'Explore', 'Left behind', 'running')])
  publishAgents(world.files, 'unregistered', [agent('d1', 'Explore', 'Nobody home', 'running')])
  publishAgents(world.files, 'other', [agent('e1', 'Explore', 'Mislabeled', 'running')], 'other-a')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.findAll({ type: 'Text', text: /^└/ })).map(found => found.text)).toEqual(['└ Explore · Alive helper'])
  await ui.unmount()
})

test('a session whose file is missing, empty or unreadable shows exactly as before', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  registerSession(world.files, { pid: 333, sessionId: 'other-b', cwd: APP, name: 'app-3', status: 'idle' })
  publishAgents(world.files, 'other-a', [])
  world.files[`${AGENTS_ROOT}/other-b.json`] = '{ not json'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.findAll({ type: 'Text', text: /^(working|done)$/ })).map(found => found.text)).toEqual([
    'working',
    'done',
    'done',
  ])
  expect(await ui.find({ type: 'Text', text: /agents?$/ })).toBeUndefined()
  await ui.unmount()
})

test('agents follow their session through the filter and the agent count updates with the watch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: '/home/dev/lib', name: 'lib-1', status: 'busy' })
  world.agents = [{ id: 'a1', type: 'Explore', description: 'Map the code', status: 'running' }]
  publishAgents(world.files, 'other-a', [agent('b1', 'Plan', 'Plan the lib', 'running')])
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_000)
  const texts = async () => (await ui.findAll({ type: 'Text', text: /^(└ .*|.* · \d+ agents?)$/ })).map(found => found.text)

  await ui.input({ key: 'sessions-filter', text: 'lib', kind: 'change' })
  expect(await texts()).toEqual(['working · 1 agent', '└ Plan · Plan the lib'])

  await ui.input({ key: 'sessions-filter', text: 'Map the code' })
  publishAgents(world.files, 'other-a', [
    agent('b1', 'Plan', 'Plan the lib', 'running'),
    agent('b2', 'Explore', 'Second', 'running'),
  ])
  await clock.advance(1_000)
  expect(await texts()).toEqual([
    'working · 1 agent',
    '└ Explore · Map the code',
    'working · 2 agents',
    '└ Plan · Plan the lib',
    '└ Explore · Second',
  ])
  await ui.unmount()
})

const REGISTRY_FILE = '/home/dev/.claude/sessions/111.json'

const givenWatchedSession = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const engine = givenEngine(on, { usesMockClock: true })
  registerSession(engine.world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const reads = (path: string) => engine.world.read.filter(read => read === path).length
  const psRuns = () => engine.world.ran.filter(argv => argv[0] === 'ps').length

  return { ...engine, clock, ui, reads, psRuns }
}

test('a registry file that did not change is not read again by the next polls', async ($, on) => {
  const { clock, ui, reads } = await givenWatchedSession($, on)
  const before = reads(REGISTRY_FILE)
  expect(before).toBeGreaterThan(0)

  await clock.advance(3_000)

  expect(reads(REGISTRY_FILE)).toBe(before)
  expect((await ui.find({ type: 'Text', text: /^1 working$/ }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('a registry file whose mtime changed is read again, once', async ($, on) => {
  const { world, clock, ui, reads } = await givenWatchedSession($, on)
  const before = reads(REGISTRY_FILE)

  world.mtimes[REGISTRY_FILE] = 42
  await clock.advance(1_000)
  expect(reads(REGISTRY_FILE)).toBe(before + 1)

  await clock.advance(2_000)
  expect(reads(REGISTRY_FILE)).toBe(before + 1)
  await ui.unmount()
})

test('a registry file that was removed and came back with the same stamp is read again', async ($, on) => {
  const { world, clock, ui, reads } = await givenWatchedSession($, on)
  const before = reads(REGISTRY_FILE)
  const content = world.files[REGISTRY_FILE] ?? ''

  delete world.files[REGISTRY_FILE]
  await clock.advance(1_000)
  expect(await ui.find({ type: 'Text', text: /^ \(1\) $/ })).toBeUndefined()

  world.files[REGISTRY_FILE] = content
  await clock.advance(1_000)
  expect(reads(REGISTRY_FILE)).toBe(before + 1)
  expect((await ui.find({ type: 'Text', text: /^1 working$/ }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('a published agents file that did not change is not read again, and one that changed is', async ($, on) => {
  const { world, clock, ui, reads } = await givenWatchedSession($, on)
  const file = `${AGENTS_ROOT}/current.json`
  publishAgents(world.files, 'current', [agent('a1', 'Explore', 'Map the code', 'running')])
  await clock.advance(1_000)
  const before = reads(file)
  expect(before).toBeGreaterThan(0)

  await clock.advance(3_000)
  expect(reads(file)).toBe(before)

  publishAgents(world.files, 'current', [agent('a1', 'Explore', 'Map the code', 'running'), agent('a2', 'Plan', 'Plan it', 'running')])
  await clock.advance(1_000)
  expect(reads(file)).toBe(before + 1)
  expect((await ui.find({ type: 'Text', text: /^└ Plan · Plan it$/ }))?.text).toBe('└ Plan · Plan it')

  world.mtimes[file] = 77
  await clock.advance(1_000)
  expect(reads(file)).toBe(before + 2)
  await ui.unmount()
})

test('ps runs once for polls within five seconds with the same pids and again after five seconds', async ($, on) => {
  const { clock, ui, psRuns } = await givenWatchedSession($, on)
  const before = psRuns()

  await clock.advance(4_000)
  expect(psRuns()).toBe(before)

  await clock.advance(1_000)
  expect(psRuns()).toBe(before + 1)

  await clock.advance(4_000)
  expect(psRuns()).toBe(before + 1)
  await ui.unmount()
})

test('a new pid makes the next poll run ps again at once', async ($, on) => {
  const { world, clock, ui, psRuns } = await givenWatchedSession($, on)
  const before = psRuns()

  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  await clock.advance(1_000)

  expect(psRuns()).toBe(before + 1)
  expect((await ui.find({ type: 'Text', text: /^ \(2\) $/ }))?.text).toBe(' (2) ')
  await ui.unmount()
})

test('a crashed session leaves the list at most five seconds later', async ($, on) => {
  const { world, clock, ui } = await givenWatchedSession($, on)
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  await clock.advance(1_000)
  expect((await ui.find({ type: 'Text', text: /^ \(2\) $/ }))?.text).toBe(' (2) ')

  world.deadPids = [222]
  await clock.advance(1_000)
  expect((await ui.find({ type: 'Text', text: /^ \(2\) $/ }))?.text).toBe(' (2) ')

  await clock.advance(4_000)
  expect(await ui.find({ type: 'Text', text: /^ \(2\) $/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed ps is not reused: the next poll runs it again', async ($, on) => {
  const { world, clock, ui, psRuns } = await givenWatchedSession($, on)
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  world.isPsFailing = true
  await clock.advance(1_000)
  const failed = psRuns()
  expect((await ui.find({ type: 'Text', text: /^ \(2\) $/ }))?.text).toBe(' (2) ')

  world.isPsFailing = false
  world.deadPids = [222]
  await clock.advance(1_000)

  expect(psRuns()).toBe(failed + 1)
  expect(await ui.find({ type: 'Text', text: /^ \(2\) $/ })).toBeUndefined()
  await ui.unmount()
})
