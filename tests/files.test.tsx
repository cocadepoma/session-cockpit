import { expect, mock, test } from 'claude-code/testing'
import {
  APP,
  NOW,
  PANE,
  SNAPSHOT_ROOT,
  SRC_FILE,
  editFile,
  givenEngine,
  givenGitRepository,
  givenTenFilesWithEmptyNotes,
  listedGroupRows,
  paneAt,
  wheelTick,
} from './fixtures'

test('a file edited in the session is listed once with its path relative to the cwd and its line counts', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\ntwo\nthree\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.tool.call(editFile(SRC_FILE, 'two', 'TWO\nTWO AGAIN'))
  await $.tool.call(editFile(SRC_FILE, 'three', 'THREE'))
  await $.tool.call({ tool: 'Write', file_path: '/home/dev/app/docs/new.md', content: 'hello\nworld\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const rows = (await ui.findAll({ type: 'Text', text: /^(…)?(src|docs)\// })).map(found => found.text)

  expect(rows).toEqual(['src/index.ts', 'docs/new.md'])
  expect(await text(/^\+3$/)).toBe('+3')
  expect(await text(/^-2$/)).toBe('-2')
  expect(await text(/^\+2$/)).toBe('+2')
  expect(await text(/^-0$/)).toBe('-0')
  expect(await text(/^ \(2\)$/)).toBe(' (2)')
  await ui.unmount()
})

test('the Files section is folded by default and its open flag is remembered', async ($, on) => {
  const { world } = givenEngine(on)
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^Files$/)).toBe('Files')
  expect(await text(/^src\/index\.ts$/)).toBeUndefined()

  await ui.press({ key: 'files-toggle' })
  expect(world.store.filesOpen).toBe(true)
  expect(await text(/^src\/index\.ts$/)).toBe('src/index.ts')

  await ui.press({ key: 'files-toggle' })
  expect(world.store.filesOpen).toBe(false)
  expect(await text(/^src\/index\.ts$/)).toBeUndefined()
  await ui.unmount()
})

test('a denied or failed edit adds nothing to the list', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  world.editOutcome = 'deny'
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))
  world.editOutcome = 'error'
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^No files changed yet$/ }))?.text).toBe('No files changed yet')
  expect(Object.keys(world.files).filter(path => path.startsWith(SNAPSHOT_ROOT))).toEqual([])
  await ui.unmount()
})

test('a notebook edit is tracked by its notebook path', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files['/home/dev/app/study.ipynb'] = 'print(1)\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/home/dev/app/study.ipynb', new_source: 'print(2)\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /study\.ipynb/ }))?.text).toBe('study.ipynb')
  await ui.unmount()
})

test('pressing a file shows the unified diff against the session baseline in place of the sections', async ($, on) => {
  const { world, panes } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\ntwo\nthree\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'two', 'TWO'))
  await $.tool.call(editFile(SRC_FILE, 'three', 'THREE'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${SRC_FILE}` })
  expect(panes.filter(pane => pane.id === 'diff')).toEqual([])

  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.text).toBe('@@ -2,2 +2,2 @@\n-two\n-three\n+TWO\n+THREE\n')
  expect((await ui.find({ type: 'Text', text: /^src\/index\.ts$/ }))?.text).toBe('src/index.ts')
  expect(await ui.find({ type: 'Text', text: /No changes/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Files$/ })).toBeUndefined()
  await ui.unmount()
})

test('Back returns from the diff to the sections', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\ntwo\nthree\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'two', 'TWO'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${SRC_FILE}` })

  await ui.press({ key: 'diff-back' })

  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Files$/ }))?.text).toBe('Files')
  await ui.unmount()
})

test('a file whose content is back to its baseline shows that nothing changed', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))
  await $.tool.call(editFile(SRC_FILE, 'two', 'one'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${SRC_FILE}` })

  expect((await ui.find({ type: 'Text', text: /No changes/ }))?.text).toBe('No changes since the session began')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('a diff over the size cap is cut at a hunk boundary and says so', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const hunk = (start: number) => `@@ -${start},1 +${start},1 @@\n-${'a'.repeat(40_000)}\n+${'b'.repeat(40_000)}`
  world.diffOutput = ['--- a/x', '+++ b/x', hunk(1), hunk(100), hunk(200)].join('\n')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `file:${SRC_FILE}` })

  const source = (await ui.find({ type: 'Code' }))?.text ?? ''
  expect(source.length).toBeLessThanOrEqual(100_000)
  expect(source.match(/^@@ /gm)).toHaveLength(1)
  expect(source.startsWith('@@ -1,1 +1,1 @@')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Too large/ }))?.text).toBe('Too large to show in full: 1 of 3 hunks shown')
  await ui.unmount()
})

test('the tracked files survive a module reload within the session', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^src\/index\.ts$/ }))?.text).toBe('src/index.ts')
  expect((await ui.find({ type: 'Text', text: /^\+1$/ }))?.text).toBe('+1')
  await ui.unmount()
})

test('a new conversation empties the files list and drops the old snapshots', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { world } = givenEngine(on, { usesMockClock: true })
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^src\/index\.ts$/)).toBe('src/index.ts')

  world.sessionId = 'other'
  await clock.advance(1_000)

  expect(await text(/^src\/index\.ts$/)).toBeUndefined()
  expect(await text(/^No files changed yet$/)).toBe('No files changed yet')
  expect(Object.keys(world.files).filter(path => path.startsWith(SNAPSHOT_ROOT))).toEqual([])

  await $.tool.call(editFile(SRC_FILE, 'two', 'three'))
  expect(await text(/^src\/index\.ts$/)).toBe('src/index.ts')
  expect(Object.keys(world.files).some(path => path.startsWith(`${SNAPSHOT_ROOT}/other/`))).toBe(true)
  await ui.unmount()
})

test('a resume empties the files list as it does the todos', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  world.files[SRC_FILE] = 'one\n'
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(editFile(SRC_FILE, 'one', 'two'))

  world.sessionId = 'resumed'
  await $.classic.SessionStart({ source: 'resume' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^No files changed yet$/ }))?.text).toBe('No files changed yet')
  await ui.unmount()
})

test('the files filter matches the shown path, never the absolute one, and group headers count the matches', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, ' M src/lib.ts\0 M src/main.ts\0')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/home/dev/notes/todo.md', content: 'one\n' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await listedGroupRows(ui)).toEqual(['app (2)', 'src/lib.ts', 'src/main.ts', 'Other (1)', '~/notes/todo.md'])

  await ui.input({ key: 'files-filter', text: 'LIB', kind: 'change' })
  expect(await listedGroupRows(ui)).toEqual(['app (1)', 'src/lib.ts'])
  expect((await ui.find({ type: 'Text', text: /^ \(3\)$/ }))?.text).toBe(' (3)')

  await ui.input({ key: 'files-filter', text: '~/notes', kind: 'change' })
  expect(await listedGroupRows(ui)).toEqual(['Other (1)', '~/notes/todo.md'])

  await ui.input({ key: 'files-filter', text: 'home/dev', kind: 'change' })
  expect(await listedGroupRows(ui)).toEqual([])
  expect((await ui.find({ type: 'Text', text: /^No files match$/ }))?.text).toBe('No files match')
  await ui.unmount()
})

test('Enter in the files filter opens the diff of the first match and nothing without one', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, ' M src/lib.ts\0 M src/main.ts\0')
  world.git.diffs[`${APP}/src/main.ts`] = '@@ -1 +1 @@\n-a\n+b\n'
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'files-filter', text: 'zzz', kind: 'change' })
  await ui.input({ key: 'files-filter', text: 'zzz' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()

  await ui.input({ key: 'files-filter', text: 'main', kind: 'change' })
  await ui.input({ key: 'files-filter', text: 'main' })
  expect((await ui.find({ type: 'Code' }))?.text).toBe('@@ -1 +1 @@\n-a\n+b\n')
  expect((await ui.find({ type: 'Text', text: /^src\/main\.ts$/ }))?.text).toBe('src/main.ts')
  await ui.unmount()
})

test('the files scroller and the wheel count the matches', async ($, on) => {
  await givenTenFilesWithEmptyNotes($, on)

  const ui = await $.ui.mount(paneAt(0))
  const range = async () => (await ui.find({ type: 'Text', text: /of \d+/ }))?.text

  await ui.input({ key: 'files-filter', text: 'n0', kind: 'change' })
  expect(await range()).toBe('1–8 of 9')
  await $.ui.scroll(wheelTick(10))
  expect(await range()).toBe('2–9 of 9')

  await ui.input({ key: 'files-filter', text: 'n1', kind: 'change' })
  expect(await range()).toBeUndefined()
  await ui.unmount()
})

test('the Files header sums the added and removed lines of every listed file, not only the visible window', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.filesOpen = true
  givenGitRepository(world, ' M src/lib.ts\0 M src/main.ts\0', ['4\t1\tsrc/lib.ts', '2\t3\tsrc/main.ts', ''].join('\0'))
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  for (const number of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    await $.tool.call({ tool: 'Write', file_path: `/home/dev/notes/n${number}.md`, content: 'x\n' })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^ \(10\)$/)).toBe(' (10)')
  expect(await text(/^ \+14$/)).toBe(' +14')
  expect(await text(/^ -4$/)).toBe(' -4')
  expect(await text(/of \d+/)).toBe('1–8 of 10')

  await ui.input({ key: 'files-filter', text: 'lib', kind: 'change' })
  expect(await text(/^ \+14$/)).toBe(' +14')
  await ui.unmount()
})

test('without listed files the Files header shows no counts', async ($, on) => {
  givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^ \+\d+$/ }))?.text).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Files$/ }))?.text).toBe('Files')
  await ui.unmount()
})
