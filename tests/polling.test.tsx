import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { APP, NOW, PANE, givenEngine, givenGitRepository, registerSession, runSidebar } from './fixtures'

const polled = (ran: string[][]) => ran.filter(argv => argv[0] === 'git' || argv[0] === 'ps').map(argv => argv[0])

const givenClosedSidebar = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const engine = givenEngine(on, { usesMockClock: true })
  engine.world.store.open = false
  registerSession(engine.world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app', status: 'busy' })
  givenGitRepository(engine.world, '')
  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })
  engine.world.ran.length = 0

  return { ...engine, clock }
}

test('with the sidebar closed the session and files watches read neither the registry nor git', async ($, on) => {
  const { world, clock } = await givenClosedSidebar($, on)

  await clock.advance(10_000)

  expect(polled(world.ran)).toEqual([])
})

test('with the sidebar shown the watches keep running', async ($, on) => {
  const { world, clock } = await givenClosedSidebar($, on)
  world.isPaneOpen = true

  await clock.advance(5_000)

  expect(polled(world.ran)).toContain('git')
  expect(polled(world.ran)).toContain('ps')
})

test('opening the sidebar with /sidebar runs both watches at once', async ($, on) => {
  const { world } = await givenClosedSidebar($, on)
  const registryReads = () => world.listed.filter(path => path === '/home/dev/.claude/sessions').length
  const before = registryReads()

  expect((await $.command.run(runSidebar)).text).toBe('Sidebar shown.')

  expect(polled(world.ran)).toContain('git')
  expect(registryReads()).toBe(before + 1)
})

test('a Bash call refreshes git only while the sidebar is shown', async ($, on) => {
  const { world } = await givenClosedSidebar($, on)

  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(polled(world.ran)).toEqual([])

  world.isPaneOpen = true
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(polled(world.ran)).toContain('git')
})

test('the turn completion still refreshes git with the sidebar closed', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  const { world } = await givenClosedSidebar($, on)

  await $.turn.complete({ answer: '' } as never)

  expect(polled(world.ran)).toContain('git')
})

test('with the sidebar closed a conversation switch still clears the old conversation at once', async ($, on) => {
  const { world, clock } = await givenClosedSidebar($, on)
  const writeTodo = (content: string) =>
    $.tool.call({ tool: 'TodoWrite', todos: [{ content, status: 'pending', activeForm: 'Working on it' }] })
  await writeTodo('Old conversation task')

  world.sessionId = 'other'
  await clock.advance(1_000)
  await writeTodo('New conversation task')
  world.isPaneOpen = true
  await clock.advance(1_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /New conversation task/ }))?.text).toBe('New conversation task')
  await ui.unmount()
})
