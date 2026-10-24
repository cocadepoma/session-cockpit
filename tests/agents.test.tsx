import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'
import { AGENTS_ROOT, APP, NOW, givenEngine, registerSession } from './fixtures'
import type { AgentStandIn } from './fixtures'

const PUBLISHED = `${AGENTS_ROOT}/current.json`

const REVIEWER: AgentStandIn = { id: 'a1', description: 'Review the diff', type: 'Explore', status: 'running' }

const givenSession = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const engine = givenEngine(on, { usesMockClock: true })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/home/dev/app', surface: 'terminal', isInteractive: true })
  engine.world.written.length = 0

  return { ...engine, clock }
}

const published = (files: Record<string, string>) => JSON.parse(files[PUBLISHED] ?? 'null')

const writes = (written: string[]) => written.filter(path => path === PUBLISHED).length

test('a spawned agent is published right after the spawn resolves', async ($, on) => {
  const { world } = await givenSession($, on)
  world.agents = [{ ...REVIEWER, parentId: undefined }]

  await $.agent.spawn({ prompt: 'Review it', description: 'Review the diff', subagentType: 'Explore' } as never)

  expect(published(world.files)).toEqual({
    sessionId: 'current',
    updatedAt: NOW,
    agents: [{ id: 'a1', type: 'Explore', description: 'Review the diff', status: 'running', parentId: null }],
  })
})

test('only pending, running and waiting agents are published, in list order, with control characters stripped', async ($, on) => {
  const { world } = await givenSession($, on)
  world.agents = [
    { id: 'a1', type: 'Explore', description: 'Map\nthe\tcode\u001b[0m', status: 'waiting' },
    { id: 'a2', type: 'general-purpose', description: 'Done already', status: 'completed' },
    { id: 'a3', type: 'general-purpose', description: 'Idle teammate', status: 'idle' },
    { id: 'a4', type: 'Plan', description: 'Plan it', status: 'pending', parentId: 'a1' },
    { id: 'a5', type: 'Plan', description: 'Failed one', status: 'failed' },
    { id: 'a6', type: 'Plan', description: 'Killed one', status: 'killed' },
    { id: 'a7', type: 'Explore', description: 'Search', status: 'running' },
  ]

  await $.turn.complete({ answer: '' } as never)

  expect(published(world.files).agents).toEqual([
    { id: 'a1', type: 'Explore', description: 'Map the code [0m', status: 'waiting', parentId: null },
    { id: 'a4', type: 'Plan', description: 'Plan it', status: 'pending', parentId: 'a1' },
    { id: 'a7', type: 'Explore', description: 'Search', status: 'running', parentId: null },
  ])
})

test('an agent turn completing publishes too', async ($, on) => {
  const { world } = await givenSession($, on)
  world.agents = [REVIEWER]

  await $.turn.complete({ answer: '', agentId: 'a1' } as never)

  expect(published(world.files).agents).toHaveLength(1)
})

test('the list is not rewritten while it is unchanged, and is when an agent ends', async ($, on) => {
  const { world, clock } = await givenSession($, on)
  world.agents = [REVIEWER]

  await $.turn.complete({ answer: '' } as never)
  await $.turn.complete({ answer: '' } as never)
  await clock.advance(3_000)
  expect(writes(world.written)).toBe(1)

  world.agents = [{ ...REVIEWER, status: 'completed' }]
  await clock.advance(1_000)
  expect(writes(world.written)).toBe(2)
  expect(published(world.files).agents).toEqual([])

  await clock.advance(3_000)
  expect(writes(world.written)).toBe(2)
})

test('the watch publishes an agent that appears between turns, even with the sidebar closed', async ($, on) => {
  const { world, clock } = await givenSession($, on)
  world.store.open = false
  world.agents = [REVIEWER]

  await clock.advance(1_000)

  expect(published(world.files).agents).toHaveLength(1)
})

test('a failing agent list or write is skipped and never breaks the hook it runs in', async ($, on) => {
  const { world } = await givenSession($, on)
  world.agents = 'throws'

  await expect($.turn.complete({ answer: '' } as never)).resolves.toEqual({ text: '' })
  expect(world.files[PUBLISHED]).toBeUndefined()

  world.agents = [REVIEWER]
  world.isWriteFailing = true
  await expect($.turn.complete({ answer: '' } as never)).resolves.toEqual({ text: '' })
})

test('the session end removes this session\'s file, and a crafted id removes nothing', async ($, on) => {
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const { world } = await givenSession($, on)
  world.agents = [REVIEWER]
  await $.turn.complete({ answer: '' } as never)
  expect(world.files[PUBLISHED]).toBeDefined()

  await $.session.end({ reason: 'other', sessionId: '../escape', resume: {} } as never)
  expect(world.files[PUBLISHED]).toBeDefined()
  expect(world.ran.filter(argv => argv[0] === 'rm')).toEqual([])

  await $.session.end({ reason: 'other', sessionId: 'current', resume: {} } as never)
  expect(world.files[PUBLISHED]).toBeUndefined()
  expect(world.ran.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-f', '--', PUBLISHED]])
})

const givenPublishedFiles = (world: { files: Record<string, string> }, sessionIds: string[]) => {
  for (const sessionId of sessionIds) {
    world.files[`${AGENTS_ROOT}/${sessionId}.json`] = JSON.stringify({ sessionId, updatedAt: NOW, agents: [] })
  }
}

test('starting a session removes the files of sessions that are not running and keeps live ones and its own', async ($, on) => {
  const { world } = givenEngine(on)
  registerSession(world.files, { pid: 111, sessionId: 'current', cwd: APP, name: 'app-1', status: 'busy' })
  registerSession(world.files, { pid: 222, sessionId: 'other-a', cwd: APP, name: 'app-2', status: 'idle' })
  registerSession(world.files, { pid: 444, sessionId: 'crashed', cwd: APP, name: 'ghost', status: 'busy' })
  world.deadPids = [444]
  givenPublishedFiles(world, ['current', 'other-a', 'crashed', 'unregistered'])
  world.files[`${AGENTS_ROOT}/notes.txt`] = 'keep'
  world.files[`${AGENTS_ROOT}/bad name.json`] = 'keep'

  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  expect(Object.keys(world.files).filter(path => path.startsWith(AGENTS_ROOT)).sort()).toEqual([
    `${AGENTS_ROOT}/bad name.json`,
    `${AGENTS_ROOT}/current.json`,
    `${AGENTS_ROOT}/notes.txt`,
    `${AGENTS_ROOT}/other-a.json`,
  ])
})

test('an empty registry removes no agent file', async ($, on) => {
  const { world } = givenEngine(on)
  givenPublishedFiles(world, ['other-a', 'crashed'])

  await $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true })

  expect(world.files[`${AGENTS_ROOT}/other-a.json`]).toBeDefined()
  expect(world.files[`${AGENTS_ROOT}/crashed.json`]).toBeDefined()
})

test('a published file that went missing comes back at the next publish', async ($, on) => {
  const { world } = await givenSession($, on)
  world.agents = [REVIEWER]
  await $.turn.complete({ answer: '' } as never)
  delete world.files[PUBLISHED]

  await $.turn.complete({ answer: '' } as never)

  expect(published(world.files).agents).toHaveLength(1)
})
