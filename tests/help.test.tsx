import { expect, test } from 'claude-code/testing'
import { PANE, givenEngine } from './fixtures'

test('the Help section is folded by default and unfolds into the about line, every command and every gesture', async ($, on) => {
  const { world } = givenEngine(on)
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  const gestures = async () => (await ui.findAll({ type: 'Text', text: /^(▶ header|Wheel|Skill|Conversation|\+ new|Note|Close mark|ctrl\+x tab|File|Esc|Filter box|● Keep awake|Settings):/ })).map(found => found.text)

  expect(await text(/^Help$/)).toBe('Help')
  expect(await text(/^Commands$/)).toBeUndefined()
  expect(await text(/Session sidebar/)).toBeUndefined()

  await ui.press({ key: 'help-toggle' })
  expect(world.store.helpOpen).toBe(true)
  expect(await text(/Session sidebar/)).toContain('Session sidebar:')
  expect(await text(/^\/sidebar$/)).toBe('/sidebar')
  expect(await text(/^\/sidebar logo$/)).toBeUndefined()
  expect(await text(/^\/sidebar debug$/)).toBe('/sidebar debug')
  expect(await text(/^\/note \[text\]$/)).toBe('/note [text]')
  expect(await text(/^\/logo \[art\]$/)).toBe('/logo [art]')
  expect(await gestures()).toEqual([
    '▶ header: fold or unfold a section',
    'Wheel: list under pointer, then sidebar',
    'Skill: press to fill the prompt with it',
    'Conversation: press to resume it; the current one is listed first',
    '+ new: start a new conversation',
    'Note: press to copy it, ✕ deletes it',
    'Close mark: closes it; /sidebar reopens',
    'ctrl+x tab: focus the sidebar',
    'File: press to open its diff',
    'Esc: return focus, close the diff',
    'Filter box: type to narrow the list, Enter acts on the first match',
    '● Keep awake: pick 30m, 1h, 2h, 5h or ∞; press ● to stop',
    'Settings: press a row to show or hide that part; Activity starts hidden',
  ])
  expect(await text(/^Files: repository/)).toBe(
    "Files: repository changes and Claude's edits, then Other (outside the repository); outside git, only Claude's edits.",
  )
  expect(await text(/^Keep awake: idle only/)).toBe(
    'Keep awake: idle only; a manual lock or closing the lid still locks. Unverified on some Linux desktops.',
  )

  await ui.press({ key: 'help-toggle' })
  expect(world.store.helpOpen).toBe(false)
  expect(await text(/^Commands$/)).toBeUndefined()
  await ui.unmount()
})
