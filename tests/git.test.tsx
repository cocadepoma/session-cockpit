import { expect, mock, test } from 'claude-code/testing'
import {
  APP,
  NOW,
  PANE,
  SRC_FILE,
  editFile,
  givenEngine,
  givenGitRepository,
  listedGroupRows,
} from './fixtures'

const listedFiles = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(…)?(src|docs|lib)\// })).map(found => found.text)

test('a change made with Bash in a git repository appears with its numstat counts', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, '')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^No files changed yet$/ }))?.text).toBe('No files changed yet')

  givenGitRepository(world, ' M src/lib.ts\0 D src/gone.ts\0', '4\t1\tsrc/lib.ts\0-\t-\tsrc/gone.ts\0')
  await $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ src/lib.ts" })

  expect(await listedFiles(ui)).toEqual(['src/lib.ts', 'src/gone.ts'])
  expect((await ui.find({ type: 'Text', text: /^\+4$/ }))?.text).toBe('+4')
  expect((await ui.find({ type: 'Text', text: /^-1$/ }))?.text).toBe('-1')
  expect((await ui.find({ type: 'Text', text: /^ \(2\)$/ }))?.text).toBe(' (2)')
  await ui.unmount()
})

test('an untracked file appears with its line count as added', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[`${APP}/docs/new.md`] = 'one\ntwo\nthree\n'
  givenGitRepository(world, '?? docs/new.md\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual(['docs/new.md'])
  expect((await ui.find({ type: 'Text', text: /^\+3$/ }))?.text).toBe('+3')
  expect((await ui.find({ type: 'Text', text: /^-0$/ }))?.text).toBe('-0')
  await ui.unmount()
})

test('a file both edited by Claude and changed in git appears once with its session counts', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\ntwo\n'
  givenGitRepository(world, ' M src/index.ts\0 M src/lib.ts\0', '9\t9\tsrc/index.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'two', 'TWO'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual(['src/index.ts', 'src/lib.ts'])
  expect((await ui.find({ type: 'Text', text: /^\+9$/ }))?.text).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^ \(2\)$/ }))?.text).toBe(' (2)')
  await ui.unmount()
})

test('pressing a git-only file opens its git diff, and an untracked one its diff against /dev/null', async ($, on) => {
  const { world, panes } = givenEngine(on)
  world.store.filesOpen = true
  world.files[`${APP}/docs/new.md`] = 'hello\n'
  givenGitRepository(world, ' M src/lib.ts\0?? docs/new.md\0', '1\t1\tsrc/lib.ts\0')
  world.git.untracked = [`${APP}/docs/new.md`]
  world.git.diffs[`${APP}/src/lib.ts`] = 'diff --git a/src/lib.ts b/src/lib.ts\nindex 1..2\n--- a/src/lib.ts\n+++ b/src/lib.ts\n@@ -1 +1 @@\n-a\n+b\n'
  world.git.diffs[`${APP}/docs/new.md`] = 'diff --git a/x b/x\n--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+hello\n'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${APP}/src/lib.ts` })
  expect(panes.at(-1)).toEqual({ id: 'diff', title: 'lib.ts', focus: true, closeOnEscape: true })
  const diff = await $.ui.mount({ ...PANE, requestId: 'diff', surface: 'terminal' })
  expect((await diff.find({ type: 'Code' }))?.text).toBe('@@ -1 +1 @@\n-a\n+b\n')
  await diff.unmount()

  await ui.press({ key: `file:${APP}/docs/new.md` })
  const untracked = await $.ui.mount({ ...PANE, requestId: 'diff', surface: 'terminal' })
  expect((await untracked.find({ type: 'Code' }))?.text).toBe('@@ -0,0 +1 @@\n+hello\n')
  await untracked.unmount()

  world.git.diffs[`${APP}/src/lib.ts`] = ''
  await ui.press({ key: `file:${APP}/src/lib.ts` })
  const empty = await $.ui.mount({ ...PANE, requestId: 'diff', surface: 'terminal' })
  expect((await empty.find({ type: 'Text', text: /No changes/ }))?.text).toBe('No changes against HEAD')
  await empty.unmount()
  await ui.unmount()
})

test('git runs without optional locks or the fsmonitor, and its diffs without external diff or textconv', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[`${APP}/docs/new.md`] = 'hello\n'
  givenGitRepository(world, ' M src/lib.ts\0?? docs/new.md\0', '1\t1\tsrc/lib.ts\0')
  world.git.untracked = [`${APP}/docs/new.md`]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${APP}/src/lib.ts` })
  await ui.press({ key: `file:${APP}/docs/new.md` })
  await ui.unmount()

  const gitCalls = world.ran.filter(argv => argv[0] === 'git')
  const diffCalls = gitCalls.filter(argv => argv[4] === 'diff')
  expect([...new Set(gitCalls.map(argv => argv.slice(1, 4).join(' ')))]).toEqual([
    '--no-optional-locks -c core.fsmonitor=false',
  ])
  expect(diffCalls.some(argv => argv.includes('--numstat'))).toBe(true)
  expect(diffCalls.some(argv => argv.at(-1) === `${APP}/src/lib.ts`)).toBe(true)
  expect(diffCalls.some(argv => argv.includes('--no-index'))).toBe(true)
  expect([...new Set(diffCalls.map(argv => argv.slice(5, 7).join(' ')))]).toEqual(['--no-ext-diff --no-textconv'])
})

test('outside git, or when git fails, the list is the session files alone', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual(['src/index.ts'])

  givenGitRepository(world, ' M src/lib.ts\0')
  world.git.isFailing = true
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await listedFiles(ui)).toEqual(['src/index.ts'])
  expect((await ui.find({ type: 'Text', text: /^ \(1\)$/ }))?.text).toBe(' (1)')
  await ui.unmount()
})

test('a conversation change drops the session files and keeps the git files', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  givenGitRepository(world, ' M src/lib.ts\0', '2\t0\tsrc/lib.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual(['src/index.ts', 'src/lib.ts'])

  world.sessionId = 'other'
  await clock.advance(1_000)

  expect(await listedFiles(ui)).toEqual(['src/lib.ts'])
  await ui.unmount()
})

test('a renamed file is listed under its new path with its numstat counts', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, 'R  src/new.ts\0src/old.ts\0', '3\t2\t\0src/old.ts\0src/new.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual(['src/new.ts'])
  expect((await ui.find({ type: 'Text', text: /^\+3$/ }))?.text).toBe('+3')
  expect((await ui.find({ type: 'Text', text: /^-2$/ }))?.text).toBe('-2')
  await ui.unmount()
})

test('a change made outside Claude appears on the next files watch, with no tool call or turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.filesOpen = true
  givenGitRepository(world, '')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await listedFiles(ui)).toEqual([])

  givenGitRepository(world, ' M src/lib.ts\0', '2\t1\tsrc/lib.ts\0')
  await clock.advance(1_000)
  expect(await listedFiles(ui)).toEqual([])

  await clock.advance(2_000)
  expect(await listedFiles(ui)).toEqual(['src/lib.ts'])
  expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.text).toBe('+2')
  await ui.unmount()
})

test('a hand edit to a file Claude edited updates its session counts on the next files watch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\ntwo\n'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'two', 'TWO'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^\+1$/ }))?.text).toBe('+1')

  world.files[SRC_FILE] = 'ONE\nTWO\nthree\n'
  await clock.advance(3_000)

  expect((await ui.find({ type: 'Text', text: /^\+3$/ }))?.text).toBe('+3')
  expect((await ui.find({ type: 'Text', text: /^-2$/ }))?.text).toBe('-2')
  await ui.unmount()
})

const groupHeaders = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(app|Other) \(\d+\)$/ })).map(found => found.text)

test('in a git repository the Files list shows the repository group first and Other after, each under its header', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, ' M src/lib.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/home/dev/notes/todo.md', content: 'one\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedGroupRows(ui)).toEqual(['app (1)', 'src/lib.ts', 'Other (1)', '~/notes/todo.md'])
  expect((await ui.find({ type: 'Text', text: /^ \(2\)$/ }))?.text).toBe(' (2)')
  await ui.unmount()
})

test('a file Claude edited inside the repository stays in the repository group when git does not report it', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  givenGitRepository(world, '')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedGroupRows(ui)).toEqual(['app (1)', 'src/index.ts'])
  expect(await groupHeaders(ui)).toEqual(['app (1)'])
  await ui.unmount()
})

test('scrolling to a window that starts inside Other shows the Other header and not the repository one', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, ' M src/lib.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await groupHeaders(ui)).toEqual(['app (1)', 'Other (10)'])

  await ui.press({ key: 'files-down' })

  expect(await groupHeaders(ui)).toEqual(['Other (10)'])
  expect((await ui.findAll({ type: 'Text', text: /^~\/notes\// })).map(found => found.text)).toEqual(
    ['03', '04', '05', '06', '07', '08', '09', '10'].map(number => `~/notes/n${number}.md`),
  )
  await ui.unmount()
})

test('outside git, or when git fails, the Files list has no group headers and keeps its rows', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))
  await $.tool.call({ tool: 'Write', file_path: '/home/dev/notes/todo.md', content: 'one\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await groupHeaders(ui)).toEqual([])
  expect((await ui.findAll({ type: 'Text', text: /^(src\/|\/home\/dev\/notes\/)/ })).map(found => found.text)).toEqual([
    'src/index.ts',
    '/home/dev/notes/todo.md',
  ])

  givenGitRepository(world, ' M src/lib.ts\0')
  world.git.isFailing = true
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await groupHeaders(ui)).toEqual([])
  await ui.unmount()
})
