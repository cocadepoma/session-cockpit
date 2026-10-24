import { expect, test } from 'claude-code/testing'
import { APP, HOUR_MS, NOW, PANE, givenEngine, runSidebar, wheelTick } from './fixtures'

const runNote = (args: string) => ({ ...runSidebar, command: 'note', args })

test('/note saves the selection, else typed text, else the last reply, newest first and kept for every session', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  world.selection = 'Use the session watch'
  expect((await $.command.run(runNote(''))).text).toBe('Saved to notes: Use the session watch')

  world.selection = undefined
  world.messages = [
    { role: 'assistant', text: 'An older reply' },
    { role: 'user', text: 'a question' },
    { role: 'assistant', text: '\nThe last reply\nwith a second line' },
  ]
  expect((await $.command.run(runNote(''))).text).toBe('Saved to notes: The last reply')
  expect((await $.command.run(runNote('A typed note'))).text).toBe('Saved to notes: A typed note')

  const saved = world.store.notes as { text: string }[]
  expect(saved.map(note => note.text)).toEqual([
    'A typed note',
    '\nThe last reply\nwith a second line'.trim(),
    'Use the session watch',
  ])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = (await ui.findAll({ type: 'Text', text: /typed note|last reply|session watch/ })).map(found => found.text)
  expect(shown).toEqual(['A typed note', 'The last reply', 'Use the session watch'])
  expect((await ui.find({ type: 'Text', text: /\(3\)$/ }))?.text).toBe(' (3)')
  await ui.unmount()
})

test('/note with nothing selected, typed or replied saves nothing', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(runNote(''))).text).toBe('Nothing to save: select some text first.')
  expect(world.store.notes).toBeUndefined()
})

test('a note copies its whole text when pressed and its cross deletes it from every session', async ($, on) => {
  const { world, copied } = givenEngine(on)
  world.store.notes = [
    { id: 'n1', text: 'First note\nwith more detail', createdAt: NOW },
    { id: 'n2', text: 'Second note', createdAt: NOW - HOUR_MS },
  ]
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/First note/)).toBeUndefined()

  await ui.press({ key: 'notes-toggle' })
  expect(await text(/First note/)).toBe('First note')

  await ui.press({ key: 'note:n1' })
  expect(copied).toEqual(['First note\nwith more detail'])

  await ui.press({ key: 'note-delete:n1' })
  expect(await text(/First note/)).toBeUndefined()
  expect(await text(/Second note/)).toBe('Second note')
  expect((world.store.notes as { id: string }[]).map(note => note.id)).toEqual(['n2'])
  await ui.unmount()
})

test('/note is registered to run mid-turn, without waiting for the turn to end', async ($, on) => {
  const { registered } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(registered.find(command => command.name === 'note')?.immediate).toBe(true)
  await ui.unmount()
})

const numberedNotes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `n${index + 1}`,
    text: `Note number ${String(index + 1).padStart(2, '0')}`,
    createdAt: NOW - index * HOUR_MS,
  }))

test('the notes filter matches the whole text, Enter copies the first match and the header keeps the total', async ($, on) => {
  const { world, copied } = givenEngine(on)
  world.store.notes = [
    { id: 'n1', text: 'First note\nwith more detail', createdAt: NOW },
    { id: 'n2', text: 'Second note', createdAt: NOW - HOUR_MS },
  ]
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await ui.press({ key: 'notes-toggle' })

  await ui.input({ key: 'notes-filter', text: 'DETAIL', kind: 'change' })
  expect(await text(/^First note$/)).toBe('First note')
  expect(await text(/^Second note$/)).toBeUndefined()
  expect(await text(/^ \(2\)$/)).toBe(' (2)')

  await ui.input({ key: 'notes-filter', text: 'note', kind: 'change' })
  await ui.input({ key: 'notes-filter', text: 'note' })
  expect(copied).toEqual(['First note\nwith more detail'])

  await ui.input({ key: 'notes-filter', text: 'zzz', kind: 'change' })
  await ui.input({ key: 'notes-filter', text: 'zzz' })
  expect(copied).toHaveLength(1)
  expect(await text(/^No notes match$/)).toBe('No notes match')
  expect(await text(/^Select text, then \/note$/)).toBeUndefined()
  await ui.unmount()
})

test('the notes scroller and the wheel count the matches', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.notes = numberedNotes(12)
  world.store.notesOpen = true
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const range = async () => (await ui.find({ type: 'Text', text: /of \d+/ }))?.text
  expect(await range()).toBe('1–8 of 12')

  await ui.input({ key: 'notes-filter', text: 'number 0', kind: 'change' })
  expect(await range()).toBe('1–8 of 9')
  await $.ui.scroll(wheelTick(10))
  expect(await range()).toBe('2–9 of 9')

  await ui.input({ key: 'notes-filter', text: 'number 03', kind: 'change' })
  expect(await range()).toBeUndefined()
  await ui.unmount()
})

test('a filter survives folding its section', async ($, on) => {
  const { world } = givenEngine(on)
  world.store.notes = numberedNotes(3)
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'notes-toggle' })
  await ui.input({ key: 'notes-filter', text: 'number 02', kind: 'change' })
  await ui.press({ key: 'notes-toggle' })
  await ui.press({ key: 'notes-toggle' })

  expect((await ui.find({ type: 'Text', text: /^Note number 02$/ }))?.text).toBe('Note number 02')
  expect(await ui.find({ type: 'Text', text: /^Note number 01$/ })).toBeUndefined()
  await ui.unmount()
})
