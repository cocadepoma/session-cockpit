import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { PANE, givenEngine, runSidebar } from './fixtures'

const VS_CODE_TEXT = 'The sidebar is off in VS Code.'

const startSession = async ($: Parameters<TestBody>[0], on: On, surface: 'terminal' | 'vscode', termProgram?: string) => {
  const engine = givenEngine(on)
  if (termProgram !== undefined) engine.world.env.TERM_PROGRAM = termProgram
  engine.world.surfaces = [surface]
  await $.session.start({ cwd: '/home/dev/app', surface, isInteractive: true })

  return engine
}

test('a session in the VS Code extension does not open the sidebar by itself', async ($, on) => {
  const { world } = await startSession($, on, 'vscode')

  expect(world.isPaneOpen).toBe(false)
})

test('a session in the VS Code integrated terminal does not open the sidebar by itself', async ($, on) => {
  const { world } = await startSession($, on, 'terminal', 'vscode')

  expect(world.isPaneOpen).toBe(false)
})

test('a sidebar drawn on the VS Code surface closes, draws nothing and the next session still wants it', async ($, on) => {
  const { world } = await startSession($, on, 'terminal')
  expect(world.isPaneOpen).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })

  expect(world.isPaneOpen).toBe(false)
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  expect(world.store.open).toBeUndefined()
  await ui.unmount()
})

test('a sidebar drawn on the VS Code integrated terminal closes and draws nothing', async ($, on) => {
  const { world } = await startSession($, on, 'terminal')
  world.env.TERM_PROGRAM = 'vscode'

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(world.isPaneOpen).toBe(false)
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  await ui.unmount()
})

test('/sidebar in VS Code says the sidebar is off and opens nothing', async ($, on) => {
  const { world } = await startSession($, on, 'terminal', 'vscode')

  expect((await $.command.run(runSidebar)).text).toBe(VS_CODE_TEXT)
  expect(world.isPaneOpen).toBe(false)
  expect(world.store.open).toBeUndefined()
})

test('a terminal outside VS Code still opens the sidebar by itself and /sidebar still toggles it', async ($, on) => {
  const { world } = await startSession($, on, 'terminal', 'iTerm.app')

  expect(world.isPaneOpen).toBe(true)
  expect((await $.command.run(runSidebar)).text).toBe('Sidebar closed.')
  expect((await $.command.run(runSidebar)).text).toBe('Sidebar shown.')
})
