import { expect, test } from 'claude-code/testing'
import { PANE, givenEngine } from './fixtures'

test('the open sections are remembered for the next session', async ($, on) => {
  const { world } = givenEngine(on)
  world.store = { mcpOpen: false, skillsOpen: true, conversationsOpen: true, notesOpen: true, helpOpen: true, filesOpen: true, settingsOpen: true }
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^Logo$/)).toBe('Logo')
  expect(await text(/active/)).toBe(' (3 active)')
  expect(await text(/review-checklist/)).toBe('/frontend-review-checklist')
  expect(await text(/Renamed/)).toBe('Renamed "quoted" title')
  expect(await text(/then \/note/)).toBe('Select text, then /note')
  expect(await text(/^Commands$/)).toBe('Commands')
  expect(await text(/^No files changed yet$/)).toBe('No files changed yet')

  await ui.press({ key: 'files-toggle' })
  expect(world.store.filesOpen).toBe(false)
  await ui.press({ key: 'skills-toggle' })
  await ui.press({ key: 'notes-toggle' })
  await ui.press({ key: 'help-toggle' })
  await ui.press({ key: 'settings-toggle' })
  expect(world.store.skillsOpen).toBe(false)
  expect(world.store.notesOpen).toBe(false)
  expect(world.store.helpOpen).toBe(false)
  expect(world.store.settingsOpen).toBe(false)
  await ui.unmount()
})
