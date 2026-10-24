import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import {
  APP,
  NOW,
  givenEngine,
  givenTenFilesWithEmptyNotes,
  hourlyTranscripts,
  paneAt,
  registerSession,
  transcriptEntry,
  wheelTick,
} from './fixtures'

const overflowTick = (by: number) => ({ ...wheelTick(by), bodyRows: 40, contentRows: 100 })

const pointerTick = (by: number, treeRow: number, paneOffset = 0) => ({
  ...overflowTick(by),
  pointer: { column: 4, row: treeRow - paneOffset },
})

const givenPaneRecorder = (on: On) => {
  const reached: number[] = []
  on('ui.scroll', (_, e) => {
    reached.push(e.by)

    return {}
  })

  return reached
}

test('a scroll without a pointer scrolls the pane first and leaves the open lists alone while the pane can move', async ($, on) => {
  const reached = givenPaneRecorder(on)
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount(paneAt(0))
  const range = async () => (await ui.find({ type: 'Text', text: /of 10/ }))?.text

  expect(await range()).toBe('1–8 of 10')
  await $.ui.scroll(overflowTick(1))

  expect(reached).toEqual([1])
  expect(await range()).toBe('1–8 of 10')
  await ui.unmount()
})

test('a scroll without a pointer at the bottom of the pane moves the first open list that can move, skipping an empty one', async ($, on) => {
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount(paneAt(60))
  const range = async () => (await ui.find({ type: 'Text', text: /of 10/ }))?.text

  expect(await $.ui.scroll(overflowTick(2))).toEqual({})
  expect(await range()).toBe('3–10 of 10')
  await ui.unmount()
})

test('a scroll without a pointer at the top of the pane moves an open list upward', async ($, on) => {
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount(paneAt(0))
  const range = async () => (await ui.find({ type: 'Text', text: /of 10/ }))?.text

  await $.ui.scroll(wheelTick(10))
  expect(await range()).toBe('3–10 of 10')
  await $.ui.scroll(wheelTick(-1))
  expect(await range()).toBe('2–9 of 10')
  await ui.unmount()
})

test('an empty Notes list no longer swallows a scroll without a pointer when the pane fits', async ($, on) => {
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount(paneAt(0))

  await $.ui.scroll(wheelTick(1))
  expect((await ui.find({ type: 'Text', text: /of 10/ }))?.text).toBe('2–9 of 10')
  await ui.unmount()
})

test('a scroll no open list can move is passed on to the engine', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { world } = givenEngine(on)
  world.store.notesOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(paneAt(0))
  await $.ui.scroll(wheelTick(1))

  expect(reached).toEqual([1])
  await ui.unmount()
})

// Pane rows of the sidebar below, one row per line, a blank row between sections:
// logo 0-2, header 4-6 (title, model, git), keep awake 8, context 10-14, usage 16-18, skills 20 (folded),
// Conversations 22 (header), 23 (filter), 24-31 (window), 32 (scroller), Notes 34 (folded),
// Files 36 (header), 37 (filter), 38-45 (window), 46 (scroller), MCP 48 (header), 49 (filter), 50-52 (three servers).
const CONVERSATIONS_FIRST = 24
const CONVERSATIONS_LAST = 31
const FILES_FIRST = 38
const FILES_LAST = 45
const FILES_FILTER = 37
const FILES_SCROLLER = 46
const USAGE_ROW = 17
const MCP_FIRST = 50

const givenFilesAndConversations = async ($: Parameters<TestBody>[0], on: On, pane = paneAt(0)) => {
  const { world } = givenEngine(on, { transcripts: [transcriptEntry('current.jsonl', NOW), ...hourlyTranscripts] })
  world.store.filesOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }

  const ui = await $.ui.mount(pane)
  await ui.press({ key: 'conversations-toggle' })
  const range = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text

  return { world, ui, files: () => range(/of 10$/), conversations: () => range(/of 13$/) }
}

test('a wheel tick over the Files window scrolls Files, not Conversations above it and not the pane', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files, conversations } = await givenFilesAndConversations($, on)

  expect(await files()).toBe('1–8 of 10')
  expect(await conversations()).toBe('1–8 of 13')
  expect(await $.ui.scroll(pointerTick(1, FILES_FIRST))).toEqual({})

  expect(await files()).toBe('2–9 of 10')
  expect(await conversations()).toBe('1–8 of 13')
  expect(reached).toEqual([])
  await ui.unmount()
})

test('a wheel tick over the Conversations window scrolls Conversations, not Files below it and not the pane', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files, conversations } = await givenFilesAndConversations($, on)

  expect(await $.ui.scroll(pointerTick(2, CONVERSATIONS_LAST))).toEqual({})

  expect(await conversations()).toBe('3–10 of 13')
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([])
  await ui.unmount()
})

test('the first and the last row of a window are over the list, the filter and scroller rows around it are not', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on)

  await $.ui.scroll(pointerTick(1, FILES_FIRST))
  expect(await files()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(-1, FILES_LAST))
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([])

  await $.ui.scroll(pointerTick(1, FILES_FILTER))
  await $.ui.scroll(pointerTick(1, FILES_SCROLLER))
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([1, 1])
  await ui.unmount()
})

test('a wheel tick over a list at its edge in that direction moves the pane', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on)

  await $.ui.scroll(pointerTick(-1, FILES_FIRST))
  expect(reached).toEqual([-1])
  expect(await files()).toBe('1–8 of 10')

  await $.ui.scroll(pointerTick(5, FILES_FIRST))
  expect(await files()).toBe('3–10 of 10')
  expect(reached).toEqual([-1])
  await $.ui.scroll(pointerTick(1, FILES_FIRST))
  expect(reached).toEqual([-1, 1])
  expect(await files()).toBe('3–10 of 10')
  await ui.unmount()
})

test('a wheel tick over a row that is not a list row moves the pane and no list', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files, conversations } = await givenFilesAndConversations($, on)

  for (const row of [0, 5, 9, USAGE_ROW, 22, 23, 33, MCP_FIRST, 60]) await $.ui.scroll(pointerTick(1, row))

  expect(reached).toHaveLength(9)
  expect(await files()).toBe('1–8 of 10')
  expect(await conversations()).toBe('1–8 of 13')
  await ui.unmount()
})

test('a wheel tick up over a list scrolled down moves that list, not the pane', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on, paneAt(10))

  await $.ui.scroll(pointerTick(2, FILES_FIRST, 10))
  expect(await files()).toBe('3–10 of 10')
  await $.ui.scroll(pointerTick(-1, FILES_FIRST, 10))

  expect(await files()).toBe('2–9 of 10')
  expect(reached).toEqual([])
  await ui.unmount()
})

test('the rows follow a scrolled pane: the same screen row is a different tree row', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on, paneAt(20))

  await $.ui.scroll(pointerTick(1, FILES_FIRST, 20))
  expect(await files()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(1, FILES_SCROLLER, 20))
  expect(await files()).toBe('2–9 of 10')
  expect(reached).toEqual([1])
  await ui.unmount()
})

test('hiding the logo moves the Files window up by four rows', { options: { showLogo: false } }, async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on)
  const first = FILES_FIRST - 4
  const last = FILES_LAST - 4

  await $.ui.scroll(pointerTick(1, first))
  expect(await files()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(-1, last))
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([])
  await $.ui.scroll(pointerTick(1, last + 1))
  expect(reached).toEqual([1])
  await ui.unmount()
})

test('folding Conversations moves the Files window up by the ten rows it gives back', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files, conversations } = await givenFilesAndConversations($, on)
  await ui.press({ key: 'conversations-toggle' })
  const first = FILES_FIRST - 10
  const last = FILES_LAST - 10

  await $.ui.scroll(pointerTick(1, first))
  expect(await files()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(-1, last))
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([])
  await $.ui.scroll(pointerTick(1, last + 1))
  await $.ui.scroll(pointerTick(1, CONVERSATIONS_FIRST))
  expect(reached).toEqual([1, 1])
  expect(await conversations()).toBeUndefined()
  await ui.unmount()
})

test('a list too short to scroll passes the tick to the pane', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files, conversations } = await givenFilesAndConversations($, on)

  await $.ui.scroll(pointerTick(1, MCP_FIRST))

  expect(reached).toEqual([1])
  expect(await files()).toBe('1–8 of 10')
  expect(await conversations()).toBe('1–8 of 13')
  await ui.unmount()
})

test('a session with agents takes one row for itself and one for each agent in the Sessions window', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.agents = [
    { id: 'a1', type: 'Explore', description: 'Map the code', status: 'running' },
    { id: 'a2', type: 'Plan', description: 'Plan the change', status: 'waiting' },
  ]
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }

  const ui = await $.ui.mount(paneAt(0))
  const range = async () => (await ui.find({ type: 'Text', text: /of 10$/ }))?.text
  // Sessions 22 (header), 23 (filter), 24-26 (this session and its two agents), 27 (the other session); Conversations 29 (folded),
  // Notes 31 (folded), Files 33 (header), 34 (filter), 35-42 (window).
  await $.ui.scroll(pointerTick(1, 35))
  expect(await range()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(-1, 42))
  expect(await range()).toBe('1–8 of 10')
  expect(reached).toEqual([])
  await $.ui.scroll(pointerTick(1, 43))
  expect(reached).toEqual([1])
  await ui.unmount()
})

test('a long branch and a long project name stay on the one git row, the branch kept', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { world } = givenEngine(on, { transcripts: [transcriptEntry('current.jsonl', NOW), ...hourlyTranscripts] })
  const branch = `feature/${'a-very-long-branch-name-'.repeat(3)}end`
  const root = `/home/dev/${'project-'.repeat(8)}`
  world.root = root
  world.git.top = root
  world.git.status = `## ${branch}...origin/${branch} [ahead 12, behind 3]\0 M src/index.ts\0`
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(paneAt(0))
  await ui.press({ key: 'conversations-toggle' })
  const [project, shownBranch, ahead, behind] = [
    (await ui.find({ type: 'Text', text: /^pro/ }))?.text ?? '',
    (await ui.find({ type: 'Text', text: /^feature\// }))?.text ?? '',
    (await ui.find({ type: 'Text', text: /^↑12$/ }))?.text,
    (await ui.find({ type: 'Text', text: /^↓3$/ }))?.text,
  ]

  expect(ahead).toBe('↑12')
  expect(behind).toBe('↓3')
  expect(shownBranch).toMatch(/…\*$/)
  expect(project).toMatch(/…$/)
  expect(project.length + 1 + shownBranch.length + 1 + 3 + 1 + 2).toBeLessThanOrEqual(38)
  await $.ui.scroll(pointerTick(2, CONVERSATIONS_FIRST))
  expect((await ui.find({ type: 'Text', text: /of 13$/ }))?.text).toBe('3–10 of 13')
  expect(reached).toEqual([])
  await ui.unmount()
})

test('a short project and branch are drawn whole', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(paneAt(0))

  expect((await ui.find({ type: 'Text', text: /^testing\*?$/ }))?.text).toMatch(/^testing/)
  await ui.unmount()
})

test('the open model and effort pickers take three rows, effort on two', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { ui, files } = await givenFilesAndConversations($, on)

  await ui.press({ key: 'model-picker-toggle' })
  expect(await ui.find({ key: 'effort-pick-row:auto' })).toBeDefined()
  expect(await ui.find({ key: 'effort-pick-row:high' })).toBeDefined()
  expect(await ui.find({ key: 'model-pick-row:sonnet' })).toBeDefined()

  await $.ui.scroll(pointerTick(1, FILES_FIRST + 3))
  expect(await files()).toBe('2–9 of 10')
  await $.ui.scroll(pointerTick(-1, FILES_LAST + 3))
  expect(await files()).toBe('1–8 of 10')
  expect(reached).toEqual([])
  await $.ui.scroll(pointerTick(1, FILES_LAST + 4))
  expect(reached).toEqual([1])
  await ui.unmount()
})

test('a long waiting text of a session is cut to one line and the Files window below keeps its rows', async ($, on) => {
  const reached = givenPaneRecorder(on)
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'idle' })
  registerSession(world.files, {
    pid: 222,
    sessionId: 'other-a',
    cwd: APP,
    name: 'app-2',
    status: 'waiting',
    waitingFor: 'approve Bash: rm -rf node_modules && npm install && npm run build',
  })
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }

  const ui = await $.ui.mount(paneAt(0))
  const waiting = (await ui.find({ type: 'Text', text: /^approve Bash/ }))?.text ?? ''

  expect(waiting).toMatch(/…$/)
  expect(waiting.length).toBeLessThanOrEqual(24)
  await $.ui.scroll(pointerTick(1, 33))
  expect((await ui.find({ type: 'Text', text: /of 10$/ }))?.text).toBe('2–9 of 10')
  expect(reached).toEqual([])
  await ui.unmount()
})

test('the Files group header of a long repository name is cut to one line', async ($, on) => {
  const { world } = givenEngine(on)
  const root = `/home/dev/${'repository-'.repeat(6)}`
  world.git.top = root
  world.git.status = '## main...origin/main\0 M src/index.ts\0'
  world.store.filesOpen = true
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: `${root}/src/new.ts`, content: 'x\n' })

  const ui = await $.ui.mount(paneAt(0))
  const group = (await ui.find({ type: 'Text', text: /^repository-.*…$/ }))?.text ?? ''

  expect(group).toMatch(/…$/)
  expect(group.length).toBeLessThanOrEqual(38)
  await ui.unmount()
})
