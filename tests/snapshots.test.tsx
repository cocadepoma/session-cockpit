import { expect, test } from 'claude-code/testing'
import { NOW, PANE, SNAPSHOT_ROOT, givenEngine, registerSession } from './fixtures'

const DAY_MS = 86_400_000

const removedDirectories = (ran: string[][]) => ran.filter(argv => argv[0] === 'rm').map(argv => argv.at(-1))

test('a new session removes the snapshots of ended sessions untouched for a week and keeps the others', async ($, on) => {
  const { world } = givenEngine(on)
  world.snapshotDirectories = [
    { name: 'ended-old', mtimeMs: NOW - 8 * DAY_MS },
    { name: 'ended-recent', mtimeMs: NOW - 6 * DAY_MS },
    { name: 'running-old', mtimeMs: NOW - 9 * DAY_MS },
    { name: 'current', mtimeMs: NOW - 30 * DAY_MS },
    { name: 'not a session id!', mtimeMs: NOW - 30 * DAY_MS },
  ]
  registerSession(world.files, { pid: 100, sessionId: 'current', cwd: '/home/dev/app', name: 'app', status: 'busy' })
  registerSession(world.files, { pid: 111, sessionId: 'running-old', cwd: '/home/dev/lib', name: 'lib', status: 'idle' })
  registerSession(world.files, { pid: 222, sessionId: 'ended-old', cwd: '/home/dev/lib', name: 'old', status: 'idle' })
  world.deadPids = [222]

  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()

  expect(removedDirectories(world.ran)).toEqual([`${SNAPSHOT_ROOT}/ended-old`])
})

test('a session registry that does not list the current session removes no snapshots', async ($, on) => {
  const { world } = givenEngine(on)
  world.snapshotDirectories = [{ name: 'ended-old', mtimeMs: NOW - 8 * DAY_MS }]

  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })

  expect(removedDirectories(world.ran)).toEqual([])
})

